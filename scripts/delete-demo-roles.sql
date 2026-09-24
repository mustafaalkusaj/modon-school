-- Removes everything seeded by scripts/seed-demo-roles.mjs.
-- Scoped strictly to the QA_DEMO_SCHOOL namespace, so it cannot touch real data.
-- Run in the Supabase SQL editor, or: psql "$DATABASE_URL" -f scripts/delete-demo-roles.sql

do $$
declare
  v_school uuid;
  v_uids uuid[];
begin
  select id into v_school from public.schools where name = 'QA_DEMO_SCHOOL' limit 1;

  select array_agg(id) into v_uids
  from auth.users
  where email in (
    'qa.superadmin.demo@example.test',
    'qa.admin.demo@example.test',
    't9001@schoolapp.local',
    's9001@schoolapp.local'
  );

  if v_uids is not null then
    delete from public.managed_user_credentials where auth_user_id = any(v_uids);
    delete from public.managed_user_profiles   where auth_user_id = any(v_uids);
    delete from public.user_profiles           where id           = any(v_uids);
    delete from auth.identities                where user_id      = any(v_uids);
    delete from auth.users                     where id           = any(v_uids);
  end if;

  if v_school is not null then
    delete from public.students      where school_id = v_school;
    delete from public.teachers      where school_id = v_school;
    delete from public.branches      where school_id = v_school;
    delete from public.subscriptions where school_id = v_school;
    delete from public.schools       where id        = v_school;
  end if;

  raise notice 'QA_DEMO cleanup done (school=%, users=%)', v_school, coalesce(array_length(v_uids, 1), 0);
end $$;
