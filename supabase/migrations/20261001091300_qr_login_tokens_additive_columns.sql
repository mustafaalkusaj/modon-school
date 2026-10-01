-- =============================================================================
-- qr_login_tokens: the sister project-compatible columns, ADDITIVE ONLY
-- Source: the sister school-app project 20260910161758_create_qr_login_tokens.
--
-- REVIEW BEFORE APPLYING. Idempotent and strictly additive: modon's existing
-- columns and semantics (user_id, school_id, token, expires_at, used_at,
-- created_at; lib/qr-tokens.ts) are untouched. No existing column is dropped,
-- renamed, retyped or made NOT NULL.
--
-- WHAT THIS DOES
--   * Creates the table with modon's shape if (and only if) it does not exist
--     (no earlier migration creates it; production has it).
--   * Adds: auth_user_id, account_type ('student' | 'teacher' | 'admin'),
--     created_by, is_active (default true), last_used_at.
--   * Keeps the two identity columns interchangeable: a BEFORE INSERT/UPDATE
--     trigger fills auth_user_id from user_id (and the reverse), and stamps
--     last_used_at whenever used_at is set. Modon's code keeps writing user_id /
--     used_at; the sister project-style code writing auth_user_id / last_used_at also works.
--   * Back-fills auth_user_id from user_id for existing rows.
--   * The sister project's indexes (active token lookup, school+type listing, per-user).
--   * RLS stays enabled with NO policies and no anon/authenticated grants:
--     only the service client touches this table (secrets), see
--     20260924220000_tenant_isolation_rls.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.qr_login_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text        NOT NULL UNIQUE,
  user_id     uuid        NOT NULL,
  school_id   uuid        NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qr_login_tokens
  ADD COLUMN IF NOT EXISTS auth_user_id uuid,
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.qr_login_tokens'::regclass
       AND conname = 'qr_login_tokens_account_type_check'
  ) THEN
    ALTER TABLE public.qr_login_tokens
      ADD CONSTRAINT qr_login_tokens_account_type_check
      CHECK (account_type IS NULL OR account_type IN ('student', 'teacher', 'admin'));
  END IF;
END $$;

UPDATE public.qr_login_tokens
   SET auth_user_id = user_id
 WHERE auth_user_id IS NULL
   AND user_id IS NOT NULL;

UPDATE public.qr_login_tokens
   SET last_used_at = used_at
 WHERE last_used_at IS NULL
   AND used_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.qr_login_tokens_sync_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.auth_user_id := COALESCE(NEW.auth_user_id, NEW.user_id);
  NEW.user_id := COALESCE(NEW.user_id, NEW.auth_user_id);
  IF NEW.used_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.used_at IS DISTINCT FROM OLD.used_at) THEN
    NEW.last_used_at := NEW.used_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.qr_login_tokens_sync_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qr_login_tokens_sync_columns() TO service_role;

DROP TRIGGER IF EXISTS trg_qr_login_tokens_sync_columns ON public.qr_login_tokens;
CREATE TRIGGER trg_qr_login_tokens_sync_columns
  BEFORE INSERT OR UPDATE ON public.qr_login_tokens
  FOR EACH ROW EXECUTE FUNCTION public.qr_login_tokens_sync_columns();

CREATE INDEX IF NOT EXISTS idx_qr_login_tokens_token_active
  ON public.qr_login_tokens (token) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_qr_login_tokens_school_type
  ON public.qr_login_tokens (school_id, account_type);
CREATE INDEX IF NOT EXISTS idx_qr_login_tokens_auth_user
  ON public.qr_login_tokens (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_qr_login_tokens_user
  ON public.qr_login_tokens (user_id);

ALTER TABLE public.qr_login_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qr_login_tokens FROM anon, authenticated;
