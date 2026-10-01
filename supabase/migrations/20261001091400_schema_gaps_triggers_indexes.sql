-- =============================================================================
-- Schema gaps: class_schedules / calendar_events / incomes columns, updated_at
-- triggers, budget integrity triggers, seed_default_roles_for_school, and the
-- missing school_id / branch_id indexes.
-- Ported from the sister school-app project (20260727171233_restore_class_schedules_period_
-- columns, 20260728053142_index_class_schedules_time_slot_fk,
-- 20260518_020000_calendar_events, 20260510_000000_incomes_schema,
-- 20260429_000000_budgets_schema, baseline trigger set, 20260403_010000 and
-- the 20260509_0000xx index migrations) and adapted to modon.
--
-- REVIEW BEFORE APPLYING. Idempotent and defensive: every object is checked
-- for existence first, so it is safe on a live database whose exact state is
-- not known. Operational notes:
--   * CREATE INDEX (non-concurrent) takes a SHARE lock on the table while it
--     builds; the tables are small, but run in a quiet window. An index is only
--     created when the table and columns exist AND no valid index on the table
--     already starts with the same columns (so equivalent live indexes are not
--     duplicated).
--   * The updated_at triggers only touch tables that have an updated_at column,
--     are not generated, and do not already have a BEFORE UPDATE
--     "updated_at/timestamp" trigger.
--
-- 1. class_schedules: period_number, time_slot_id, is_locked. The 2026-06-26
--    migration dropped them but the web schedule UI is built around them, so
--    /api/web/schedule fails without them. Additive, back-filled from
--    schedule_time_slots where start times match.
-- 2. calendar_events: reminder_sent, target_class, target_section.
-- 3. incomes.receipt_image_url.
-- 4. Generic trigger functions + updated_at triggers.
-- 5. Budget integrity triggers (school/branch/budget identity cannot drift).
-- 6. seed_default_roles_for_school(school_id): default role + permission set.
-- 7. Indexes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. class_schedules
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.class_schedules') IS NULL THEN
    RAISE NOTICE 'class_schedules missing - skipped';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.class_schedules
             ADD COLUMN IF NOT EXISTS period_number smallint,
             ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false';

  IF to_regclass('public.schedule_time_slots') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.class_schedules ADD COLUMN IF NOT EXISTS time_slot_id uuid';

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.class_schedules'::regclass
         AND contype = 'f'
         AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'public.class_schedules'::regclass AND attname = 'time_slot_id')]
    ) THEN
      EXECUTE 'ALTER TABLE public.class_schedules ADD CONSTRAINT class_schedules_time_slot_id_fkey
                 FOREIGN KEY (time_slot_id) REFERENCES public.schedule_time_slots (id) ON DELETE SET NULL';
    END IF;

    EXECUTE $c$COMMENT ON COLUMN public.class_schedules.time_slot_id IS
      'Canonical time slot; start_time/end_time are derived from it on write.'$c$;

    -- Back-fill period_number / time_slot_id from the slot whose start time
    -- matches. schedule_time_slots.start_time is text; unparsable values are
    -- simply left unmatched. A failure here must not undo the column additions.
    BEGIN
      EXECUTE $q$
        UPDATE public.class_schedules AS cs
           SET period_number = ts.slot_order,
               time_slot_id  = ts.id
          FROM public.schedule_time_slots AS ts
         WHERE cs.period_number IS NULL
           AND ts.school_id = cs.school_id
           AND ts.start_time ~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
           AND ts.start_time::time = cs.start_time
      $q$;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'class_schedules period back-fill skipped: %', SQLERRM;
    END;
  END IF;

  EXECUTE $c$COMMENT ON COLUMN public.class_schedules.period_number IS
    'Ordinal lesson slot within the day. Mirrors schedule_time_slots.slot_order.'$c$;
  EXECUTE $c$COMMENT ON COLUMN public.class_schedules.is_locked IS
    'Locked cells are pinned by an admin and skipped by schedule regeneration.'$c$;
END $$;

