-- =============================================================================
-- Super-admin mobile-app management tables
-- Sources: the sister school-app project 20260602_000000_super_admin_app_management (rich
-- school_apps / school_app_versions schema the modon super-admin routes use),
-- 20260704113946_add_app_management_tables (apps, app_features, app_themes,
-- app_usage_limits) and 20260728090900_rls_proposal_for_app_management_tables.
--
-- REVIEW BEFORE APPLYING. Idempotent: CREATE TABLE IF NOT EXISTS, then
-- ADD COLUMN IF NOT EXISTS for every column the code needs, so it is safe
-- whether the tables are absent, were created from the legacy script, or exist
-- with the sister project's slimmer layout.
--
-- WHAT THIS DOES
--   * school_apps / school_app_versions: the tables app/api/web/super-admin/
--     {apps,app-versions} read and write (they currently answer 42P01 and the
--     UI shows "table missing"). Column names match those routes exactly.
--   * apps / app_features / app_themes / app_usage_limits: the camelCase
--     (Prisma-style) tables of the sister project's live schema. The sister project's audit found
--     them unused, so they are created empty with RLS and service-role-only
--     access, exactly like the sister project production. Drop them if you do not want the
--     parity (DROP TABLE IF EXISTS public.app_usage_limits, app_themes,
--     app_features, apps).
--   * RLS on all six: service_role full access (the routes use the service
--     client) and super_admin read/write through PostgREST. No other role has
--     any access. No policy is USING (true) for authenticated/anon.
--
-- Depends on: schools, auth.users, public.current_app_role().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- school_apps: one registered mobile app per school
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_apps (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id              uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  app_name               text        NOT NULL,
  bundle_id_ios          text,
  package_name_android   text,
  ios_status             text        NOT NULL DEFAULT 'draft'
                         CHECK (ios_status IN ('draft', 'in_review', 'published', 'rejected', 'suspended')),
  android_status         text        NOT NULL DEFAULT 'draft'
                         CHECK (android_status IN ('draft', 'in_review', 'published', 'rejected', 'suspended')),
  app_store_url          text,
  play_store_url         text,
  current_version        text        NOT NULL DEFAULT '1.0.0',
  min_version            text        NOT NULL DEFAULT '1.0.0',
  force_update           boolean     NOT NULL DEFAULT false,
  app_icon_url           text,
  splash_image_url       text,
  custom_login_background text,
  login_style            text        NOT NULL DEFAULT 'default'
                         CHECK (login_style IN ('default', 'minimal', 'branded', 'fullscreen')),
  push_certificate_ios   text,
  fcm_key_android        text,
  download_count_ios     integer     NOT NULL DEFAULT 0,
  download_count_android integer     NOT NULL DEFAULT 0,
  last_published_at      timestamptz,
  is_active              boolean     NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Tolerate a pre-existing table with a different (slimmer) layout.
ALTER TABLE public.school_apps
  ADD COLUMN IF NOT EXISTS app_name text,
  ADD COLUMN IF NOT EXISTS bundle_id_ios text,
  ADD COLUMN IF NOT EXISTS package_name_android text,
  ADD COLUMN IF NOT EXISTS ios_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS android_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS app_store_url text,
  ADD COLUMN IF NOT EXISTS play_store_url text,
  ADD COLUMN IF NOT EXISTS current_version text NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS min_version text NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS force_update boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS app_icon_url text,
  ADD COLUMN IF NOT EXISTS splash_image_url text,
  ADD COLUMN IF NOT EXISTS custom_login_background text,
  ADD COLUMN IF NOT EXISTS login_style text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS push_certificate_ios text,
  ADD COLUMN IF NOT EXISTS fcm_key_android text,
  ADD COLUMN IF NOT EXISTS download_count_ios integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS download_count_android integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- The POST route upserts with onConflict: "school_id".
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.school_apps GROUP BY school_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'school_apps has several rows for one school - unique(school_id) skipped; the upsert in /api/web/super-admin/apps needs it';
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS school_apps_school_id_key ON public.school_apps (school_id)';
  END IF;
EXCEPTION WHEN datatype_mismatch OR undefined_function THEN
  RAISE NOTICE 'school_apps.school_id has an unexpected type (%): unique index skipped', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_school_apps_school_id ON public.school_apps (school_id);

-- -----------------------------------------------------------------------------
-- school_app_versions: release history
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_app_versions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  version       text        NOT NULL,
  platform      text        NOT NULL CHECK (platform IN ('ios', 'android', 'both')),
  changelog     text,
  build_number  text,
  is_mandatory  boolean     NOT NULL DEFAULT false,
  published_at  timestamptz,
  published_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.school_app_versions
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS changelog text,
  ADD COLUMN IF NOT EXISTS build_number text,
  ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_school_app_versions_school_id ON public.school_app_versions (school_id);

-- -----------------------------------------------------------------------------
-- camelCase tables (parity with the sister project's live schema; empty, service-role only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.apps (
  "id"          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "schoolId"    uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  "name"        text        NOT NULL,
  "platform"    text        NOT NULL DEFAULT 'both',
  "bundleId"    text,
  "packageName" text,
  "appStoreUrl" text,
  "playStoreUrl" text,
  "webUrl"      text,
  "isActive"    boolean     NOT NULL DEFAULT true,
  "createdAt"   timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "apps_schoolId_key" ON public.apps ("schoolId");
CREATE INDEX IF NOT EXISTS "apps_isActive_idx" ON public.apps ("isActive");

CREATE TABLE IF NOT EXISTS public.app_features (
  "id"        text    PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "appId"     text    NOT NULL REFERENCES public.apps("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "moduleKey" text    NOT NULL,
  "isEnabled" boolean NOT NULL DEFAULT true,
  "config"    jsonb,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "app_features_appId_idx" ON public.app_features ("appId");
CREATE UNIQUE INDEX IF NOT EXISTS "app_features_appId_moduleKey_key" ON public.app_features ("appId", "moduleKey");

CREATE TABLE IF NOT EXISTS public.app_themes (
  "id"              text    PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "appId"           text    NOT NULL REFERENCES public.apps("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "name"            text    NOT NULL DEFAULT 'default',
  "type"            text    NOT NULL DEFAULT 'preset',
  "presetId"        text,
  "primaryColor"    text,
  "secondaryColor"  text,
  "accentColor"     text,
  "textColor"       text,
  "sidebarColor"    text,
  "topbarColor"     text,
  "fontFamily"      text,
  "logoUrl"         text,
  "darkModeEnabled" boolean NOT NULL DEFAULT false,
  "borderRadius"    text    NOT NULL DEFAULT 'md',
  "customCss"       text,
  "createdAt"       timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "app_themes_appId_key" ON public.app_themes ("appId");

CREATE TABLE IF NOT EXISTS public.app_usage_limits (
  "id"              text    PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "appId"           text    NOT NULL REFERENCES public.apps("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "maxStudents"     integer NOT NULL DEFAULT 500,
  "maxBranches"     integer NOT NULL DEFAULT 5,
  "maxStorageMB"    integer NOT NULL DEFAULT 1024,
  "maxUsers"        integer NOT NULL DEFAULT 50,
  "maxClasses"      integer NOT NULL DEFAULT 50,
  "currentStudents" integer NOT NULL DEFAULT 0,
  "currentBranches" integer NOT NULL DEFAULT 0,
  "currentStorageMB" integer NOT NULL DEFAULT 0,
  "currentUsers"    integer NOT NULL DEFAULT 0,
  "currentClasses"  integer NOT NULL DEFAULT 0,
  "createdAt"       timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "app_usage_limits_appId_key" ON public.app_usage_limits ("appId");

-- -----------------------------------------------------------------------------
-- RLS: service_role + super_admin only
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_apps', 'school_app_versions', 'apps', 'app_features', 'app_themes', 'app_usage_limits']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service_role', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_super_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING ((SELECT public.current_app_role()) = ''super_admin'') '
      'WITH CHECK ((SELECT public.current_app_role()) = ''super_admin'')',
      t || '_super_admin', t);
  END LOOP;
END $$;
