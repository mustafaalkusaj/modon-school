/**
 * Rate limiting helpers for API routes.
 *
 * Production uses Upstash Redis so limits are shared across serverless
 * instances. The in-memory store below is intentionally development-only and
 * is not safe for Vercel, Lambda, or horizontally scaled deployments.
 */

import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

interface RateLimitStore {
  [key: string]: {
    tokens: number;
    lastRefill: number;
  };
}

type RateLimitConfig = { requests: number; window: number };
type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number;
};

type ProductionFailureReason =
  "missing-config" | "init-error" | "runtime-error";
type ProductionFailureMode = "fail-open" | "fail-closed" | "memory-fallback";

// Development-only memory store. It is not shared across serverless instances.
const store: RateLimitStore = {};
let redisClient: Redis | null = null;
let hasLoggedMissingProductionConfig = false;
const rateLimitFailureLogKeys = new Set<string>();
// NOTE: Design decision: fail-open for rate limiting. Monitor via ops alerts.
export const RATE_LIMIT_FAIL_OPEN_TODO =
  "Replace fail-open with alert-backed resilient limiter before high traffic";
const DEFAULT_RATE_LIMIT_ERROR_MESSAGE =
  "تم تجاوز حد الطلبات المسموح. يرجى المحاولة لاحقاً.";

/**
 * Configuration for rate limiting
 */
export const RATE_LIMIT_CONFIG = {
  // Global rate limits (per minute)
  GLOBAL: {
    requests: 1000,
    window: 60, // seconds
  },
  // API endpoint limits
  API_ENDPOINT: {
    requests: 100,
    window: 60, // requests per minute
  },
  // Super admin operations (more lenient)
  SUPER_ADMIN: {
    requests: 500,
    window: 60,
  },
  // Auth endpoints (stricter)
  AUTH: {
    requests: 20,
    window: 60,
  },
  // File upload limits
  FILE_UPLOAD: {
    requests: 10,
    window: 300, // 5 minutes
  },
};

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function isLocalhost() {
  return process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1";
}

function hasUpstashConfig() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function getUpstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  return { url, token };
}

function getRedisClient() {
  if (!hasUpstashConfig()) {
    return null;
  }

  const { url, token } = getUpstashConfig();

  redisClient ??= new Redis({
    url,
    token,
  });

  return redisClient;
}

function logMissingProductionConfig() {
  if (hasLoggedMissingProductionConfig) {
    return;
  }

  hasLoggedMissingProductionConfig = true;
  console.error(
    "Production rate limiting requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
  );
}

function logProductionRateLimitBackendFailure(
  namespace: string,
  reason: ProductionFailureReason,
  error?: unknown,
) {
  const logKey = `${namespace}:${reason}`;
  if (rateLimitFailureLogKeys.has(logKey)) {
    return;
  }

  rateLimitFailureLogKeys.add(logKey);

  const baseMessage = `Production rate limiting backend failed for namespace="${namespace}" reason="${reason}". TODO: ${RATE_LIMIT_FAIL_OPEN_TODO}.`;
  if (error) {
    console.warn(baseMessage, error);
    return;
  }

  console.warn(baseMessage);
}

function productionConfigurationResponse() {
  logMissingProductionConfig();

  return new Response(
    JSON.stringify({
      error: {
        message: "Rate limiting is not configured for production.",
      },
    }),
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    },
  );
}

function rateLimitedResponse(decision: RateLimitDecision) {
  return new Response(
    JSON.stringify({
      error: {
        message: DEFAULT_RATE_LIMIT_ERROR_MESSAGE,
      },
    }),
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, decision.retryAfter)),
        "X-RateLimit-Limit": String(decision.limit),
        "X-RateLimit-Remaining": String(Math.max(0, decision.remaining)),
        "Content-Type": "application/json",
      },
    },
  );
}


/**
 * Development-only token bucket implementation.
 */
