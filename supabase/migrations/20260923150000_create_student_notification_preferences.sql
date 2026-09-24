-- ============================================================
-- student_notification_preferences: per-student toggle state for
-- which notification categories the student wants to receive.
--
-- Required by: /api/student/settings/notifications (GET fetches the
-- row, POST upserts it). One row per student; missing row = all
-- defaults enabled (handled in application code, not here).
--
-- Notes:
--   • student_id → public.students.id (uuid, set in baseline).
--   • school_id  → public.schools.id (uuid, set in baseline) —
--     denormalized for RLS scoping, same pattern as
--     parent_student_links.
--   • Unique on student_id — one preferences row per student,
--     upserted via onConflict: "student_id".
-- ============================================================

create table if not exists public.student_notification_preferences (
  id           uuid        primary key default gen_random_uuid(),
  student_id   uuid        not null references public.students(id) on delete cascade,
  school_id    uuid        not null references public.schools(id) on delete cascade,
  grades       boolean     not null default true,
  attendance   boolean     not null default true,
  assignments  boolean     not null default true,
  exams        boolean     not null default true,
  messages     boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (student_id)
);

create index if not exists idx_student_notification_prefs_student on public.student_notification_preferences (student_id);
create index if not exists idx_student_notification_prefs_school  on public.student_notification_preferences (school_id);

-- RLS
alter table public.student_notification_preferences enable row level security;

-- Students can see and manage only their own preferences row.
drop policy if exists student_manage_own_notification_prefs on public.student_notification_preferences;
create policy student_manage_own_notification_prefs
  on public.student_notification_preferences
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.students s
      where s.id = student_notification_preferences.student_id
        and s.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.students s
      where s.id = student_notification_preferences.student_id
        and s.auth_user_id = auth.uid()
    )
  );

-- Admins and super_admins can view preferences for their own school.
drop policy if exists admin_view_notification_prefs on public.student_notification_preferences;
create policy admin_view_notification_prefs
  on public.student_notification_preferences
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.managed_user_profiles mup
      where mup.auth_user_id = auth.uid()
        and mup.school_id    = student_notification_preferences.school_id
        and mup.role         in ('admin', 'super_admin')
    )
  );
