-- Applied to production (mudon-school) on 2026-09-24 and verified: 349
-- tenant_* policies, 0 blanket policies left, 0 tables without RLS.
--
-- Tenant isolation for every table that was protected only by
-- "Allow authenticated …" policies with USING (true). Those policies let any
-- signed-in user (including students) read and write every school's data
-- directly through PostgREST, and let anyone read/write ads.
--
-- Access model after this migration (service_role bypasses RLS as before):
--   * super_admin: everything.
--   * school staff (admin/employee/manager/transport_manager): rows of their
--     own school; shared rows (school_id IS NULL) readable.
--   * any member: own profile/school/subscription, own notifications.
--   * parents: their linked children's student/attendance/grades/payments.
--   * secrets (qr_login_tokens, encryption_keys, key_rotation_log, sessions):
--     service_role only; platform/ops tables: super_admin only.
-- Student/teacher/driver/mobile APIs use the service client and are
-- unaffected.

create or replace function public.app_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'super_admin', false);
$$;

create or replace function public.app_is_school_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_app_role() in ('admin', 'employee', 'manager', 'transport_manager'),
    false
  );
$$;

revoke execute on function public.app_is_super_admin() from public, anon;
revoke execute on function public.app_is_school_staff() from public, anon;
grant execute on function public.app_is_super_admin() to authenticated;
grant execute on function public.app_is_school_staff() to authenticated;

-- Staff may edit profiles in their school, but nobody except a super_admin
-- (or the service role) may grant super_admin, move a user to another
-- school, or change their own privileges.
create or replace function public.guard_user_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  self_editable constant text[] := array['full_name', 'avatar_url', 'phone', 'job_title'];
begin
  if coalesce(auth.role(), '') <> 'authenticated' or public.app_is_super_admin() then
    return new;
  end if;

  if new.role = 'super_admin' and old.role is distinct from 'super_admin' then
    raise exception 'only a super_admin can grant super_admin' using errcode = '42501';
  end if;

  if new.school_id is distinct from old.school_id then
    raise exception 'cannot move a user to another school' using errcode = '42501';
  end if;

  if new.id = auth.uid()
     and (to_jsonb(new) - self_editable) is distinct from (to_jsonb(old) - self_editable) then
    raise exception 'cannot change your own role or permissions' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_user_profile_privileges() from public, anon, authenticated;

drop trigger if exists guard_user_profile_privileges on public.user_profiles;
create trigger guard_user_profile_privileges
  before update on public.user_profiles
  for each row execute function public.guard_user_profile_privileges();

-- Replace the blanket "USING (true)" policies with scoped ones. The set of
-- affected tables is read from the live catalog so this stays in sync with
-- what production actually had.
do $mig$
declare
  sa    constant text := '(select public.app_is_super_admin())';
  staff constant text := '(select public.app_is_school_staff())';
  sch   constant text := '(select public.current_school_id())';
  uid   constant text := '(select auth.uid())';
  kids  constant text := '(select psl.student_id from public.parent_student_links psl where psl.parent_user_id = (select auth.uid()))';

  service_only constant text[] := array['qr_login_tokens', 'encryption_keys', 'key_rotation_log', 'sessions'];
  super_only constant text[] := array[
    'admin_kv_store', 'backup_logs', 'bot_access_logs', 'bot_settings', 'cache_stats',
    'connection_pool_metrics', 'crm_leads', 'daily_reports', 'deleted_data_archive',
    'dependency_audits', 'global_settings', 'health_checks', 'hourly_stats', 'ops_alerts',
    'ops_errors', 'ops_health_reports', 'ops_pending_actions', 'ops_subscription_snapshots',
    'performance_metrics', 'platform_settings', 'query_cache', 'slow_query_log',
    'trial_activations', 'error_logs'];
  catalog constant text[] := array[
    'perm_definitions', 'perm_modules', 'perm_pages', 'rbac_permissions',
    'rbac_role_permissions', 'role_perm_assignments', 'feature_flags', 'changelog_entries'];
  -- Tables without school_id: %s is replaced by the caller's school expression.
  joined constant jsonb := jsonb_build_object(
    'exam_questions', 'exists (select 1 from public.exams e where e.id = exam_id and e.school_id = %s)',
    'exam_settings', 'exists (select 1 from public.exams e where e.id = exam_id and e.school_id = %s)',
    'exam_schedule_notifications', 'exists (select 1 from public.exams e where e.id = exam_id and e.school_id = %s)',
    'exam_rubrics', 'exists (select 1 from public.questions q where q.id = question_id and q.school_id = %s)',
    'student_answers', 'exists (select 1 from public.exam_attempts a where a.id = attempt_id and a.school_id = %s)',
    'activity_attachments', 'exists (select 1 from public.teacher_activities ta where ta.id = activity_id and ta.school_id = %s)',
    'activity_views', 'exists (select 1 from public.teacher_activities ta where ta.id = activity_id and ta.school_id = %s)',
    'activity_reports', 'exists (select 1 from public.teacher_activities ta where ta.id = activity_id and ta.school_id = %s)',
    'ad_reactions', 'exists (select 1 from public.ads ad where ad.id = ad_id and ad.school_id = %s)',
    'branch_receipt_config', 'exists (select 1 from public.branches b where b.id = branch_id and b.school_id = %s)',
    'group_alerts', 'exists (select 1 from public.branches b where b.id = branch_id and b.school_id = %s)',
    'conversation_participants', 'exists (select 1 from public.conversations c where c.id = conversation_id and c.school_id = %s)',
    'messages', 'exists (select 1 from public.conversations c where c.id = conversation_id and c.school_id = %s)',
    'message_status', 'exists (select 1 from public.messages m join public.conversations c on c.id = m.conversation_id where m.id = message_id and c.school_id = %s)',
    'notification_recipients', 'exists (select 1 from public.notifications n where n.id = notification_id and n.school_id = %s)',
    'fee_notification_recipients', 'exists (select 1 from public.fee_notifications f where f.id = fee_notification_id and f.school_id = %s)',
    'user_perm_overrides', 'exists (select 1 from public.user_profiles up where up.id = user_id and up.school_id = %s)',
    'user_permissions', 'exists (select 1 from public.user_profiles up where up.id = user_id and up.school_id = %s)',
    'audit_log', 'exists (select 1 from public.user_profiles up where up.id = user_id and up.school_id = %s)');

  t text;
  col_type text;
  col_nullable boolean;
  cond text;
  open_tables text[];
  r record;
