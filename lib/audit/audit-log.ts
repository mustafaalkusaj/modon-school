import "server-only";

import { isMissingTableError } from "@/lib/admin-infrastructure";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

// Server-side audit trail helpers backed by public.audit_logs. Unlike
// lib/audit.ts (browser client, current user only), these run with the
// service role so API routes, cron jobs and the ops bot can record who did
// what on behalf of any actor.

export interface AuditLogEntry {
  actor_user_id?: string | null;
  actor_role?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  actor_source?: string | null;
  action_type: string;
  entity_type: string;
  entity_id?: string | null;
  summary: string;
  school_id?: string | null;
  branch_id?: string | null;
  metadata?: Record<string, unknown> | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

export interface AuditLogFilters {
  limit?: number;
  action_type?: string;
  entity_type?: string;
  school_id?: string | null;
  branch_id?: string | null;
}

export interface AuditLogRecord {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_source: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  school_id: string | null;
  branch_id: string | null;
  metadata: unknown;
}

const AUDIT_LOG_COLUMNS =
  "id, created_at, actor_user_id, actor_role, actor_name, actor_email, actor_source, action_type, entity_type, entity_id, summary, school_id, branch_id, metadata";

const MAX_LIMIT = 200;

// x-forwarded-for may carry a proxy chain; only the first hop is the client.
function firstForwardedIp(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.split(",")[0]?.trim() || null;
}

/**
 * Records an audit event. Never throws: auditing must not break the action
 * being audited, so failures are logged and swallowed.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = createServiceSupabaseClient();
    const { error } = await supabase.from("audit_logs").insert({
      actor_id: entry.actor_user_id ?? null,
      actor_user_id: entry.actor_user_id ?? null,
      actor_role: entry.actor_role ?? null,
      actor_name: entry.actor_name ?? null,
      actor_email: entry.actor_email ?? null,
      actor_source: entry.actor_source ?? "app",
      action: entry.action_type,
      action_type: entry.action_type,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      summary: entry.summary,
      school_id: entry.school_id ?? null,
      branch_id: entry.branch_id ?? null,
      metadata: (entry.metadata ?? {}) as never,
      ip_address: firstForwardedIp(entry.ip_address),
      user_agent: entry.user_agent ?? null,
    });

    if (error && !isMissingTableError(error, "audit_logs")) {
      console.error("[audit-log] insert failed:", error.message);
    }
  } catch (error) {
    console.error("[audit-log] write error:", error);
  }
}

/** Returns the most recent audit events, newest first. */
export async function getRecentAuditLogs(
  filters: AuditLogFilters = {},
): Promise<AuditLogRecord[]> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? 20));
  const supabase = createServiceSupabaseClient();

  let query = supabase
    .from("audit_logs")
    .select(AUDIT_LOG_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.action_type) query = query.eq("action_type", filters.action_type);
  if (filters.entity_type) query = query.eq("entity_type", filters.entity_type);
  if (filters.school_id) query = query.eq("school_id", filters.school_id);
  if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error, "audit_logs")) return [];
    throw error;
  }
  return (data ?? []) as AuditLogRecord[];
}