function isWithinMemoryRateLimit(
  clientId: string,
  config: RateLimitConfig,
): RateLimitDecision {
  const now = Date.now() / 1000;
  const bucket = store[clientId];

  if (!bucket) {
    store[clientId] = {
      tokens: config.requests - 1,
      lastRefill: now,
    };
    return {
      allowed: true,
      limit: config.requests,
      remaining: config.requests - 1,
      retryAfter: config.window,
    };
  }

  const timePassed = now - bucket.lastRefill;
  const tokensToAdd = (timePassed / config.window) * config.requests;

  bucket.tokens = Math.min(config.requests, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      limit: config.requests,
      remaining: Math.floor(bucket.tokens),
      retryAfter: config.window,
    };
  }

  const secondsUntilNextToken = Math.ceil(
    (1 - bucket.tokens) * (config.window / config.requests),
  );
  return {
    allowed: false,
    limit: config.requests,
    remaining: 0,
    retryAfter: Math.max(1, secondsUntilNextToken),
  };
}

async function checkRateLimit(
  namespace: string,
  clientId: string,
  config: RateLimitConfig,
): Promise<RateLimitDecision | { productionFailure: ProductionFailureReason }> {
  // Skip rate limiting on localhost for E2E testing
  if (isLocalhost()) {
    return {
      allowed: true,
      limit: config.requests,
      remaining: config.requests - 1,
      retryAfter: config.window,
    };
  }

  let redis: Redis | null = null;
  try {
    redis = getRedisClient();
  } catch (error) {
    if (isProduction()) {
      logProductionRateLimitBackendFailure(namespace, "init-error", error);
      return { productionFailure: "init-error" };
    }
  }

  if (redis) {
    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const windowBucket = Math.floor(nowSeconds / config.window);
      const key = `modon-school:rate-limit:${namespace}:${windowBucket}:${clientId}`;
      const current = await redis.incr(key);

      if (current === 1) {
        await redis.expire(key, config.window);
      }

      const ttl = await redis.ttl(key);
      const retryAfter =
        typeof ttl === "number" && ttl > 0 ? ttl : config.window;

      return {
        allowed: current <= config.requests,
        limit: config.requests,
        remaining: Math.max(0, config.requests - current),
        retryAfter,
      };
    } catch (error) {
      if (isProduction()) {
        logProductionRateLimitBackendFailure(namespace, "runtime-error", error);
        return { productionFailure: "runtime-error" };
      }
    }
  }

  if (isProduction()) {
    return { productionFailure: "missing-config" };
  }

  return isWithinMemoryRateLimit(clientId, config);
}

/**
 * Check if request is within rate limit.
 *
 * This synchronous compatibility helper is development-only because production
 * rate limiting must use Redis-backed async storage.
 */
export function isWithinRateLimit(
  clientId: string,
  config: RateLimitConfig,
): boolean {
  if (isProduction()) {
    if (!hasUpstashConfig()) {
      logMissingProductionConfig();
    }
    throw new Error(
      "Synchronous in-memory rate limiting is not allowed in production.",
    );
  }

  return isWithinMemoryRateLimit(clientId, config).allowed;
}

/**
 * Middleware for rate limiting
 * Use this in API routes to enforce rate limits
 */
export async function rateLimitMiddleware(
  req: NextRequest,
  limits: (typeof RATE_LIMIT_CONFIG)[keyof typeof RATE_LIMIT_CONFIG] = RATE_LIMIT_CONFIG.API_ENDPOINT,
): Promise<{
  ok: boolean;
  clientId: string;
  status?: number;
  message?: string;
}> {
  const clientId = getRateLimitClientIp(req);
  let decision = await checkRateLimit("middleware", clientId, limits);

  if ("productionFailure" in decision) {
    // Single-process deployment: fall back to the in-memory limiter instead of
    // rejecting every request with 503 when Redis is unavailable.
    decision = isWithinMemoryRateLimit(clientId, limits);
  }

  if (!decision.allowed) {
    return {
      ok: false,
      clientId,
      status: 429,
      message: "تم تجاوز حد الطلبات المسموح. يرجى المحاولة لاحقاً.",
    };
  }

  return {
    ok: true,
    clientId,
  };
}

