-- Applied to production (mudon-school) on 2026-09-24.
--
-- provision_admin_account creates a super_admin and was executable by anon
-- through /rest/v1/rpc. The app never calls it; keep it service_role only.
REVOKE EXECUTE ON FUNCTION public.provision_admin_account(text, text, text) FROM PUBLIC, anon, authenticated;

-- Trusts p_school_id; only called with the service-role client.
REVOKE EXECUTE ON FUNCTION public.create_exam_atomic(uuid, uuid, text, text, text, text, timestamptz, timestamptz, numeric, jsonb) FROM PUBLIC, anon, authenticated;

-- Trusts p_school_id. Anonymous callers are never legitimate. The web
-- payments route still calls it as `authenticated` until the matching app
-- change ships, so that grant is removed in a follow-up migration.
REVOKE EXECUTE ON FUNCTION public.create_payment_atomic(uuid, uuid, uuid, numeric, text, text, timestamptz, text, text) FROM PUBLIC, anon;

-- Trigger function; triggers do not need the caller to hold EXECUTE.
REVOKE EXECUTE ON FUNCTION public.archive_before_delete() FROM PUBLIC, anon, authenticated;