begin
  select array_agg(distinct tablename order by tablename) into open_tables
  from pg_policies
  where schemaname = 'public'
    and roles::text in ('{authenticated}', '{public}')
    and (coalesce(qual, '') in ('true', '(true)') or coalesce(with_check, '') in ('true', '(true)'));

  if open_tables is null then
    raise notice 'no blanket policies found; nothing to do';
    return;
  end if;

  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and roles::text in ('{authenticated}', '{public}')
      and (coalesce(qual, '') in ('true', '(true)') or coalesce(with_check, '') in ('true', '(true)'))
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;

  foreach t in array open_tables loop
    continue when t = any(service_only);

    execute format('create policy tenant_super_admin_all on public.%I for all to authenticated using (%s) with check (%s)', t, sa, sa);
    continue when t = any(super_only);

    if t = any(catalog) then
      execute format('create policy tenant_authenticated_read on public.%I for select to authenticated using (true)', t);
      continue;
    end if;

    if t = 'school_groups' then
      execute format('create policy tenant_staff_read on public.%I for select to authenticated using (%s)', t, staff);
      continue;
    end if;

    if t = 'schools' then
      execute format('create policy tenant_member_read_own_school on public.schools for select to authenticated using (id = %s)', sch);
      execute format('create policy tenant_staff_update_own_school on public.schools for update to authenticated using (%1$s and id = %2$s) with check (%1$s and id = %2$s)', staff, sch);
      continue;
    end if;

    if t = 'subscriptions' then
      execute format('create policy tenant_member_read_own_subscription on public.subscriptions for select to authenticated using (school_id = %s)', sch);
      continue;
    end if;

    if joined ? t then
      cond := staff || ' and ' || format(joined ->> t, sch);
      execute format('create policy tenant_staff_all on public.%I for all to authenticated using (%s) with check (%s)', t, cond, cond);
      if t in ('notification_recipients', 'conversation_participants', 'user_perm_overrides', 'user_permissions', 'audit_log') then
        execute format('create policy tenant_own_read on public.%I for select to authenticated using (user_id = %s)', t, uid);
      end if;
      if t = 'notification_recipients' then
        execute format('create policy tenant_own_update on public.notification_recipients for update to authenticated using (user_id = %1$s) with check (user_id = %1$s)', uid);
      end if;
      continue;
    end if;

    select c.data_type, c.is_nullable = 'YES' into col_type, col_nullable
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t and c.column_name = 'school_id';

    if col_type is null then
      raise exception 'table % has a blanket policy but no rule in this migration', t;
    end if;

    cond := format('%s and school_id = %s', staff, case when col_type = 'uuid' then sch else sch || '::text' end);
    execute format('create policy tenant_staff_all on public.%I for all to authenticated using (%s) with check (%s)', t, cond, cond);

    if col_nullable then
      execute format('create policy tenant_staff_read_shared on public.%I for select to authenticated using (%s and school_id is null)', t, staff);
    end if;

    if t = 'audit_logs' then
      execute format('create policy tenant_own_insert on public.audit_logs for insert to authenticated with check (actor_id = %s)', uid);
    elsif t = 'user_profiles' then
      execute format('create policy tenant_own_read on public.user_profiles for select to authenticated using (id = %s)', uid);
    elsif t in ('managed_user_profiles', 'teachers') then
      execute format('create policy tenant_own_read on public.%I for select to authenticated using (auth_user_id = %s)', t, uid);
    elsif t = 'students' then
      execute format('create policy tenant_own_read on public.students for select to authenticated using (auth_user_id = %s)', uid);
      execute format('create policy tenant_parent_read_children on public.students for select to authenticated using (id in %s)', kids);
    elsif t in ('attendance', 'behavior_records', 'grade_entries', 'payments') then
      execute format('create policy tenant_parent_read_children on public.%I for select to authenticated using (student_id in %s)', t, kids);
    elsif t = 'parent_student_links' then
      execute format('create policy tenant_parent_read_own on public.parent_student_links for select to authenticated using (parent_user_id = %s)', uid);
    elsif t = 'notifications' then
      execute format('create policy tenant_own_read on public.notifications for select to authenticated using (user_id = %s)', uid);
      execute format('create policy tenant_own_update on public.notifications for update to authenticated using (user_id = %1$s) with check (user_id = %1$s)', uid);
    elsif t = 'user_push_subscriptions' then
      execute format('create policy tenant_own_all on public.user_push_subscriptions for all to authenticated using (user_id = %1$s) with check (user_id = %1$s)', uid);
    end if;
  end loop;
end
$mig$;
