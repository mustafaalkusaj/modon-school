-- =============================================================================
-- Branch isolation: columns, backfill, sync trigger, student/branch consistency
-- Ported from the sister school-app project (20260518_000000_branch_isolation,
-- 20260622224521_audit_installments_branch..., 20260728090600_enforce_student_
-- branch_school_consistency) and adapted to modon-school's school_id tenancy.
--
-- REVIEW BEFORE APPLYING. Written against modon's baseline schema; every
-- statement is idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF
-- EXISTS / guarded DO blocks) because the exact state of the live database is
-- not known to the author. Nothing here connects to or touches live data until
-- an operator applies it.
--
-- WHAT THIS DOES
--   1. installments / deductions / daily_lectures get a branch_id column
--      (nullable, FK to branches ON DELETE SET NULL), backfilled from the
--      owning student / teacher, indexed, and protected by a RESTRICTIVE
--      branch-scope policy so branch-limited staff cannot read other branches.
--   2. managed_user_profiles.branch_id is kept in sync from the linked
--      student / teacher by public.sync_managed_user_branch_id() (trigger).
--   3. students: a row can never point at a branch of another school.
--      Enforced for NEW writes by a trigger (works even while legacy bad rows
--      exist) plus UNIQUE (id, school_id) on branches and a NOT VALID composite
--      foreign key. Existing violations are only reported (NOTICE), never
--      rewritten - repairing them is a business decision.
--
-- APPLY ORDER: first file of the 20261001 series (no dependencies).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. branch_id on installments / deductions / daily_lectures
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['installments', 'deductions', 'daily_lectures']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'branch isolation: table public.% does not exist - skipped', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS branch_id uuid', t);

    IF to_regclass('public.branches') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = ('public.' || t)::regclass
            AND conname = t || '_branch_id_fkey'
       ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (branch_id) '
        'REFERENCES public.branches(id) ON DELETE SET NULL',
        t, t || '_branch_id_fkey'
      );
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (branch_id)', 'idx_' || t || '_branch_id', t);
  END LOOP;
END $$;

-- Backfill from the owning student (installments) / teacher (deductions,
-- daily_lectures). Only rows that have no branch yet are touched.
DO $$
BEGIN
  IF to_regclass('public.installments') IS NOT NULL AND to_regclass('public.students') IS NOT NULL THEN
    UPDATE public.installments AS i
       SET branch_id = s.branch_id
      FROM public.students AS s
     WHERE i.student_id = s.id
       AND i.branch_id IS NULL
       AND s.branch_id IS NOT NULL;
  END IF;

  IF to_regclass('public.deductions') IS NOT NULL AND to_regclass('public.teachers') IS NOT NULL THEN
    UPDATE public.deductions AS d
       SET branch_id = t.branch_id
      FROM public.teachers AS t
     WHERE d.teacher_id = t.id
       AND d.branch_id IS NULL
       AND t.branch_id IS NOT NULL;
  END IF;

  IF to_regclass('public.daily_lectures') IS NOT NULL AND to_regclass('public.teachers') IS NOT NULL THEN
    UPDATE public.daily_lectures AS l
       SET branch_id = t.branch_id
      FROM public.teachers AS t
     WHERE l.teacher_id = t.id
       AND l.branch_id IS NULL
       AND t.branch_id IS NOT NULL;
  END IF;
END $$;

-- Branch-scope guard. A RESTRICTIVE policy is ANDed with the existing tenant
-- policies, so it can only narrow access: staff limited to specific branches
-- (admin_branch_scopes / user_profiles.branch_id) stop seeing other branches'
-- rows, while rows without a branch stay school-wide. service_role bypasses RLS.
-- Skipped when public.current_user_can_access_branch() is not installed.
DO $$
DECLARE
  t text;