/**
 * Get current development rate limit status for debugging.
 */
export function getRateLimitStatus(clientId: string) {
  return store[clientId] || null;
}

/**
 * Reset rate limits for a specific client in the development memory store.
 */
export function resetRateLimit(clientId: string) {
  delete store[clientId];
}

/**
 * Cleanup old development entries.
 */
export function cleanupRateLimits() {
  const now = Date.now() / 1000;
  const maxAge = 3600; // 1 hour

  for (const clientId in store) {
    if (now - store[clientId].lastRefill > maxAge) {
      delete store[clientId];
    }
  }
}

// Memory store is also used as the production fallback limiter, so the
// cleanup interval must run in every environment to bound its size.
if (typeof setInterval !== "undefined") {
  setInterval(cleanupRateLimits, 10 * 60 * 1000).unref?.();
}

// Cloudflare edge ranges (https://www.cloudflare.com/ips/). A request that
// really came through Cloudflare reaches nginx from one of these addresses;
// only then is its CF-Connecting-IP header Cloudflare's, not the client's.
const CLOUDFLARE_CIDRS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = BigInt(0);
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << BigInt(8)) | BigInt(octet);
  }
  return value;
}

function parseIpv6(ip: string): bigint | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let value = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << BigInt(16)) | BigInt(parseInt(group, 16));
  }
  return value;
}

function parseIp(raw: string): { version: 4 | 6; value: bigint } | null {
  const ip = raw.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  const v4 = parseIpv4(ip);
  if (v4 !== null) return { version: 4, value: v4 };
  const v6 = parseIpv6(ip);
  if (v6 !== null) return { version: 6, value: v6 };
  return null;
}

const PARSED_CLOUDFLARE_CIDRS = CLOUDFLARE_CIDRS.map((cidr) => {
  const [base, bits] = cidr.split("/");
  const parsed = parseIp(base)!;
  const width = parsed.version === 4 ? 32 : 128;
  const shift = BigInt(width - Number(bits));
  return { version: parsed.version, prefix: parsed.value >> shift, shift };
});

export function isCloudflareIp(ip: string): boolean {
  const parsed = parseIp(ip);
  if (!parsed) return false;
  return PARSED_CLOUDFLARE_CIDRS.some(
    (range) =>
      range.version === parsed.version &&
      parsed.value >> range.shift === range.prefix,
  );
}

function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ip = raw.trim();
  return parseIp(ip) ? ip : null;
}

/**
 * Resolves the client IP without trusting headers the client can forge.
 *
 * nginx (deploy/hetzner) overwrites X-Real-IP with the TCP peer address, so
 * it cannot be spoofed. When that peer is a Cloudflare edge, the real client
 * is in CF-Connecting-IP; otherwise the peer itself is the client, and a
 * CF-Connecting-IP header was sent by the client (e.g. by hitting the origin
 * directly) and is ignored. X-Forwarded-For's leftmost entry is
 * client-controlled and is only used when no proxy header exists at all
 * (local development).
 */
export function getRateLimitClientIp(req: NextRequest): string {
  const peerIp = normalizeIp(req.headers.get("x-real-ip"));
  if (peerIp) {
    if (isCloudflareIp(peerIp)) {
      return normalizeIp(req.headers.get("cf-connecting-ip")) ?? peerIp;
    }
    return peerIp;
  }

  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  return normalizeIp(forwarded.split(",")[0]) ?? "unknown";
}

export function normalizeRateLimitEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

function hashRateLimitValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildAuthRateLimitIdentifier(
  req: NextRequest,
  email: string | null | undefined,
) {
  const normalizedEmail = normalizeRateLimitEmail(email);
  const ip = getRateLimitClientIp(req) || "unknown";
  const emailHash = normalizedEmail
    ? hashRateLimitValue(normalizedEmail).slice(0, 24)
    : "anon";
  return `${ip}:${emailHash}`;
}