-- -----------------------------------------------------------------------------
-- 2. calendar_events
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.calendar_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.calendar_events
               ADD COLUMN IF NOT EXISTS target_class text,
               ADD COLUMN IF NOT EXISTS target_section text,
               ADD COLUMN IF NOT EXISTS reminder_sent boolean DEFAULT false';
    EXECUTE $c$COMMENT ON COLUMN public.calendar_events.target_class IS 'Optional class filter. NULL = all classes.'$c$;
    EXECUTE $c$COMMENT ON COLUMN public.calendar_events.target_section IS 'Optional section filter. NULL = all sections.'$c$;
    EXECUTE $c$COMMENT ON COLUMN public.calendar_events.reminder_sent IS 'True after the daily reminder job has notified for this event.'$c$;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. incomes.receipt_image_url
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.incomes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.incomes ADD COLUMN IF NOT EXISTS receipt_image_url text';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. updated_at trigger functions (same bodies as the sister project; search_path pinned)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.update_timestamp()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.set_dashboard_managed_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_dashboard_managed_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_timestamp() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_dashboard_managed_updated_at() TO service_role;

DO $$
DECLARE
  r record;
  v_reg regclass;
BEGIN
  FOR r IN
    SELECT split_part(e, '|', 1) AS tbl, split_part(e, '|', 2) AS fn
      FROM unnest(ARRAY[
        'bot_settings|set_updated_at',
        'crm_leads|set_updated_at',
        'error_logs|set_updated_at',
        'feature_flags|set_updated_at',
        'invoices|set_updated_at',
        'distribution_items|set_updated_at',
        'distribution_records|set_updated_at',
        'distribution_stock|set_updated_at',
        'distribution_settings|set_updated_at',
        'school_apps|set_updated_at',
        'payments|update_timestamp',
        'students|update_timestamp',
        'users|update_timestamp',
        'budget_items|update_timestamp',
        'budgets|update_timestamp',
        'assignments|set_dashboard_managed_updated_at',
        'grade_schemes|set_dashboard_managed_updated_at',
        'grades|set_dashboard_managed_updated_at',
        'student_goals|set_dashboard_managed_updated_at',
        'subjects|set_dashboard_managed_updated_at',
        'teacher_assignments|set_dashboard_managed_updated_at',
        'attendance_settings|update_updated_at_column',
        'teacher_attendance|update_updated_at_column'
      ]) AS e
  LOOP
    v_reg := to_regclass('public.' || r.tbl);
    IF v_reg IS NULL THEN
      CONTINUE;
    END IF;

    -- needs a plain (non-generated) updated_at column
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute AS a
       WHERE a.attrelid = v_reg AND a.attname = 'updated_at'
         AND NOT a.attisdropped AND a.attgenerated = ''
    ) THEN
      CONTINUE;
    END IF;

    -- already maintained by some BEFORE UPDATE row trigger?
    IF EXISTS (
      SELECT 1
        FROM pg_trigger AS tg
        JOIN pg_proc AS p ON p.oid = tg.tgfoid
       WHERE tg.tgrelid = v_reg
         AND NOT tg.tgisinternal
         AND (tg.tgtype & 1) = 1      -- row level
         AND (tg.tgtype & 2) = 2      -- BEFORE
         AND (tg.tgtype & 16) = 16    -- UPDATE
         AND (p.proname ILIKE '%updated_at%' OR p.proname ILIKE '%timestamp%' OR p.proname ILIKE '%touch%')
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || r.tbl || '_updated_at', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()',
      'trg_' || r.tbl || '_updated_at', r.tbl, r.fn);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Budget integrity triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_budget_school_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Cannot change budget school_id after creation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_budget_item_identity_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Cannot change budget_item school_id after creation';
  END IF;
  IF OLD.budget_id IS DISTINCT FROM NEW.budget_id THEN
    RAISE EXCEPTION 'Cannot change budget_item budget_id after creation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_budget_item_school_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.school_id IS DISTINCT FROM (SELECT b.school_id FROM public.budgets AS b WHERE b.id = NEW.budget_id) THEN
    RAISE EXCEPTION 'budget_items.school_id (%) must match budgets.school_id (%)',
      NEW.school_id, (SELECT b.school_id FROM public.budgets AS b WHERE b.id = NEW.budget_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_budget_item_branch_school()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.branches AS br WHERE br.id = NEW.branch_id AND br.school_id = NEW.school_id) THEN
      RAISE EXCEPTION 'branch_id (%) does not belong to school_id (%)', NEW.branch_id, NEW.school_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_budget_school_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_budget_item_identity_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_budget_item_school_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_budget_item_branch_school() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_budget_school_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_budget_item_identity_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_budget_item_school_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_budget_item_branch_school() TO service_role;