BEGIN
  IF to_regprocedure('public.current_user_can_access_branch(uuid, uuid)') IS NULL THEN
    RAISE NOTICE 'branch isolation: current_user_can_access_branch() missing - restrictive policies skipped';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['installments', 'deductions', 'daily_lectures']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_branch_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (public.current_user_can_access_branch(branch_id, school_id)) '
      'WITH CHECK (public.current_user_can_access_branch(branch_id, school_id))',
      t || '_branch_isolation', t
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. managed_user_profiles.branch_id stays in sync with the linked student /
--    teacher.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.managed_user_profiles') IS NULL THEN
    RAISE NOTICE 'managed_user_profiles missing - sync trigger skipped';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.managed_user_profiles ADD COLUMN IF NOT EXISTS branch_id uuid';

  IF to_regclass('public.branches') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.managed_user_profiles'::regclass
          AND conname = 'managed_user_profiles_branch_id_fkey'
     ) THEN
    EXECUTE 'ALTER TABLE public.managed_user_profiles ADD CONSTRAINT managed_user_profiles_branch_id_fkey '
            'FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL';
  END IF;

  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_managed_user_profiles_branch_id ON public.managed_user_profiles (branch_id)';

  UPDATE public.managed_user_profiles AS mup
     SET branch_id = s.branch_id
    FROM public.students AS s
   WHERE mup.student_id = s.id
     AND mup.role = 'student'
     AND mup.branch_id IS NULL
     AND s.branch_id IS NOT NULL;

  UPDATE public.managed_user_profiles AS mup
     SET branch_id = t.branch_id
    FROM public.teachers AS t
   WHERE mup.teacher_id = t.id
     AND mup.role = 'teacher'
     AND mup.branch_id IS NULL
     AND t.branch_id IS NOT NULL;
END $$;

CREATE OR REPLACE FUNCTION public.sync_managed_user_branch_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.role = 'student' AND NEW.student_id IS NOT NULL THEN
    SELECT s.branch_id INTO NEW.branch_id
      FROM public.students AS s
     WHERE s.id = NEW.student_id;
  ELSIF NEW.role = 'teacher' AND NEW.teacher_id IS NOT NULL THEN
    SELECT t.branch_id INTO NEW.branch_id
      FROM public.teachers AS t
     WHERE t.id = NEW.teacher_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_managed_user_branch_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_managed_user_branch_id() TO service_role;

DO $$
BEGIN
  IF to_regclass('public.managed_user_profiles') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_sync_managed_user_branch_id ON public.managed_user_profiles';
    EXECUTE 'CREATE TRIGGER trg_sync_managed_user_branch_id
               BEFORE INSERT OR UPDATE OF student_id, teacher_id ON public.managed_user_profiles
               FOR EACH ROW EXECUTE FUNCTION public.sync_managed_user_branch_id()';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. students.branch_id must belong to students.school_id
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_student_branch_school_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_branch_school uuid;
BEGIN
  IF NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.school_id INTO v_branch_school
    FROM public.branches AS b
   WHERE b.id = NEW.branch_id;

  IF FOUND AND v_branch_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'student branch % belongs to a different school than student school %',
      NEW.branch_id, NEW.school_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_student_branch_school_consistency() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_student_branch_school_consistency() TO service_role;

DO $$
DECLARE
  v_violations bigint;
BEGIN
  IF to_regclass('public.students') IS NULL OR to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'students/branches missing - consistency enforcement skipped';
    RETURN;
  END IF;

  -- Trigger: protects every future insert / branch or school change.
  EXECUTE 'DROP TRIGGER IF EXISTS trg_enforce_student_branch_school_consistency ON public.students';
  EXECUTE 'CREATE TRIGGER trg_enforce_student_branch_school_consistency
             BEFORE INSERT OR UPDATE OF branch_id, school_id ON public.students
             FOR EACH ROW EXECUTE FUNCTION public.enforce_student_branch_school_consistency()';

  -- Report (never repair) rows that already violate the rule.
  SELECT count(*) INTO v_violations
    FROM public.students AS s
    JOIN public.branches AS b ON b.id = s.branch_id
   WHERE b.school_id IS DISTINCT FROM s.school_id;
  IF v_violations > 0 THEN
    RAISE NOTICE 'students/branches: % existing student row(s) point at a branch of another school. '
                 'They are left untouched; review them manually (join students.branch_id -> branches.school_id).',
                 v_violations;
  END IF;

  -- Composite FK target.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.branches'::regclass
       AND conname = 'branches_id_school_id_key'
  ) THEN
    EXECUTE 'ALTER TABLE public.branches ADD CONSTRAINT branches_id_school_id_key UNIQUE (id, school_id)';
  END IF;

  -- NOT VALID: enforced for new/changed rows, legacy rows are not scanned.
  -- Run `ALTER TABLE public.students VALIDATE CONSTRAINT students_branch_school_fkey`
  -- after the legacy rows are repaired.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.students'::regclass
       AND conname = 'students_branch_school_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE public.students ADD CONSTRAINT students_branch_school_fkey '
            'FOREIGN KEY (branch_id, school_id) REFERENCES public.branches (id, school_id) NOT VALID';
  END IF;
END $$;