// Keyed on the account alone, so rotating IPs cannot multiply the number of
// password guesses against one account. Shared by every login endpoint.
export function buildAccountRateLimitIdentifier(
  account: string | null | undefined,
): string | null {
  const normalized = normalizeRateLimitEmail(account)?.replace(/@schoolapp\.local$/, "");
  return normalized ? hashRateLimitValue(normalized).slice(0, 24) : null;
}

export const ACCOUNT_LOGIN_RATE_LIMIT = {
  namespace: "auth-login-account",
  windowMs: 15 * 60_000,
  maxHits: 30,
} as const;

export function getRateLimitOpsSnapshot() {
  return {
    production: isProduction(),
    upstashConfigured: hasUpstashConfig(),
    failOpenEnabled: false,
    memoryFallbackNamespaces: ["*"],
    todo: "Configure Upstash for multi-instance deployments; single-process uses memory fallback.",
  };
}

/**
 * Type definitions for enforceRateLimit
 */
export type RateLimitOptions = {
  namespace: string;
  windowMs: number;
  maxHits: number;
  identifier?: string | null;
  onRateLimited?: {
    error: string;
    message: string;
  };
  productionFailureMode?: ProductionFailureMode;
};

function buildCustomRateLimitedResponse(
  decision: RateLimitDecision,
  payload?: RateLimitOptions["onRateLimited"],
) {
  if (!payload) {
    return rateLimitedResponse(decision);
  }

  return new Response(
    JSON.stringify({
      error: payload.error,
      message: payload.message,
    }),
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, decision.retryAfter)),
        "X-RateLimit-Limit": String(decision.limit),
        "X-RateLimit-Remaining": String(Math.max(0, decision.remaining)),
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * Enforce rate limit (compatible with existing code)
 * Returns null if request is allowed, or Response if rate limited.
 * Never throws — production currently fails open to avoid blocking login if Redis is unavailable.
 */
export async function enforceRateLimit(
  req: NextRequest,
  options: RateLimitOptions,
): Promise<Response | null> {
  try {
    const clientId = options.identifier || getRateLimitClientIp(req);
    const config = {
      requests: options.maxHits,
      window: Math.ceil(options.windowMs / 1000),
    };
    const decision = await checkRateLimit(options.namespace, clientId, config);
    // Default to memory-fallback: this deployment is a single long-lived PM2
    // process, so the in-process token bucket is a real limiter — strictly
    // better than fail-open when Upstash is not configured.
    const productionFailureMode =
      options.productionFailureMode ?? "memory-fallback";

    if ("productionFailure" in decision) {
      if (isProduction()) {
        logProductionRateLimitBackendFailure(
          options.namespace,
          decision.productionFailure,
        );
        if (productionFailureMode === "memory-fallback") {
          const memoryDecision = isWithinMemoryRateLimit(clientId, config);
          if (!memoryDecision.allowed) {
            return buildCustomRateLimitedResponse(
              memoryDecision,
              options.onRateLimited,
            );
          }
          return null;
        }
        if (productionFailureMode === "fail-closed") {
          return buildCustomRateLimitedResponse(
            {
              allowed: false,
              limit: config.requests,
              remaining: 0,
              retryAfter: config.window,
            },
            options.onRateLimited,
          );
        }
        return null;
      }
      return productionConfigurationResponse();
    }

    if (!decision.allowed) {
      return buildCustomRateLimitedResponse(decision, options.onRateLimited);
    }

    return null;
  } catch (error) {
    console.error(
      `enforceRateLimit threw unexpectedly for namespace="${options.namespace}".`,
      error,
    );
    if (
      isProduction() &&
      (options.productionFailureMode ?? "fail-closed") === "fail-closed"
    ) {
      return buildCustomRateLimitedResponse(
        {
          allowed: false,
          limit: options.maxHits,
          remaining: 0,
          retryAfter: Math.ceil(options.windowMs / 1000),
        },
        options.onRateLimited,
      );
    }
    return null;
  }
}
