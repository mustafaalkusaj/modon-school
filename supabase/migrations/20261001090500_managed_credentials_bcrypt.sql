-- =============================================================================
-- managed_user_credentials: password hash algorithm tracking + bcrypt helpers
-- Ported from the sister school-app project 20260618_000005_fix_password_hashing_bcrypt and
-- adapted: modon's application ALREADY hashes with bcrypt (lib/managed-users/
-- credentials.ts, bcryptjs, 10 rounds) and still verifies legacy SHA-256 hashes
-- during a migration window, so this migration does NOT null any stored hash or
-- force a password reset (the sister project's version did). It only records which
-- algorithm each stored hash uses, so legacy rows can be found and retired.
--
-- REVIEW BEFORE APPLYING. Idempotent.
--
-- WHAT THIS DOES
--   1. password_hash_algorithm text NOT NULL DEFAULT 'bcrypt'
--      CHECK in ('sha256','bcrypt'); existing rows are classified from the hash
--      format ($2a/$2b/$2y... = bcrypt, 64 hex chars = sha256). A BEFORE
--      INSERT/UPDATE trigger keeps it correct without any app change.
--   2. Re-adds temporary_password_plain (text, nullable). 20260620220000 dropped
--      it, but lib/managed-users/credentials.ts upserts it again (AES-GCM sealed
--      by lib/managed-users/password-vault.ts, format 'enc:v1:...'). A CHECK
--      constraint guarantees the column can only ever hold sealed values or
--      NULL, never plaintext. Any non-sealed value already present is scrubbed.
--   3. private.hash_temporary_password(text) / private.verify_temporary_password(text, text):
--      pgcrypto bcrypt helpers (crypt + gen_salt('bf', 10)) for DB-side flows
--      and scripts. They are NOT in an exposed schema and are executable by
--      service_role only. SHA-256 is never produced.
--
-- To retire legacy hashes later:
--   SELECT auth_user_id FROM public.managed_user_credentials
--    WHERE password_hash_algorithm = 'sha256';
-- and reset those accounts from the dashboard.
--
-- APPLY ORDER: after 20261001090100 (needs the `private` schema).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.managed_user_credentials') IS NULL THEN
    RAISE NOTICE 'managed_user_credentials missing - migration skipped';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.managed_user_credentials
             ADD COLUMN IF NOT EXISTS password_hash_algorithm text NOT NULL DEFAULT ''bcrypt''';

  -- Classify what is already stored.
  EXECUTE $q$
    UPDATE public.managed_user_credentials
       SET password_hash_algorithm = CASE
             WHEN temporary_password_hash ~ '^\$2[abxy]\$' THEN 'bcrypt'
             WHEN temporary_password_hash ~ '^[0-9a-fA-F]{64}$' THEN 'sha256'
             ELSE password_hash_algorithm
           END
     WHERE temporary_password_hash IS NOT NULL
  $q$;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.managed_user_credentials'::regclass
       AND conname = 'managed_user_credentials_password_hash_algorithm_check'
  ) THEN
    EXECUTE 'ALTER TABLE public.managed_user_credentials
               ADD CONSTRAINT managed_user_credentials_password_hash_algorithm_check
               CHECK (password_hash_algorithm IN (''sha256'', ''bcrypt''))';
  END IF;

  -- Sealed-only temporary_password_plain.
  EXECUTE 'ALTER TABLE public.managed_user_credentials
             ADD COLUMN IF NOT EXISTS temporary_password_plain text';
  EXECUTE $q$
    UPDATE public.managed_user_credentials
       SET temporary_password_plain = NULL
     WHERE temporary_password_plain IS NOT NULL
       AND temporary_password_plain NOT LIKE 'enc:v1:%'
  $q$;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.managed_user_credentials'::regclass
       AND conname = 'managed_user_credentials_plain_is_sealed_check'
  ) THEN
    EXECUTE $q$
      ALTER TABLE public.managed_user_credentials
        ADD CONSTRAINT managed_user_credentials_plain_is_sealed_check
        CHECK (temporary_password_plain IS NULL OR temporary_password_plain LIKE 'enc:v1:%')
    $q$;
  END IF;

  EXECUTE $q$COMMENT ON COLUMN public.managed_user_credentials.temporary_password_hash IS
    'Hash of the temporary password. New values are bcrypt (crypt/gen_salt(''bf'',10) or bcryptjs). Legacy SHA-256 values are flagged in password_hash_algorithm and must be reset.'$q$;
  EXECUTE $q$COMMENT ON COLUMN public.managed_user_credentials.password_hash_algorithm IS
    'bcrypt for current hashes, sha256 for legacy hashes awaiting reset. Maintained by trigger from the hash prefix.'$q$;
  EXECUTE $q$COMMENT ON COLUMN public.managed_user_credentials.temporary_password_plain IS
    'AES-256-GCM sealed temporary password (enc:v1:...), printable on account cards. Never plaintext (CHECK).'$q$;
END $$;

CREATE OR REPLACE FUNCTION public.managed_credentials_set_hash_algorithm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.temporary_password_hash IS NOT NULL THEN
    NEW.password_hash_algorithm := CASE
      WHEN NEW.temporary_password_hash ~ '^\$2[abxy]\$' THEN 'bcrypt'
      ELSE 'sha256'
    END;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.managed_credentials_set_hash_algorithm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.managed_credentials_set_hash_algorithm() TO service_role;

DO $$
BEGIN
  IF to_regclass('public.managed_user_credentials') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_managed_credentials_hash_algorithm ON public.managed_user_credentials';
    EXECUTE 'CREATE TRIGGER trg_managed_credentials_hash_algorithm
               BEFORE INSERT OR UPDATE OF temporary_password_hash ON public.managed_user_credentials
               FOR EACH ROW EXECUTE FUNCTION public.managed_credentials_set_hash_algorithm()';
  END IF;
END $$;

-- bcrypt helpers (pgcrypto lives in the `extensions` schema on Supabase).
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.hash_temporary_password(p_password text)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = extensions, pg_temp
AS $function$
  SELECT crypt(p_password, gen_salt('bf', 10));
$function$;

CREATE OR REPLACE FUNCTION private.verify_temporary_password(p_password text, p_hash text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = extensions, pg_temp
AS $function$
  SELECT p_hash IS NOT NULL
     AND p_hash ~ '^\$2[abxy]\$'
     AND crypt(p_password, p_hash) = p_hash;
$function$;

REVOKE ALL ON FUNCTION private.hash_temporary_password(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.verify_temporary_password(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.hash_temporary_password(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.verify_temporary_password(text, text) TO service_role;
