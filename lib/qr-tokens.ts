import { randomBytes } from "crypto";
import QRCode from "qrcode";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export interface QrLoginToken {
  id: string;
  token: string;
  user_id: string;
  school_id: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

const QR_TOKEN_LENGTH = 32;
const DEFAULT_EXPIRY_DAYS = 365;

function generateSecureToken(): string {
  return randomBytes(QR_TOKEN_LENGTH).toString("hex");
}

function expiresAt(days = DEFAULT_EXPIRY_DAYS): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export async function createQrLoginToken(params: {
  authUserId: string;
  schoolId: string;
}): Promise<QrLoginToken> {
  const supabase = createServiceSupabaseClient();
  const token = generateSecureToken();

  const { data, error } = await supabase
    .from("qr_login_tokens" as any)
    .insert({
      token,
      user_id: params.authUserId,
      school_id: params.schoolId,
      expires_at: expiresAt(),
    })
    .select()
    .single();

  if (error) throw error;
  return data as unknown as QrLoginToken;
}

export async function findActiveQrToken(
  token: string,
): Promise<QrLoginToken | null> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("qr_login_tokens" as any)
    .select("*")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .is("used_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as QrLoginToken) ?? null;
}

export async function markQrTokenUsed(tokenId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  await supabase
    .from("qr_login_tokens" as any)
    .update({ used_at: new Date().toISOString() })
    .eq("id", tokenId);
}

export async function findQrTokenByUser(
  authUserId: string,
): Promise<QrLoginToken | null> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("qr_login_tokens" as any)
    .select("*")
    .eq("user_id", authUserId)
    .gt("expires_at", new Date().toISOString())
    .is("used_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as QrLoginToken) ?? null;
}

export async function getOrCreateQrToken(params: {
  authUserId: string;
  schoolId: string;
}): Promise<QrLoginToken> {
  const existing = await findQrTokenByUser(params.authUserId);
  if (existing) return existing;
  return createQrLoginToken(params);
}

export async function deactivateQrTokenById(tokenId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  await supabase
    .from("qr_login_tokens" as any)
    .update({ used_at: new Date().toISOString() })
    .eq("id", tokenId);
}

export async function deactivateQrToken(tokenValue: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  await supabase
    .from("qr_login_tokens" as any)
    .update({ used_at: new Date().toISOString() })
    .eq("token", tokenValue);
}

export async function regenerateQrToken(
  tokenId: string,
): Promise<QrLoginToken> {
  const supabase = createServiceSupabaseClient();
  const newToken = generateSecureToken();

  const { data, error } = await supabase
    .from("qr_login_tokens" as any)
    .update({ token: newToken, used_at: null, expires_at: expiresAt() })
    .eq("id", tokenId)
    .select()
    .single();

  if (error) throw error;
  return data as unknown as QrLoginToken;
}

export async function listQrTokensBySchool(
  schoolId: string,
): Promise<QrLoginToken[]> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("qr_login_tokens" as any)
    .select("*")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as unknown as QrLoginToken[]) ?? [];
}

export async function generateQrLoginDataUrl(
  token: string,
): Promise<string | null> {
  try {
    const payload = `https://modon-school.com/ar/qr-login?t=${encodeURIComponent(token)}`;
    return await QRCode.toDataURL(payload, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
    });
  } catch {
    return null;
  }
}

export async function bulkGetOrCreateTokens(
  schoolId: string,
  authUserIds: string[],
): Promise<Map<string, string>> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { data: existing, error: fetchErr } = await supabase
    .from("qr_login_tokens" as any)
    .select("user_id, token")
    .eq("school_id", schoolId)
    .gt("expires_at", now)
    .is("used_at", null)
    .in("user_id", authUserIds);

  if (fetchErr) throw fetchErr;

  const tokenMap = new Map<string, string>();
  for (const row of (existing ?? []) as unknown as Array<{
    user_id: string;
    token: string;
  }>) {
    tokenMap.set(row.user_id, row.token);
  }

  const missing = authUserIds.filter((id) => !tokenMap.has(id));

  if (missing.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const rows = chunk.map((uid) => ({
        token: generateSecureToken(),
        user_id: uid,
        school_id: schoolId,
        expires_at: expiresAt(),
      }));

      const { data: created, error: insertErr } = await supabase
        .from("qr_login_tokens" as any)
        .insert(rows)
        .select("user_id, token");

      if (insertErr) throw insertErr;
      for (const row of (created ?? []) as unknown as Array<{
        user_id: string;
        token: string;
      }>) {
        tokenMap.set(row.user_id, row.token);
      }
    }
  }

  return tokenMap;
}

export async function validateQrToken(
  token: string,
): Promise<{ user_id: string } | null> {
  const row = await findActiveQrToken(token);
  if (!row) return null;
  return { user_id: row.user_id };
}