DO $$
BEGIN
  IF to_regclass('public.budgets') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_prevent_budget_school_change ON public.budgets';
    EXECUTE 'CREATE TRIGGER trg_prevent_budget_school_change BEFORE UPDATE ON public.budgets
               FOR EACH ROW EXECUTE FUNCTION public.prevent_budget_school_change()';
  END IF;

  IF to_regclass('public.budget_items') IS NOT NULL AND to_regclass('public.budgets') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_prevent_budget_item_identity_change ON public.budget_items';
    EXECUTE 'CREATE TRIGGER trg_prevent_budget_item_identity_change BEFORE UPDATE ON public.budget_items
               FOR EACH ROW EXECUTE FUNCTION public.prevent_budget_item_identity_change()';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_budget_item_school_id_check ON public.budget_items';
    EXECUTE 'CREATE TRIGGER trg_budget_item_school_id_check BEFORE INSERT OR UPDATE ON public.budget_items
               FOR EACH ROW EXECUTE FUNCTION public.validate_budget_item_school_id()';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_budget_item_branch_school_check ON public.budget_items';
    EXECUTE 'CREATE TRIGGER trg_budget_item_branch_school_check BEFORE INSERT OR UPDATE ON public.budget_items
               FOR EACH ROW EXECUTE FUNCTION public.validate_budget_item_branch_school()';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. seed_default_roles_for_school
