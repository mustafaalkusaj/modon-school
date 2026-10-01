-- =============================================================================
-- Storage privacy: make buckets that hold personal data PRIVATE
-- Ported from the sister school-app project (20260719065208_storage_privacy_closure,
-- 20260728090700_close_storage_holes part (a)).
--
-- *** BREAKING CHANGE - REVIEW BEFORE APPLYING ***
-- Flipping a bucket to private makes every stored getPublicUrl() link for it
-- stop working. Apply ONLY after the deployed app serves these buckets through
-- the protected gateway (lib/protected-storage-url.ts -> /api/web/storage/file,
-- or signed URLs) and no stored public URL is still rendered to users.
-- Rollback: UPDATE storage.buckets SET public = true WHERE id IN (...).
--
-- WHAT THIS DOES
--   * Sets public = false on: attachments, avatars, exam-photos,
--     grade-certificates, notification-media, student-photos, teacher-documents
--     (the set lib/protected-storage-url.ts PRIVATE_WEB_BUCKETS covers, plus
--     exam-photos which is server-only). school-logos / branch-logos stay
--     public on purpose (they are branding shown on the login page).
--   * Caps size / MIME only where the bucket has no limit yet:
--     avatars + student-photos 2 MB images, grade-certificates 5 MB images.
--   * Adds school-folder scoped policies for grade-certificates and
--     teacher-documents (modon's 20260924230000 already covers attachments,
--     avatars, notification-media and student-photos): staff of the
--     school (plus teachers for grade-certificates only), first path segment must equal their school id.
--
-- Idempotent. APPLY ORDER: after 20261001090200, and only after the app
-- release described above.
-- =============================================================================

UPDATE storage.buckets
   SET public = false
 WHERE id IN (
   'attachments',
   'avatars',
   'exam-photos',
   'grade-certificates',
   'notification-media',
   'student-photos',
   'teacher-documents'
 )
   AND public IS DISTINCT FROM false;

UPDATE storage.buckets
   SET file_size_limit    = COALESCE(file_size_limit, 2097152),
       allowed_mime_types = COALESCE(allowed_mime_types, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[])
 WHERE id IN ('avatars', 'student-photos');

UPDATE storage.buckets
   SET file_size_limit    = COALESCE(file_size_limit, 5242880),
       allowed_mime_types = COALESCE(allowed_mime_types, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[])
 WHERE id = 'grade-certificates';

-- Same school-folder rule as the sister project's sensitive_school_files_staff_scope, with
-- one deliberate difference: teachers may touch grade-certificates but NOT
-- teacher-documents (HR files of their colleagues).
DROP POLICY IF EXISTS sensitive_school_files_staff_scope ON storage.objects;
CREATE POLICY sensitive_school_files_staff_scope ON storage.objects
  FOR ALL TO authenticated
  USING (
    (storage.foldername(name))[1] = (SELECT public.current_school_id())::text
    AND (
      (bucket_id = 'grade-certificates'
        AND (SELECT public.current_app_role()) IN ('super_admin', 'admin', 'employee', 'manager', 'teacher'))
      OR (bucket_id = 'teacher-documents'
        AND (SELECT public.current_app_role()) IN ('super_admin', 'admin', 'employee', 'manager'))
    )
  )
  WITH CHECK (
    (storage.foldername(name))[1] = (SELECT public.current_school_id())::text
    AND (
      (bucket_id = 'grade-certificates'
        AND (SELECT public.current_app_role()) IN ('super_admin', 'admin', 'employee', 'manager', 'teacher'))
      OR (bucket_id = 'teacher-documents'
        AND (SELECT public.current_app_role()) IN ('super_admin', 'admin', 'employee', 'manager'))
    )
  );
