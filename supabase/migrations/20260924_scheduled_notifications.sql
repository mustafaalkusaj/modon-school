-- Scheduled notifications table
-- Allows admins to schedule notifications for future delivery
create table if not exists scheduled_notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  created_by uuid not null,

  title text not null,
  message text not null,
  type text not null default 'general',
  link text,

  -- targeting
  target_scope text not null check (target_scope in ('school', 'branch', 'class', 'role', 'user')),
  target_value text,

  -- scheduling
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled', 'failed')),
  sent_at timestamptz,
  result jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_scheduled_notifications_pending
  on scheduled_notifications (scheduled_at)
  where status = 'pending';

create index if not exists idx_scheduled_notifications_school
  on scheduled_notifications (school_id, status);
