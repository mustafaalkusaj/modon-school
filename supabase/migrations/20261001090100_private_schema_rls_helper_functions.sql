-- =============================================================================
-- RLS scope helper functions in the `private` schema (+ public invoker wrappers)
-- Ported from the sister school-app project:
--   20260713212758_isolate_security_definer_functions
--   20260728081417_finalize_current_accessible_branch_ids_security
--   20260713171635_teacher_mobile_release_security
--   20260322_managed_mobile_rls (teacher_can_* / student_can_read_assignment)
--
-- REVIEW BEFORE APPLYING. Idempotent (CREATE SCHEMA IF NOT EXISTS, CREATE OR
-- REPLACE FUNCTION, GRANT/REVOKE). Safe on a live database: it only ADDS
-- functions. It deliberately does NOT move modon's existing public.current_app_role(),
-- public.current_school_id(), public.current_teacher_id() or
-- public.current_user_can_access_branch() into `private`: 349 live tenant_*
-- policies reference them and the `SET SCHEMA` swap must be rehearsed on a
-- branch database first (see SECURITY.md notes in the PR).
--
-- DESIGN
--   * The implementation lives in `private` (not exposed by PostgREST) as
--     SECURITY DEFINER with an empty search_path (everything schema-qualified).
--   * The public function is a SECURITY INVOKER wrapper, so Data API callers
--     and RLS policies keep using the stable public.* names while the
--     privileged body is not an exposed definer function (clears the Supabase
--     "SECURITY DEFINER in exposed schema" advisor).
--   * anon never gets EXECUTE; authenticated + service_role do (policies call
--     these as the querying role).
--
-- Tables referenced (all exist in modon's baseline): managed_user_profiles,
-- user_profiles, admin_branch_scopes, students, teachers, student_teacher_links,
-- parent_student_links.
-- APPLY ORDER: after 20261001090000.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Identity helpers (read managed_user_profiles for the calling auth user)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.current_managed_branch_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT m.branch_id
    FROM public.managed_user_profiles AS m
   WHERE m.auth_user_id = (SELECT auth.uid())
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION private.current_student_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT m.student_id
    FROM public.managed_user_profiles AS m
   WHERE m.auth_user_id = (SELECT auth.uid())
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION private.get_current_user_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT up.school_id
    FROM public.user_profiles AS up
   WHERE up.id = (SELECT auth.uid())
   LIMIT 1;
$function$;

-- Branch ids the caller may see. NULL = unrestricted (super_admin, or a school
-- admin with no branch binding and no admin_branch_scopes rows).
CREATE OR REPLACE FUNCTION private.current_accessible_branch_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN (SELECT public.current_app_role()) = 'super_admin' THEN NULL::uuid[]
    WHEN EXISTS (
      SELECT 1 FROM public.admin_branch_scopes AS abs
       WHERE abs.user_id = (SELECT auth.uid())
    ) THEN ARRAY(
      SELECT abs.branch_id FROM public.admin_branch_scopes AS abs
       WHERE abs.user_id = (SELECT auth.uid())
    )
    WHEN COALESCE(
           (SELECT up.branch_id FROM public.user_profiles AS up
             WHERE up.id = (SELECT auth.uid()) LIMIT 1),
           (SELECT m.branch_id FROM public.managed_user_profiles AS m
             WHERE m.auth_user_id = (SELECT auth.uid()) LIMIT 1)
         ) IS NOT NULL
    THEN ARRAY[
      COALESCE(
        (SELECT up.branch_id FROM public.user_profiles AS up
          WHERE up.id = (SELECT auth.uid()) LIMIT 1),
        (SELECT m.branch_id FROM public.managed_user_profiles AS m
          WHERE m.auth_user_id = (SELECT auth.uid()) LIMIT 1)
      )
    ]
    ELSE NULL::uuid[]
  END;
$function$;

CREATE OR REPLACE FUNCTION private.current_staff_can_access_branch(p_branch_id uuid, p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    public.current_app_role() IN ('super_admin', 'admin', 'employee')
    AND public.current_user_can_access_branch(p_branch_id, p_school_id);
$function$;

CREATE OR REPLACE FUNCTION private.current_teacher_can_access_student(p_student_id uuid, p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.student_teacher_links AS stl
     WHERE stl.teacher_id = public.current_teacher_id()
       AND stl.student_id = p_student_id
       AND stl.school_id::text = p_school_id::text
  );
$function$;

CREATE OR REPLACE FUNCTION private.current_parent_can_access_student(p_student_id uuid, p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.parent_student_links AS psl
     WHERE psl.parent_user_id = (SELECT auth.uid())
       AND psl.student_id = p_student_id
       AND psl.school_id = p_school_id
  );
$function$;

-- Logo buckets (school-logos / branch-logos): admins manage objects under
-- "<school_id>/..." for their own school; super_admin manages any school.
CREATE OR REPLACE FUNCTION private.can_manage_logo_bucket_object(bucket_name text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND public.current_app_role() IN ('admin', 'super_admin')
    AND bucket_name IN ('school-logos', 'branch-logos')
    AND split_part(COALESCE(object_name, ''), '/', 1) <> ''
    AND (
      public.current_app_role() = 'super_admin'
      OR split_part(COALESCE(object_name, ''), '/', 1) = COALESCE(public.current_school_id()::text, '')
    );
$function$;

-- -----------------------------------------------------------------------------
-- Managed-user (mobile) scope helpers: legacy teacher/student RLS building
-- blocks (teacher_can_*, student_can_read_assignment, current_managed_*).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.current_managed_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT m.role
    FROM public.managed_user_profiles AS m
   WHERE m.auth_user_id = (SELECT auth.uid())
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION private.current_managed_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT m.school_id
    FROM public.managed_user_profiles AS m
   WHERE m.auth_user_id = (SELECT auth.uid())
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION private.current_managed_student_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT m.student_id
    FROM public.managed_user_profiles AS m
   WHERE m.auth_user_id = (SELECT auth.uid())
     AND m.role = 'student'
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION private.current_managed_teacher_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT m.teacher_id
    FROM public.managed_user_profiles AS m
   WHERE m.auth_user_id = (SELECT auth.uid())
     AND m.role = 'teacher'
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION private.current_managed_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(m.is_active, false)
    FROM public.managed_user_profiles AS m
   WHERE m.auth_user_id = (SELECT auth.uid())
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION private.current_managed_student_class_name()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT s.class_name
    FROM public.students AS s
   WHERE s.id = private.current_managed_student_id()
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION private.current_managed_student_section()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT s.section
    FROM public.students AS s
   WHERE s.id = private.current_managed_student_id()
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION private.teacher_can_access_class(target_class_name text, target_section text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  teacher_uuid uuid;
  allowed boolean := false;
BEGIN
  IF private.current_managed_role() IS DISTINCT FROM 'teacher'
     OR NOT COALESCE(private.current_managed_is_active(), false) THEN
    RETURN false;
  END IF;

  IF target_class_name IS NULL OR btrim(target_class_name) = '' THEN
    RETURN false;
  END IF;

  teacher_uuid := private.current_managed_teacher_id();
  IF teacher_uuid IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    SELECT EXISTS (
      SELECT 1
        FROM public.teachers AS t
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN t.classes_taught IS NULL THEN '[]'::jsonb
            WHEN jsonb_typeof(to_jsonb(t.classes_taught)) = 'array' THEN to_jsonb(t.classes_taught)
            WHEN jsonb_typeof(to_jsonb(t.classes_taught)) = 'string'
              THEN COALESCE(NULLIF(t.classes_taught::text, '')::jsonb, '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) AS assignment(value)
       WHERE t.id = teacher_uuid
         AND lower(
           COALESCE(
             NULLIF(assignment.value ->> 'grade', ''),
             NULLIF(assignment.value ->> 'class_name', ''),
             NULLIF(assignment.value ->> 'class', '')
           )
         ) = lower(target_class_name)
         AND (
           COALESCE(
             NULLIF(lower(assignment.value ->> 'section'), ''),
             NULLIF(lower(assignment.value ->> 'group'), '')
           ) IS NULL
           OR COALESCE(
             NULLIF(lower(assignment.value ->> 'section'), ''),
             NULLIF(lower(assignment.value ->> 'group'), '')
           ) = lower(COALESCE(target_section, ''))
         )
    ) INTO allowed;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN false;
  END;

  RETURN COALESCE(allowed, false);
END;
$function$;

CREATE OR REPLACE FUNCTION private.teacher_can_access_student(target_student_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  student_class_name text;
  student_section text;
  student_school_id uuid;
BEGIN
  IF private.current_managed_role() IS DISTINCT FROM 'teacher'
     OR NOT COALESCE(private.current_managed_is_active(), false) THEN
    RETURN false;
  END IF;

  SELECT s.class_name, s.section, s.school_id
    INTO student_class_name, student_section, student_school_id
    FROM public.students AS s
   WHERE s.id = target_student_id
   LIMIT 1;

  IF student_school_id IS NULL
     OR student_school_id IS DISTINCT FROM private.current_managed_school_id() THEN
    RETURN false;
  END IF;

  RETURN private.teacher_can_access_class(student_class_name, student_section);
END;
$function$;

CREATE OR REPLACE FUNCTION private.student_can_read_assignment(
  target_school_id uuid,
  target_student_id uuid,
  target_class_name text,
  target_section text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    private.current_managed_role() = 'student'
    AND COALESCE(private.current_managed_is_active(), false)
    AND (
      target_student_id = private.current_managed_student_id()
      OR (
        target_student_id IS NULL
        AND target_school_id = private.current_managed_school_id()
        AND (
          target_class_name IS NULL
          OR lower(target_class_name) = lower(COALESCE(private.current_managed_student_class_name(), ''))
        )
        AND (
          target_section IS NULL
          OR lower(target_section) = lower(COALESCE(private.current_managed_student_section(), ''))
        )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION private.teacher_can_read_assignment(
  target_school_id uuid,
  target_student_id uuid,
  target_class_name text,
  target_section text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    private.current_managed_role() = 'teacher'
    AND COALESCE(private.current_managed_is_active(), false)
    AND target_school_id = private.current_managed_school_id()
    AND (
      target_student_id IS NULL
      OR private.teacher_can_access_student(target_student_id)
    )
    AND (
      (target_class_name IS NULL AND target_section IS NULL)
      OR private.teacher_can_access_class(target_class_name, target_section)
      OR (
        target_class_name IS NULL
        AND target_section IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM public.students AS s
           WHERE s.school_id = private.current_managed_school_id()
             AND private.teacher_can_access_student(s.id)
             AND lower(COALESCE(s.section, '')) = lower(target_section)
        )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION private.teacher_can_write_assignment(
  target_school_id uuid,
  target_student_id uuid,
  target_class_name text,
  target_section text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    private.current_managed_role() = 'teacher'
    AND COALESCE(private.current_managed_is_active(), false)
    AND target_school_id = private.current_managed_school_id()
    AND (
      (target_student_id IS NOT NULL AND private.teacher_can_access_student(target_student_id))
      OR (
        target_student_id IS NULL
        AND private.teacher_can_access_class(target_class_name, target_section)
      )
    );
$function$;

-- -----------------------------------------------------------------------------
-- Public SECURITY INVOKER wrappers (stable API names for policies / RPC)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_managed_branch_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_managed_branch_id(); $function$;

CREATE OR REPLACE FUNCTION public.current_student_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_student_id(); $function$;

CREATE OR REPLACE FUNCTION public.get_current_user_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.get_current_user_school_id(); $function$;

CREATE OR REPLACE FUNCTION public.current_accessible_branch_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_accessible_branch_ids(); $function$;

CREATE OR REPLACE FUNCTION public.current_staff_can_access_branch(p_branch_id uuid, p_school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_staff_can_access_branch(p_branch_id, p_school_id); $function$;

CREATE OR REPLACE FUNCTION public.current_teacher_can_access_student(p_student_id uuid, p_school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_teacher_can_access_student(p_student_id, p_school_id); $function$;

CREATE OR REPLACE FUNCTION public.current_parent_can_access_student(p_student_id uuid, p_school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_parent_can_access_student(p_student_id, p_school_id); $function$;

CREATE OR REPLACE FUNCTION public.can_manage_logo_bucket_object(bucket_name text, object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.can_manage_logo_bucket_object(bucket_name, object_name); $function$;

CREATE OR REPLACE FUNCTION public.current_managed_role()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_managed_role(); $function$;

CREATE OR REPLACE FUNCTION public.current_managed_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_managed_school_id(); $function$;

CREATE OR REPLACE FUNCTION public.current_managed_student_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_managed_student_id(); $function$;

CREATE OR REPLACE FUNCTION public.current_managed_teacher_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_managed_teacher_id(); $function$;

CREATE OR REPLACE FUNCTION public.current_managed_is_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_managed_is_active(); $function$;

CREATE OR REPLACE FUNCTION public.current_managed_student_class_name()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_managed_student_class_name(); $function$;

CREATE OR REPLACE FUNCTION public.current_managed_student_section()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.current_managed_student_section(); $function$;

CREATE OR REPLACE FUNCTION public.teacher_can_access_class(target_class_name text, target_section text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.teacher_can_access_class(target_class_name, target_section); $function$;

CREATE OR REPLACE FUNCTION public.teacher_can_access_student(target_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.teacher_can_access_student(target_student_id); $function$;

CREATE OR REPLACE FUNCTION public.student_can_read_assignment(
  target_school_id uuid, target_student_id uuid, target_class_name text, target_section text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT private.student_can_read_assignment(target_school_id, target_student_id, target_class_name, target_section);
$function$;

CREATE OR REPLACE FUNCTION public.teacher_can_read_assignment(
  target_school_id uuid, target_student_id uuid, target_class_name text, target_section text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT private.teacher_can_read_assignment(target_school_id, target_student_id, target_class_name, target_section);
$function$;

CREATE OR REPLACE FUNCTION public.teacher_can_write_assignment(
  target_school_id uuid, target_student_id uuid, target_class_name text, target_section text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT private.teacher_can_write_assignment(target_school_id, target_student_id, target_class_name, target_section);
$function$;

-- -----------------------------------------------------------------------------
-- Grants: never anon; authenticated + service_role may execute (policies and
-- the Data API call these as the querying role).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE (n.nspname = 'private' AND p.proname IN (
              'current_managed_branch_id', 'current_student_id', 'get_current_user_school_id',
              'current_accessible_branch_ids', 'current_staff_can_access_branch',
              'current_teacher_can_access_student', 'current_parent_can_access_student',
              'can_manage_logo_bucket_object', 'current_managed_role', 'current_managed_school_id',
              'current_managed_student_id', 'current_managed_teacher_id', 'current_managed_is_active',
              'current_managed_student_class_name', 'current_managed_student_section',
              'teacher_can_access_class', 'teacher_can_access_student', 'student_can_read_assignment',
              'teacher_can_read_assignment', 'teacher_can_write_assignment'))
        OR (n.nspname = 'public' AND p.proname IN (
              'current_managed_branch_id', 'current_student_id', 'get_current_user_school_id',
              'current_accessible_branch_ids', 'current_staff_can_access_branch',
              'current_teacher_can_access_student', 'current_parent_can_access_student',
              'can_manage_logo_bucket_object', 'current_managed_role', 'current_managed_school_id',
              'current_managed_student_id', 'current_managed_teacher_id', 'current_managed_is_active',
              'current_managed_student_class_name', 'current_managed_student_section',
              'teacher_can_access_class', 'teacher_can_access_student', 'student_can_read_assignment',
              'teacher_can_read_assignment', 'teacher_can_write_assignment'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;