--    Inserts the five default roles for a school and their permission sets.
--    Uses NOT EXISTS instead of ON CONFLICT because modon's baseline has no
--    unique constraint on school_roles(school_id, key) or
--    role_perm_assignments(role_id, permission_id). Permission keys that do not
--    exist in perm_definitions are skipped silently. service_role only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_roles_for_school(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role record;
BEGIN
  INSERT INTO public.school_roles (school_id, key, name_ar, is_system)
  SELECT p_school_id, d.key, d.name_ar, d.is_system
    FROM (VALUES
      ('branch_admin', 'مدير الفرع',  true),
      ('accountant',   'محاسب',        false),
      ('teacher',      'معلم',          false),
      ('data_entry',   'مدخل بيانات',  false),
      ('viewer',       'مشاهد فقط',     false)
    ) AS d(key, name_ar, is_system)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.school_roles AS sr
      WHERE sr.school_id = p_school_id AND sr.key = d.key
   );

  FOR v_role IN
    SELECT sr.id AS role_id, sr.key AS role_key
      FROM public.school_roles AS sr
     WHERE sr.school_id = p_school_id
       AND sr.key IN ('branch_admin', 'accountant', 'teacher', 'data_entry', 'viewer')
  LOOP
    INSERT INTO public.role_perm_assignments (role_id, permission_id)
    SELECT v_role.role_id, pd.id
      FROM public.perm_definitions AS pd
     WHERE pd.key = ANY (
       CASE v_role.role_key
         WHEN 'branch_admin' THEN ARRAY[
           'users.create','users.read','users.update','users.view_phone','users.view_email',
           'users.export','users.reset_password',
           'students.create','students.read','students.update','students.delete',
           'students.view_phone','students.view_guardian_phone','students.view_address','students.view_fees',
           'students.export','students.print_card','students.transfer','students.send_notification','students.scope_all',
           'registrations.create','registrations.read','registrations.update','registrations.approve','registrations.reject',
           'guardians.create','guardians.read','guardians.update','guardians.view_phone',
           'teachers.create','teachers.read','teachers.update','teachers.view_qualifications','teachers.assign_schedule',
           'payments.create','payments.read','payments.update','payments.view_amount','payments.view_balance',
           'payments.view_payment_method','payments.print_receipt','payments.export','payments.send_reminder',
           'attendance.create','attendance.read','attendance.update','attendance.export',
           'attendance.notify_guardian','attendance.scope_all',
           'classes.create','classes.read','classes.update','classes.assign_students','classes.assign_teacher','classes.export',
           'schedules.create','schedules.read','schedules.update','schedules.print',
           'subjects.create','subjects.read','subjects.update',
           'settings.read','settings.manage_roles','settings.manage_academic_year',
           'reports.read','reports.export','reports.financial','reports.academic','reports.attendance',
           'notifications.create','notifications.read','notifications.send_bulk',
           'audit_log.read'
         ]
         WHEN 'accountant' THEN ARRAY[
           'students.read','students.view_fees','students.scope_all',
           'payments.create','payments.read','payments.update','payments.view_amount',
           'payments.view_discount','payments.view_balance','payments.view_payment_method',
           'payments.print_receipt','payments.export',
           'invoices.create','invoices.read','invoices.update','invoices.view_amounts','invoices.print','invoices.export',
           'salaries.create','salaries.read','salaries.update',
           'salaries.view_basic','salaries.view_allowances','salaries.view_deductions','salaries.view_net',
           'salaries.print_slip','salaries.export',
           'reports.read','reports.financial'
         ]
         WHEN 'teacher' THEN ARRAY[
           'students.read','students.view_phone','students.view_guardian_phone','students.view_fees',
           'students.scope_own_class',
           'attendance.create','attendance.read','attendance.update',
           'attendance.notify_guardian','attendance.scope_own_class',
           'grades.create','grades.read','grades.update','grades.scope_own_subject',
           'schedules.read','subjects.read','classes.read'
         ]
         WHEN 'data_entry' THEN ARRAY[
           'students.create','students.read','students.update',
           'students.view_phone','students.view_address','students.scope_all',
           'registrations.create','registrations.read','registrations.update',
           'guardians.create','guardians.read','guardians.update','guardians.view_phone',
           'classes.read','schedules.read','subjects.read'
         ]
         ELSE ARRAY[
           'students.read','students.scope_all',
           'guardians.read','teachers.read',
           'payments.read','payments.view_amount','payments.view_balance',
           'attendance.read','attendance.scope_all',
           'grades.read','grades.scope_all',
           'classes.read','schedules.read','subjects.read',
           'reports.read'
         ]
       END
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.role_perm_assignments AS rpa
        WHERE rpa.role_id = v_role.role_id AND rpa.permission_id = pd.id
     );
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.seed_default_roles_for_school(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_roles_for_school(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 7. Indexes on school_id / branch_id (tenant + branch filters used by every
--    RLS policy and list query). Format: table|col1,col2|partial predicate|index name
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_reg regclass;
  v_n int;
BEGIN
  FOR r IN
    SELECT split_part(e, '|', 1)                          AS tbl,
           string_to_array(split_part(e, '|', 2), ',')    AS cols,
           NULLIF(split_part(e, '|', 3), '')              AS pred,
           split_part(e, '|', 4)                          AS idx_name
      FROM unnest(ARRAY[
      'account_archives|branch_id||idx_account_archives_branch_id',
      'activity_logs|branch_id||idx_activity_logs_branch_id',
      'activity_monitoring_settings|branch_id||idx_activity_monitoring_settings_branch_id',
      'admin_branch_scopes|branch_id||idx_admin_branch_scopes_branch_id',
      'admin_branch_scopes|school_id||idx_admin_branch_scopes_school_id',
      'admin_branch_scopes|user_id,school_id||admin_branch_scopes_user_school_idx',
      'app_notifications|school_id||idx_app_notifications_school_id',
      'assignments|branch_id||idx_assignments_branch_id',
      'assignments|school_id||idx_assignments_school_id',
      'attendance|branch_id||idx_attendance_branch_id',
      'attendance_audit_log|school_id||idx_attendance_audit_log_school_id',
      'attendance_qr_codes|branch_id||idx_attendance_qr_codes_branch_id',
      'attendance_qr_codes|school_id||idx_attendance_qr_codes_school_id',
      'attendance_records|branch_id||idx_attendance_records_branch_id',
      'attendance_records_audit_log|school_id||idx_att_records_audit_school_id',
      'attendance_settings|branch_id||idx_attendance_settings_branch_id',
      'behavior_logs|school_id||idx_behavior_logs_school_id',
      'behavior_records|school_id||idx_behavior_records_school_id',
      'branches|school_id,is_active,created_at||idx_branches_school_active_created_at',
      'budget_items|branch_id||idx_budget_items_branch_id',
      'budget_items|school_id||idx_budget_items_school_id',
      'calendar_events|school_id||idx_calendar_events_school_id',
      'class_fees|branch_id||idx_class_fees_branch_id',
      'class_fees|school_id||idx_class_fees_school_id',
      'class_schedules|school_id,class_name||idx_class_schedules_class',
      'classes|branch_id||idx_classes_branch_id',
      'classes|school_id||idx_classes_school_id',
      'conversations|school_id||idx_conversations_school_id',
      'daily_lectures|school_id||idx_daily_lectures_school_id',
      'deductions|school_id||idx_deductions_school_id',
      'deleted_records_archive|school_id||idx_deleted_records_archive_school_id',
      'discounts|branch_id||idx_discounts_branch_id',
      'discounts|school_id||idx_discounts_school_id',
      'error_logs|school_id||idx_error_logs_school_id',
      'exam_attempts|school_id||idx_exam_attempts_school_id',
      'exam_integrity_logs|school_id||idx_exam_integrity_logs_school_id',
      'exams|school_id,starts_at||exams_school_starts_idx',
      'expense_types|school_id||idx_expense_types_school_id',
      'expenses_audit_log|school_id||idx_expenses_audit_school_id',
      'fee_notifications|branch_id||idx_fee_notifications_branch_id',
      'financial_summary|school_id,month||idx_financial_summary_school_month',
      'grade_audit_log|school_id||idx_grade_audit_school_id',
      'grade_schemes|school_id||idx_grade_schemes_school_id',
      'grade_types|school_id||idx_grade_types_school_id',
      'grades|branch_id||idx_grades_branch_id',
      'grades|school_id||idx_grades_school_id',
      'group_alerts|branch_id||idx_group_alerts_branch_id',
      'income_types|school_id||idx_income_types_school_id',
      'incomes|branch_id||idx_incomes_branch',
      'incomes|school_id||idx_incomes_school_id',
      'installments|school_id||idx_installments_school_id',
      'invoices|school_id||idx_invoices_school_id',
      'job_titles|school_id||idx_job_titles_school_id',
      'managed_user_credentials|school_id||idx_managed_user_creds_school_id',
      'managed_user_profiles|branch_id||idx_managed_user_profiles_branch_id',
      'managed_user_profiles|school_id||idx_managed_user_profiles_school_id',
      'ops_errors|school_id||idx_ops_errors_school_id',
      'ops_pending_actions|school_id||idx_ops_pending_actions_school_id',
      'parent_student_links|school_id||idx_parent_student_links_school',
      'payments|school_id,created_at||idx_payments_school_date',
      'payments|student_id,school_id||idx_payments_student_school',
      'payments|student_id,school_id|(deleted_at IS NULL)|idx_payments_deleted_at_null',
      'questions|school_id||idx_questions_school_id',
      'salaries|branch_id||idx_salaries_branch_id',
      'salary_advances|school_id||idx_salary_advances_school_id',
      'salary_archives|school_id||idx_salary_archives_school_id',
      'schedule_time_slots|branch_id||idx_schedule_time_slots_branch_id',
      'schedule_working_days|branch_id||idx_schedule_working_days_branch_id',
      'school_announcements|branch_id||idx_school_announcements_branch_id',
      'school_announcements|school_id||idx_school_announcements_school_id',
      'school_data_archives|school_id||idx_school_data_archives_school_id',
      'school_notifications|branch_id||idx_school_notifications_branch_id',
      'school_roles|school_id||idx_school_roles_school_id',
      'sections|school_id||idx_sections_school_id',
      'student_badges|school_id||idx_student_badges_school_id',
      'student_goals|school_id||idx_student_goals_school_id',
      'students|school_id,class_name||idx_students_school_class_name',
      'subject_lecture_prices|school_id||idx_subject_lecture_prices_school_id',
      'subjects|school_id||idx_subjects_school_id',
      'subscriptions|school_id||idx_subscriptions_school_id',
      'support_tickets|school_id||idx_support_tickets_school_id',
      'survey_results|school_id||idx_survey_results_school_id',
      'teacher_activities|branch_id||idx_teacher_activities_branch_id',
      'teacher_assignments|school_id,teacher_id,class_id,section_id,subject_id||idx_teacher_assignments_school_scope',
      'teacher_attendance|branch_id||idx_teacher_attendance_branch_id',
      'teacher_documents|school_id||idx_teacher_documents_school_id',
      'teacher_evaluations|school_id||idx_teacher_evaluations_school_id',
      'teacher_leaves|school_id||idx_teacher_leaves_school_id',
      'teacher_qualifications|school_id||idx_teacher_qualifications_school_id',
      'teachers|school_id,full_name||idx_teachers_school_name',
      'teachers|school_id,status|(status IS NOT NULL)|idx_teachers_school_status',
      'trial_activations|school_id||idx_trial_activations_school_id',
      'upload_sessions|school_id||idx_upload_sessions_school_id',
      'user_page_access|branch_id||idx_user_page_access_branch_id',
      'user_page_access|school_id||idx_user_page_access_school_id',
      'user_permissions|branch_id||idx_user_permissions_branch_id',
      'user_profiles|branch_id||idx_user_profiles_branch_id',
      'user_push_subscriptions|school_id||idx_user_push_subscriptions_school_id',
      'user_role_assignments|branch_id||idx_user_role_assignments_branch_id',
      'user_role_assignments|user_id,school_id,is_active||idx_user_role_assignments_user',
      'weekly_schedule|school_id||idx_weekly_schedule_school_id',
      'class_schedules|school_id,class_name,day_of_week,period_number||class_schedules_school_day_period_idx',
      'class_schedules|time_slot_id||idx_class_schedules_time_slot_id',
      'expenses|school_id,expense_date,created_at||idx_expenses_school_expense_date_created_at',
      'expenses|school_id,expense_type_id,expense_date||idx_expenses_school_type_expense_date',
      'expense_types|school_id,name||idx_expense_types_school_name'
      ]) AS e
  LOOP
    v_reg := to_regclass('public.' || r.tbl);
    IF v_reg IS NULL THEN
      CONTINUE;
    END IF;
    v_n := array_length(r.cols, 1);

    IF (SELECT count(*) FROM information_schema.columns AS c
         WHERE c.table_schema = 'public' AND c.table_name = r.tbl AND c.column_name = ANY (r.cols)) <> v_n THEN
      CONTINUE;  -- a column does not exist on this database
    END IF;

    -- already covered by an index that starts with the same columns?
    IF EXISTS (
      SELECT 1
        FROM pg_index AS i
       WHERE i.indrelid = v_reg
         AND i.indisvalid
         AND (i.indpred IS NULL OR r.pred IS NOT NULL)
         AND (
           SELECT array_agg(a.attname::text ORDER BY k.ord)
             FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute AS a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
            WHERE k.ord <= v_n
         ) = r.cols
    ) THEN
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)%s',
        r.idx_name, r.tbl,
        (SELECT string_agg(quote_ident(u.c), ', ' ORDER BY u.ord) FROM unnest(r.cols) WITH ORDINALITY AS u(c, ord)),
        CASE WHEN r.pred IS NOT NULL THEN ' WHERE ' || r.pred ELSE '' END
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'index % on % skipped: %', r.idx_name, r.tbl, SQLERRM;
    END;
  END LOOP;
END $$;
