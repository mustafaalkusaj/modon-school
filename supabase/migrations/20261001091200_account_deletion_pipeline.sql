-- =============================================================================
-- Account-deletion execution pipeline (queue consumer)
-- Ported from the sister school-app project 20260729093000_account_deletion_pipeline and
-- adapted to modon. Builds on 20260925000000_account_deletion_requests.sql
-- (modon already has the table, lifecycle columns, status check and a retention
-- trigger).
--
-- REVIEW BEFORE APPLYING. Idempotent. The application ALREADY calls
-- public.execute_account_deletion_erasure() (lib/account-deletion/
-- supabase-gateway.ts, cron /api/cron/account-deletion); until this runs every
-- deletion attempt fails at that RPC.
--
-- WHAT THIS DOES
--   1. account_deletion_requests.attempt_count (retry bookkeeping).
--   2. public.account_deletion_retention_deadline(timestamptz): +7 business days
--      (Fri/Sat weekend, evaluated in UTC - same rule as modon's original
--      trigger and lib/account-deletion/policy.ts computeRetentionDeadline) and
--      public.account_deletion_set_deadline() trigger function; the BEFORE
--      INSERT trigger is re-pointed at it (single definition of the rule) and
--      any NULL retention_deadline is back-filled.
--   3. The "one open request per user" unique index now also covers the
--      in-flight states processing / failed, so a second request cannot be filed
--      while one is being processed or retried (skipped with a NOTICE if
--      existing rows would violate it; the old index stays).
--   4. public.execute_account_deletion_erasure(): the whole erasure in ONE
--      transaction (a partial erasure is never observable):
--        HARD DELETE   push subscriptions, notifications, authored messages,
--                      conversation membership, messaging blocks, behaviour
--                      logs, parent links, QR login tokens, managed credentials,
--                      permission overrides, branch scopes, identity rows
--                      (managed_user_profiles, user_profiles, users).
--        ANONYMIZE     the student / teacher row (name -> token, every contact
--                      and identity field NULL, status deleted / inactive), and
--                      null the free text of payments, attendance and grades.
--        RETAIN        the financial ledger (school accounting), de-identified.
--        DE-IDENTIFY   messaging_reports (reporter/reported ids and snapshot) and
--                      audit_logs (actor name/email/ip/user agent) - the append-
--                      only audit trail is kept; the UPDATE is allowed only
--                      through the narrow escape hatch defined in
--                      20261001090400_audit_logs_append_only.
--      Idempotent: an already 'completed' request returns
--      {"already_completed": true} and touches nothing.
--      service_role only (REVOKEd from everyone else).
--
-- APPLY ORDER: after 20261001090400 (audit hatch) - it also works before it,
-- the audit de-identification then simply runs without a trigger in the way.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. lifecycle bookkeeping
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.account_deletion_requests') IS NULL THEN
    RAISE NOTICE 'account_deletion_requests missing (apply 20260925000000 first) - pipeline migration skipped';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.account_deletion_requests
             ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
             ADD COLUMN IF NOT EXISTS failure_reason text,
             ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
             ADD COLUMN IF NOT EXISTS erasure_summary jsonb';
END $$;

