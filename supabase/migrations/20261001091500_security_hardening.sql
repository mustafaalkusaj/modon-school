-- =============================================================================
-- Security hardening sweep (run LAST of the 20261001 series)
-- Ported from the sister school-app project 20260924203658_close_open_rls_policies,
-- 20260924211338_lock_definer_functions, 20260924221244_lock_trigger_fn_and_pin_
-- search_path, 20260629052218_revoke_anon_execute_security_definer,
-- 20260728053029_harden_search_path and 20260729214500_scope_announcements_to_tenant.
--
-- REVIEW BEFORE APPLYING. Idempotent. Most of the sister project's tenant/student RLS work
-- is ALREADY in modon (20260924220000_tenant_isolation_rls: 349 tenant_*
-- policies, staff-only access, students/teachers/parents limited to their own
-- rows, no USING (true) write policies), so this file only closes what is left:
--
--   1. announcements: created if missing (app/api/student/notifications reads
--      it) with tenant-scoped policies: platform-wide (school_id NULL) rows are
--      readable by everyone, school rows only inside that school; writes only by
--      super_admin (any school) or admin/teacher of the SAME school; deletes by
--      super_admin or admin of the same school.
--   2. Safety net: any write policy (INSERT/UPDATE/DELETE/ALL) that is
--      USING/WITH CHECK (true) for anon/public/authenticated on a public table is
--      dropped. A no-op on a database that already ran 20260924220000; SELECT
--      policies are only REPORTED (catalog tables legitimately use true).
--   3. SECURITY DEFINER functions in public lose EXECUTE for PUBLIC and anon
--      (authenticated keeps whatever explicit grant it has, so RLS helpers keep
--      working). Trigger functions additionally lose it for authenticated
--      (trigger firing does not check EXECUTE).
--   4. Every public function without a pinned search_path gets
--      `search_path = public, extensions, pg_temp` (per-function guarded, so one
--      failure never aborts the sweep). Extension-owned functions are skipped.
--
-- APPLY ORDER: after all other 20261001* files.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. announcements
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  author_id   uuid,
  author_name text,
  title       text        NOT NULL,
  body        text        NOT NULL DEFAULT '',
  kind        text        NOT NULL DEFAULT 'post',
  link_url    text,
  audience    text        NOT NULL DEFAULT 'all',
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_school_id ON public.announcements (school_id);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.announcements FROM anon;

DROP POLICY IF EXISTS announcements_select_same_school ON public.announcements;
CREATE POLICY announcements_select_same_school ON public.announcements
  FOR SELECT TO authenticated
  USING (
    school_id IS NULL
    OR school_id = (SELECT public.current_school_id())
    OR (SELECT public.current_app_role()) = 'super_admin'
  );

DROP POLICY IF EXISTS announcements_insert_privileged ON public.announcements;
CREATE POLICY announcements_insert_privileged ON public.announcements
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.current_app_role()) = 'super_admin'
    OR (
      school_id = (SELECT public.current_school_id())
      AND (SELECT public.current_app_role()) = ANY (ARRAY['admin', 'teacher'])
    )
  );

DROP POLICY IF EXISTS announcements_update_privileged ON public.announcements;
CREATE POLICY announcements_update_privileged ON public.announcements
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.current_app_role()) = 'super_admin'
    OR (
      school_id = (SELECT public.current_school_id())
      AND (SELECT public.current_app_role()) = ANY (ARRAY['admin', 'teacher'])
    )
  )
  WITH CHECK (
    (SELECT public.current_app_role()) = 'super_admin'
    OR (
      school_id = (SELECT public.current_school_id())
      AND (SELECT public.current_app_role()) = ANY (ARRAY['admin', 'teacher'])
    )
  );

DROP POLICY IF EXISTS announcements_delete_privileged ON public.announcements;
CREATE POLICY announcements_delete_privileged ON public.announcements
  FOR DELETE TO authenticated
  USING (
    (SELECT public.current_app_role()) = 'super_admin'
    OR (
      school_id = (SELECT public.current_school_id())
      AND (SELECT public.current_app_role()) = 'admin'
    )
  );

-- -----------------------------------------------------------------------------
-- 2. Blanket write policies (safety net) + report of blanket read policies
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.schemaname, p.tablename, p.policyname, p.cmd
      FROM pg_policies AS p
     WHERE p.schemaname = 'public'
       AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       AND (p.roles && ARRAY['anon', 'public', 'authenticated']::name[])
       AND NOT (p.roles <@ ARRAY['service_role']::name[])
       AND (
         (p.cmd IN ('INSERT') AND COALESCE(p.with_check, '') IN ('true', '(true)'))
         OR (p.cmd IN ('UPDATE', 'DELETE') AND COALESCE(p.qual, '') IN ('true', '(true)'))
         OR (p.cmd = 'ALL' AND COALESCE(p.qual, '') IN ('true', '(true)')
             AND COALESCE(p.with_check, 'true') IN ('true', '(true)'))
       )
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    RAISE NOTICE 'dropped blanket % policy % on %.%', r.cmd, r.policyname, r.schemaname, r.tablename;
  END LOOP;

  FOR r IN
    SELECT p.tablename, p.policyname, p.roles
      FROM pg_policies AS p
     WHERE p.schemaname = 'public'
       AND p.cmd = 'SELECT'
       AND (p.roles && ARRAY['anon', 'public']::name[])
       AND COALESCE(p.qual, '') IN ('true', '(true)')
  LOOP
    RAISE NOTICE 'review: public/anon SELECT policy USING (true): % on public.%', r.policyname, r.tablename;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. SECURITY DEFINER functions: no PUBLIC/anon execute; triggers not callable
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, (p.prorettype = 'pg_catalog.trigger'::regtype) AS is_trigger
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM pg_depend AS d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
      IF r.is_trigger THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'could not revoke on %: %', r.sig, SQLERRM;
    END;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Pin search_path on every public function that lacks one
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND NOT EXISTS (
         SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS c WHERE c LIKE 'search_path=%'
       )
       AND NOT EXISTS (SELECT 1 FROM pg_depend AS d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', r.sig);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'could not pin search_path on %: %', r.sig, SQLERRM;
    END;
  END LOOP;
END $$;
