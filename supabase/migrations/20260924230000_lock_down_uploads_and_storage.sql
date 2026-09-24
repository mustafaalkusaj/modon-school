-- Applied to production (mudon-school) on 2026-09-24 after a rolled-back dry run.
--
-- upload_sessions: the phone upload page and the status poll go through
-- /api/web/upload/* with the service role, and the desktop listens as school
-- staff (tenant_staff_all). These policies let anyone list every pending
-- upload token and mark any session "completed" with an arbitrary image_url,
-- and let students/teachers read their school's tokens.
drop policy if exists "anon_select_upload_sessions_by_token" on public.upload_sessions;
drop policy if exists "anon_update_upload_sessions_by_token" on public.upload_sessions;
drop policy if exists "auth_select_upload_sessions" on public.upload_sessions;

-- storage.objects: every bucket allowed any signed-in user (students
-- included) to insert, overwrite and delete any object. The buckets are
-- public, so reads never go through these policies. Writes with a user token
-- only come from staff routes, which store objects under "<school_id>/...".
drop policy if exists "Allow auth delete attachments" on storage.objects;
drop policy if exists "Allow auth delete avatars" on storage.objects;
drop policy if exists "Allow auth delete notification-media" on storage.objects;
drop policy if exists "Allow auth delete student-photos" on storage.objects;
drop policy if exists "Allow auth read attachments" on storage.objects;
drop policy if exists "Allow auth read avatars" on storage.objects;
drop policy if exists "Allow auth read notification-media" on storage.objects;
drop policy if exists "Allow auth read student-photos" on storage.objects;
drop policy if exists "Allow auth update attachments" on storage.objects;
drop policy if exists "Allow auth update avatars" on storage.objects;
drop policy if exists "Allow auth update notification-media" on storage.objects;
drop policy if exists "Allow auth update student-photos" on storage.objects;
drop policy if exists "Allow auth upload attachments" on storage.objects;
drop policy if exists "Allow auth upload avatars" on storage.objects;
drop policy if exists "Allow auth upload notification-media" on storage.objects;
drop policy if exists "Allow auth upload student-photos" on storage.objects;

create policy "tenant_school_folder_select" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('attachments', 'avatars', 'notification-media', 'student-photos')
    and (
      (select public.app_is_super_admin())
      or ((select public.app_is_school_staff())
          and (storage.foldername(name))[1] = (select public.current_school_id())::text)
    )
  );

create policy "tenant_school_folder_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('attachments', 'avatars', 'notification-media', 'student-photos')
    and (
      (select public.app_is_super_admin())
      or ((select public.app_is_school_staff())
          and (storage.foldername(name))[1] = (select public.current_school_id())::text)
    )
  );

create policy "tenant_school_folder_update" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('attachments', 'avatars', 'notification-media', 'student-photos')
    and (
      (select public.app_is_super_admin())
      or ((select public.app_is_school_staff())
          and (storage.foldername(name))[1] = (select public.current_school_id())::text)
    )
  )
  with check (
    bucket_id in ('attachments', 'avatars', 'notification-media', 'student-photos')
    and (
      (select public.app_is_super_admin())
      or ((select public.app_is_school_staff())
          and (storage.foldername(name))[1] = (select public.current_school_id())::text)
    )
  );

create policy "tenant_school_folder_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('attachments', 'avatars', 'notification-media', 'student-photos')
    and (
      (select public.app_is_super_admin())
      or ((select public.app_is_school_staff())
          and (storage.foldername(name))[1] = (select public.current_school_id())::text)
    )
  );
