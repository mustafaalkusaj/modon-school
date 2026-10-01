-- =============================================================================
-- Storage: bucket definitions + tenant-scoped storage.objects policies
-- Ported from the sister school-app project (20260424_000000_logo_storage_policies,
-- 20260728053925_scope_storage_policies_to_caller_school,
-- 20260728090700_close_storage_holes) and adapted to modon.
--
-- REVIEW BEFORE APPLYING. Idempotent and NON-BREAKING:
--   * It never flips an existing bucket from public to private (that lives in
--     20261001090300_storage_bucket_privacy_flip.sql, to be applied only after
--     the app serves those buckets through /api/web/storage/file).
--   * It only creates missing buckets and (re)creates policies.
--
-- WHAT THIS DOES
--   * Creates the buckets modon's code uses if they are missing:
--     school-media (PRIVATE, 20 MB), financial-receipts (PRIVATE, 5 MB images),
--     exam-photos (PRIVATE), school-logos / branch-logos (public, 2 MB).
--   * school-logos / branch-logos: public read; write only through
--     public.can_manage_logo_bucket_object() (admins of the school folder,
--     super_admin anywhere).
--   * school-media: full CRUD for authenticated users inside their own school
--     folder ("<school_id>/..."). UPDATE/DELETE additionally require owning the
--     object or being staff/teacher, so a student cannot delete a classmate's
--     upload.
--   * financial-receipts, exam-photos: NO client policies - service workflow
--     only (receipt uploads and QR exam-photo uploads go through server routes).
--   * Existing buckets keep their current policies (modon already has
--     tenant_school_folder_* on attachments/avatars/notification-media/
--     student-photos from 20260924230000).
--
-- Depends on: 20261001090100 (public.can_manage_logo_bucket_object wrapper) and
-- modon's public.current_app_role() / public.current_school_id().
-- APPLY ORDER: after 20261001090100.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Buckets (only creates what is missing; existing rows keep their settings
-- except where a column is still NULL).
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('school-media',       'school-media',       false, 20971520, NULL),
  ('financial-receipts', 'financial-receipts', false, 5242880,  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('exam-photos',        'exam-photos',        false, 5242880,  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('school-logos',       'school-logos',       true,  2097152,  NULL),
  ('branch-logos',       'branch-logos',       true,  2097152,  NULL)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = COALESCE(storage.buckets.file_size_limit, EXCLUDED.file_size_limit),
      allowed_mime_types = COALESCE(storage.buckets.allowed_mime_types, EXCLUDED.allowed_mime_types);

-- -----------------------------------------------------------------------------
-- Logos: public read, admin-scoped writes
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  b text;
  p text;
BEGIN
  FOREACH b IN ARRAY ARRAY['school-logos', 'branch-logos']
  LOOP
    p := replace(b, '-', '_');

    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p || '_public_read');
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR SELECT TO public USING (bucket_id = %L)',
      p || '_public_read', b);

    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p || '_admin_insert');
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated '
      'WITH CHECK (bucket_id = %L AND public.can_manage_logo_bucket_object(bucket_id, name))',
      p || '_admin_insert', b);

    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p || '_admin_update');
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated '
      'USING (bucket_id = %L AND public.can_manage_logo_bucket_object(bucket_id, name)) '
      'WITH CHECK (bucket_id = %L AND public.can_manage_logo_bucket_object(bucket_id, name))',
      p || '_admin_update', b, b);

    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p || '_admin_delete');
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated '
      'USING (bucket_id = %L AND public.can_manage_logo_bucket_object(bucket_id, name))',
      p || '_admin_delete', b);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- school-media: school-folder scoped CRUD
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS school_media_auth_read ON storage.objects;
CREATE POLICY school_media_auth_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'school-media'
    AND (storage.foldername(name))[1] = (SELECT public.current_school_id())::text
  );

DROP POLICY IF EXISTS school_media_scoped_insert ON storage.objects;
CREATE POLICY school_media_scoped_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'school-media'
    AND (storage.foldername(name))[1] = (SELECT public.current_school_id())::text
  );

DROP POLICY IF EXISTS school_media_scoped_update ON storage.objects;
CREATE POLICY school_media_scoped_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'school-media'
    AND (storage.foldername(name))[1] = (SELECT public.current_school_id())::text
    AND (
      owner = (SELECT auth.uid())
      OR (SELECT public.current_app_role()) = ANY (ARRAY['admin', 'super_admin', 'employee', 'teacher'])
    )
  )
  WITH CHECK (
    bucket_id = 'school-media'
    AND (storage.foldername(name))[1] = (SELECT public.current_school_id())::text
  );

DROP POLICY IF EXISTS school_media_scoped_delete ON storage.objects;
CREATE POLICY school_media_scoped_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'school-media'
    AND (storage.foldername(name))[1] = (SELECT public.current_school_id())::text
    AND (
      owner = (SELECT auth.uid())
      OR (SELECT public.current_app_role()) = ANY (ARRAY['admin', 'super_admin', 'employee', 'teacher'])
    )
  );

-- financial-receipts and exam-photos intentionally get no client policies:
-- with RLS on storage.objects and no matching policy, only service_role (which
-- bypasses RLS) can read or write them.