-- -----------------------------------------------------------------------------
-- 2. retention deadline (7 business days, Fri/Sat weekend, UTC)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_deletion_retention_deadline(p_requested_at timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_cursor    timestamp := p_requested_at AT TIME ZONE 'UTC';
  v_remaining integer := 7;
BEGIN
  WHILE v_remaining > 0 LOOP
    v_cursor := v_cursor + interval '1 day';
    -- 5 = Friday, 6 = Saturday
    IF extract(dow FROM v_cursor) NOT IN (5, 6) THEN
      v_remaining := v_remaining - 1;
    END IF;
  END LOOP;
  RETURN v_cursor AT TIME ZONE 'UTC';
END;
$function$;

CREATE OR REPLACE FUNCTION public.account_deletion_set_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.retention_deadline IS NULL THEN
    NEW.retention_deadline :=
      public.account_deletion_retention_deadline(COALESCE(NEW.requested_at, now()));
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.account_deletion_retention_deadline(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_set_deadline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_retention_deadline(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_set_deadline() TO service_role;

DO $$
BEGIN
  IF to_regclass('public.account_deletion_requests') IS NULL THEN
    RETURN;
  END IF;

  -- Replace modon's original trigger (same rule, now one definition).
  EXECUTE 'DROP TRIGGER IF EXISTS trg_account_deletion_requests_retention_deadline ON public.account_deletion_requests';
  EXECUTE 'DROP TRIGGER IF EXISTS account_deletion_requests_set_deadline ON public.account_deletion_requests';
  EXECUTE 'CREATE TRIGGER account_deletion_requests_set_deadline
             BEFORE INSERT ON public.account_deletion_requests
             FOR EACH ROW EXECUTE FUNCTION public.account_deletion_set_deadline()';
  EXECUTE 'DROP FUNCTION IF EXISTS public.account_deletion_requests_set_retention_deadline()';

  EXECUTE 'UPDATE public.account_deletion_requests
              SET retention_deadline = public.account_deletion_retention_deadline(requested_at)
            WHERE retention_deadline IS NULL AND requested_at IS NOT NULL';

  -- 3. One in-flight request per user, including processing / failed.
  IF EXISTS (
    SELECT 1
      FROM public.account_deletion_requests
     WHERE auth_user_id IS NOT NULL
       AND status IN ('pending', 'in_review', 'verified', 'processing', 'failed')
     GROUP BY auth_user_id
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'several in-flight deletion requests exist for one user - extended unique index skipped';
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_one_active_idx
               ON public.account_deletion_requests (auth_user_id)
               WHERE auth_user_id IS NOT NULL
                 AND status IN (''pending'', ''in_review'', ''verified'', ''processing'', ''failed'')';
    EXECUTE 'DROP INDEX IF EXISTS public.uq_account_deletion_requests_open_per_user';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Atomic erasure
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.execute_account_deletion_erasure(uuid, uuid, uuid, uuid, text);

CREATE FUNCTION public.execute_account_deletion_erasure(
  p_request_id uuid,
  p_auth_user_id uuid,
  p_student_id uuid,
  p_teacher_id uuid,
  p_anonymization_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status   text;
  v_affected jsonb := '{}'::jsonb;
  v_count    integer;
BEGIN
  SELECT r.status INTO v_status
    FROM public.account_deletion_requests AS r
   WHERE r.id = p_request_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account deletion request % not found', p_request_id;
  END IF;

  IF v_status = 'completed' THEN
    RETURN jsonb_build_object(
      'already_completed', true,
      'anonymization_token', p_anonymization_token,
      'affected', '{}'::jsonb
    );
  END IF;

  -- ---- A. HARD DELETE ---------------------------------------------------------
  IF p_auth_user_id IS NOT NULL THEN
    DELETE FROM public.user_push_subscriptions WHERE user_id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('user_push_subscriptions', v_count);

    DELETE FROM public.notifications WHERE user_id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('notifications', v_count);

    DELETE FROM public.messages WHERE sender_id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('messages', v_count);

    DELETE FROM public.conversation_participants WHERE user_id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('conversation_participants', v_count);

    IF to_regclass('public.messaging_blocks') IS NOT NULL THEN
      DELETE FROM public.messaging_blocks
       WHERE blocker_user_id = p_auth_user_id OR blocked_user_id = p_auth_user_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_affected := v_affected || jsonb_build_object('messaging_blocks', v_count);
    END IF;

    DELETE FROM public.parent_student_links WHERE parent_user_id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('parent_student_links', v_count);

    DELETE FROM public.qr_login_tokens WHERE user_id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('qr_login_tokens', v_count);

    DELETE FROM public.managed_user_credentials WHERE auth_user_id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('managed_user_credentials', v_count);

    DELETE FROM public.user_perm_overrides WHERE user_id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('user_perm_overrides', v_count);

    DELETE FROM public.admin_branch_scopes WHERE user_id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('admin_branch_scopes', v_count);
  END IF;

  IF p_student_id IS NOT NULL THEN
    DELETE FROM public.behavior_logs WHERE student_id = p_student_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('behavior_logs', v_count);
  END IF;

  -- ---- B. ANONYMIZE -----------------------------------------------------------
  IF p_student_id IS NOT NULL THEN
    UPDATE public.students SET
      full_name = p_anonymization_token,
      phone = NULL, phone2 = NULL,
      guardian_name = NULL, guardian_phone = NULL,
      parent_name = NULL, parent_phone = NULL,
      address = NULL, date_of_birth = NULL, gender = NULL,
      photo_url = NULL, registration_number = NULL,
      previous_school = NULL, prev_school = NULL,
      auth_user_id = NULL,
      status = 'deleted',
      deleted_at = COALESCE(deleted_at, now()),
      updated_at = now()
    WHERE id = p_student_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('students', v_count);

    -- students.personal_email exists on the live database but in no migration
    -- file, so it is cleared dynamically (skipped if the column is absent).
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'personal_email'
    ) THEN
      EXECUTE 'UPDATE public.students SET personal_email = NULL WHERE id = $1' USING p_student_id;
    END IF;

    -- Financial rows are RETAINED (school accounting); only free text goes.
    UPDATE public.payments SET notes = NULL WHERE student_id = p_student_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('payments_notes_cleared', v_count);

    UPDATE public.attendance_records SET note = NULL WHERE student_id = p_student_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('attendance_notes_cleared', v_count);

    UPDATE public.grades SET note = NULL WHERE student_id = p_student_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('grades_notes_cleared', v_count);
  END IF;

  IF p_teacher_id IS NOT NULL THEN
    UPDATE public.teachers SET
      full_name = p_anonymization_token,
      first_name_ar = NULL, second_name_ar = NULL, third_name_ar = NULL,
      last_name_ar = NULL, first_name_en = NULL, last_name_en = NULL,
      phone = NULL, phone_secondary = NULL,
      email = NULL, email_personal = NULL, email_work = NULL,
      national_id = NULL, national_id_expiry = NULL,
      address = NULL, city = NULL, nationality = NULL,
      date_of_birth = NULL, gender = NULL, marital_status = NULL,
      blood_type = NULL, photo = NULL,
      bank_name = NULL, bank_account = NULL,
      emergency_contact_name = NULL, emergency_contact_phone = NULL,
      emergency_contact_relation = NULL,
      app_username = NULL, app_password_hash = NULL,
      notes = NULL,
      auth_user_id = NULL,
      is_active = false,
      updated_at = now()
    WHERE id = p_teacher_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('teachers', v_count);

    UPDATE public.assignments SET
      description = NULL,
      attachment_bucket = NULL, attachment_path = NULL,
      attachment_name = NULL, attachment_mime_type = NULL,
      attachment_size_bytes = NULL,
      updated_at = now()
    WHERE teacher_id = p_teacher_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('assignments_scrubbed', v_count);
  END IF;

  IF p_auth_user_id IS NOT NULL THEN
    -- Moderation evidence is retained (store requirement) but de-identified.
    IF to_regclass('public.messaging_reports') IS NOT NULL THEN
      UPDATE public.messaging_reports SET
        reporter_user_id = NULL,
        message_body_snapshot = NULL,
        details = NULL
      WHERE reporter_user_id = p_auth_user_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_affected := v_affected || jsonb_build_object('messaging_reports_reporter', v_count);

      UPDATE public.messaging_reports SET
        reported_user_id = NULL,
        message_body_snapshot = NULL,
        details = NULL
      WHERE reported_user_id = p_auth_user_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_affected := v_affected || jsonb_build_object('messaging_reports_reported', v_count);
    END IF;

    -- audit_logs is append-only; allow only this de-identification (the trigger
    -- verifies that nothing but the four personal columns changes).
    PERFORM set_config('app.audit_logs_deidentify', 'on', true);
    UPDATE public.audit_logs SET
      actor_name = NULL, actor_email = NULL, ip_address = NULL, user_agent = NULL
    WHERE actor_id = p_auth_user_id
       OR actor_user_id = p_auth_user_id::text;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    PERFORM set_config('app.audit_logs_deidentify', 'off', true);
    v_affected := v_affected || jsonb_build_object('audit_logs_deidentified', v_count);

    -- ---- Identity rows last: everything above keys off these ids. -------------
    DELETE FROM public.managed_user_profiles WHERE auth_user_id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('managed_user_profiles', v_count);

    DELETE FROM public.user_profiles WHERE id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('user_profiles', v_count);

    DELETE FROM public.users WHERE id = p_auth_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_affected := v_affected || jsonb_build_object('users', v_count);
  END IF;

  UPDATE public.account_deletion_requests
     SET attempt_count = attempt_count + 1,
         updated_at = now(),
         metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('anonymization_token', p_anonymization_token)
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'already_completed', false,
    'anonymization_token', p_anonymization_token,
    'affected', v_affected
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.execute_account_deletion_erasure(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion_erasure(uuid, uuid, uuid, uuid, text)
  TO service_role;
