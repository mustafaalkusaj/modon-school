-- =============================================================================
-- audit_logs append-only + log_audit_action
-- Ported from the sister school-app project 20260427_000000_audit_logs_append_only and the
-- log_audit_action / prevent_audit_log_modification functions of its baseline.
--
-- REVIEW BEFORE APPLYING. Idempotent. Safe on a live database:
--   * Existing rows are never touched.
--   * After this migration UPDATE / DELETE / TRUNCATE on public.audit_logs are
--     rejected for EVERY role, including service_role (tamper-evident log).
--     Application code only ever INSERTs/SELECTs audit_logs (checked: lib/audit*,
--     year-end claim, activity-log readers).
--
-- TWO NARROW ESCAPE HATCHES (both need the DB owner role, so PostgREST /
-- service_role cannot use them):
--   * app.audit_logs_deidentify = 'on'  -> an UPDATE is allowed only if it
--     changes nothing but actor_name / actor_email / ip_address / user_agent.
--     Used by public.execute_account_deletion_erasure() so GDPR/Apple erasure
--     can de-identify the actor without deleting the audit trail.
--   * app.audit_logs_maintenance = 'on' -> DELETE allowed, for a deliberate
--     operator action (e.g. releasing the year-end run claim that
--     app/api/web/year-end/execute documents as "removed deliberately"):
--         BEGIN;
--         SELECT set_config('app.audit_logs_maintenance', 'on', true);
--         DELETE FROM public.audit_logs WHERE ... ;
--         COMMIT;
--
-- APPLY ORDER: independent; before 20261001091200 (account deletion pipeline).
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE NOTICE 'public.audit_logs missing - append-only triggers skipped';
    RETURN;
  END IF;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.audit_logs_block_update()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $body$
    DECLARE
      v_masked text[] := ARRAY['actor_name', 'actor_email', 'ip_address', 'user_agent'];
    BEGIN
      IF current_setting('app.audit_logs_deidentify', true) = 'on'
         AND current_user IN ('postgres', 'supabase_admin')
         AND (to_jsonb(NEW) - v_masked) = (to_jsonb(OLD) - v_masked) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'audit_logs is append-only: UPDATE not allowed'
        USING ERRCODE = '42501';
    END;
    $body$
  $f$;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.audit_logs_block_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $body$
    BEGIN
      IF current_setting('app.audit_logs_maintenance', true) = 'on'
         AND current_user IN ('postgres', 'supabase_admin') THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'audit_logs is append-only: DELETE not allowed'
        USING ERRCODE = '42501';
    END;
    $body$
  $f$;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.audit_logs_block_truncate()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $body$
    BEGIN
      RAISE EXCEPTION 'audit_logs is append-only: TRUNCATE not allowed'
        USING ERRCODE = '42501';
    END;
    $body$
  $f$;

  EXECUTE 'DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs';
  EXECUTE 'CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON public.audit_logs
             FOR EACH ROW EXECUTE FUNCTION public.audit_logs_block_update()';

  EXECUTE 'DROP TRIGGER IF EXISTS audit_logs_no_delete ON public.audit_logs';
  EXECUTE 'CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON public.audit_logs
             FOR EACH ROW EXECUTE FUNCTION public.audit_logs_block_delete()';

  EXECUTE 'DROP TRIGGER IF EXISTS audit_logs_no_truncate ON public.audit_logs';
  EXECUTE 'CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON public.audit_logs
             FOR EACH STATEMENT EXECUTE FUNCTION public.audit_logs_block_truncate()';

  EXECUTE 'REVOKE ALL ON FUNCTION public.audit_logs_block_update() FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.audit_logs_block_delete() FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.audit_logs_block_truncate() FROM PUBLIC, anon, authenticated';

  EXECUTE $c$COMMENT ON TABLE public.audit_logs IS
    'Append-only audit log. UPDATE/DELETE/TRUNCATE are blocked by triggers (see migration 20261001090400).'$c$;
END $$;

-- -----------------------------------------------------------------------------
-- log_audit_action(): writes to the legacy public.audit_log table. Callable by
-- admins/super_admins (own session) or the service role; not exposed to
-- anon/authenticated through the Data API (REVOKE below) - it is invoked from
-- other SECURITY DEFINER functions such as soft_delete_student().
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE NOTICE 'public.audit_log missing - log_audit_action skipped';
    RETURN;
  END IF;

  EXECUTE 'DROP FUNCTION IF EXISTS public.log_audit_action(character varying, character varying, uuid, jsonb, jsonb, text)';

  EXECUTE $f$
    CREATE FUNCTION public.log_audit_action(
      p_action character varying,
      p_resource_type character varying,
      p_resource_id uuid,
      p_old_value jsonb DEFAULT NULL,
      p_new_value jsonb DEFAULT NULL,
      p_error_message text DEFAULT NULL
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    BEGIN
      IF COALESCE(auth.role(), '') <> 'service_role'
         AND COALESCE(public.current_app_role(), '') NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'insufficient_privilege: log_audit_action requires admin role';
      END IF;

      INSERT INTO public.audit_log
        (user_id, action, resource_type, resource_id, old_value, new_value, status, error_message)
      VALUES (
        auth.uid(), p_action, p_resource_type, p_resource_id, p_old_value, p_new_value,
        CASE WHEN p_error_message IS NULL THEN 'success' ELSE 'error' END, p_error_message
      );
    END;
    $body$
  $f$;

  EXECUTE 'REVOKE ALL ON FUNCTION public.log_audit_action(character varying, character varying, uuid, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.log_audit_action(character varying, character varying, uuid, jsonb, jsonb, text) TO service_role';
END $$;
