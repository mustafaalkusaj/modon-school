-- Plaintext teacher app passwords. No API reads or writes this column any
-- more (see the C1-MIGRATION TODOs, now removed), and it held no data when
-- dropped. Credentials live in managed_user_credentials. Applied 2026-09-25.
alter table public.teachers drop column if exists app_password_plain;
