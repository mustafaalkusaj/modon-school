-- ============================================================
-- account_deletion_requests: the account-deletion (GDPR Art. 17 /
-- Apple 5.1.1(v) / Google Play) request queue.
--
-- WHY THIS MIGRATION EXISTS
--   The application code already reads and writes this table, but no
--   migration ever created it, so it is missing in production. Every
--   caller therefore fails (42P01 -> 503/500):
--     • app/api/mobile/account/delete-request   (file / read own request)
--     • app/api/web/account/deletion-requests   (admin list / execute / reject)
--     • app/api/web/account/export              (subject-access export)
--     • app/api/cron/account-deletion           (queue drain)
--   via lib/account-deletion/{queue,supabase-gateway,export}.ts.
--
-- SHAPE — derived from the code, not invented:
--   • lib/account-deletion/types.ts  AccountDeletionRequest (read shape)
--   • lib/account-deletion/policy.ts AccountDeletionStatus  (status union)
--   • supabase-gateway.ts / deletion-requests route writes
--     processing_started_at, failure_reason, erasure_summary, updated_at.
--   • mobile insert only sends auth_user_id, school_id, reason, metadata,
--     so status / requested_at / metadata need defaults.
--   • policy.ts: auth_user_id FK is ON DELETE SET NULL so the row (the
--     proof the erasure happened) survives the auth.users delete.
--   • school_id is NOT NULL in the TS type and always supplied, so it
--     follows the repo convention: references schools ON DELETE CASCADE.
--
-- RLS: enabled with NO policies on purpose. Every access path uses the
-- service-role client (createServiceSupabaseClient / mobile
-- context.serviceSupabase), which bypasses RLS. anon/authenticated get
-- no access at all, and their table grants are revoked as well.
--
-- NOTE: the executor also calls the RPC
-- public.execute_account_deletion_erasure(...), which is NOT created
-- here (out of scope for this migration).
-- ============================================================

create table if not exists public.account_deletion_requests (
  id                     uuid        primary key default gen_random_uuid(),
  auth_user_id           uuid        references auth.users(id) on delete set null,
  school_id              uuid        not null references public.schools(id) on delete cascade,
  status                 text        not null default 'pending',
  reason                 text,
  requested_at           timestamptz not null default now(),
  verified_at            timestamptz,
  processing_started_at  timestamptz,
  completed_at           timestamptz,
  cancelled_at           timestamptz,
  retention_deadline     timestamptz,
  handled_by             uuid        references auth.users(id) on delete set null,
  resolution_note        text,
  failure_reason         text,
  erasure_summary        jsonb,
  metadata               jsonb       not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint account_deletion_requests_status_check check (
    status in (
      'pending',
      'in_review',
      'verified',
      'processing',
      'completed',
      'failed',
      'rejected',
      'cancelled'
    )
  )
);

-- Cron queue (lib/account-deletion/queue.ts loadDueDeletionRequests):
--   status in ERASABLE_STATUSES and requested_at <= now() - 72h
--   order by requested_at asc
create index if not exists idx_account_deletion_requests_due
  on public.account_deletion_requests (requested_at)
  where status in ('pending', 'in_review', 'verified', 'failed');

-- Admin list (loadSchoolDeletionRequests): school_id = ? order by requested_at desc
create index if not exists idx_account_deletion_requests_school_requested
  on public.account_deletion_requests (school_id, requested_at desc);

-- Subject lookups (mobile GET / duplicate check, data export):
--   auth_user_id = ? [and school_id = ?] order by requested_at desc
create index if not exists idx_account_deletion_requests_auth_user_requested
  on public.account_deletion_requests (auth_user_id, requested_at desc);

-- At most one open request per user. The mobile route checks for an open
-- (pending/in_review/verified) request before inserting; this closes the
-- race between two concurrent submissions.
create unique index if not exists uq_account_deletion_requests_open_per_user
  on public.account_deletion_requests (auth_user_id)
  where auth_user_id is not null
    and status in ('pending', 'in_review', 'verified');

-- retention_deadline = requested_at + 7 business days (Sun–Thu working
-- week, Fri/Sat weekend, evaluated in UTC). Mirrors
-- computeRetentionDeadline() in lib/account-deletion/policy.ts. No insert
-- path sets it, and without it selectOverdue() can never flag a breach.
create or replace function public.account_deletion_requests_set_retention_deadline()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_cursor    timestamp;
  v_remaining integer := 7;
begin
  if new.retention_deadline is null then
    v_cursor := coalesce(new.requested_at, now()) at time zone 'UTC';
    while v_remaining > 0 loop
      v_cursor := v_cursor + interval '1 day';
      if extract(dow from v_cursor) not in (5, 6) then
        v_remaining := v_remaining - 1;
      end if;
    end loop;
    new.retention_deadline := v_cursor at time zone 'UTC';
  end if;
  return new;
end;
$$;

revoke all on function public.account_deletion_requests_set_retention_deadline() from public;

drop trigger if exists trg_account_deletion_requests_retention_deadline
  on public.account_deletion_requests;
create trigger trg_account_deletion_requests_retention_deadline
  before insert on public.account_deletion_requests
  for each row
  execute function public.account_deletion_requests_set_retention_deadline();

-- RLS: enabled, deliberately no policies (service_role bypasses RLS; see header).
alter table public.account_deletion_requests enable row level security;

revoke all on table public.account_deletion_requests from anon, authenticated;
