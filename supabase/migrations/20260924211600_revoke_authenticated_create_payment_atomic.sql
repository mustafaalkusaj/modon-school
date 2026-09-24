-- Apply ONLY after the app release in which app/api/web/payments/records
-- calls create_payment_atomic with the service-role client. Before that,
-- recording payments from the web dashboard would fail.
--
-- The function is SECURITY DEFINER and trusts p_school_id, so any signed-in
-- user holding EXECUTE could insert payments into any school.
REVOKE EXECUTE ON FUNCTION public.create_payment_atomic(uuid, uuid, uuid, numeric, text, text, timestamptz, text, text) FROM authenticated;
