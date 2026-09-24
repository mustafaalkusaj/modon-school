-- 20260924_scheduled_notifications.sql was never applied to production, so
-- scheduling notifications failed and the cron had nothing to read. Both
-- were applied together on 2026-09-24. The table is written by the staff
-- /api/web/notifications/schedule route (user token) and read by the cron
-- (service role), so it gets the same tenant policies as other school tables.
alter table public.scheduled_notifications enable row level security;

create policy tenant_super_admin_all on public.scheduled_notifications
  for all to authenticated
  using ((select public.app_is_super_admin()))
  with check ((select public.app_is_super_admin()));

create policy tenant_staff_all on public.scheduled_notifications
  for all to authenticated
  using ((select public.app_is_school_staff()) and school_id = (select public.current_school_id()))
  with check ((select public.app_is_school_staff()) and school_id = (select public.current_school_id()));
