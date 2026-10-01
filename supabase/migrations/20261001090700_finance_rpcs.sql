-- =============================================================================
-- Finance RPCs: atomic payment, expense summaries, promotions, soft delete
-- Ported from the sister school-app project (20260507_000000_atomic_payment_with_lock,
-- 20260529_000000_fin001_payment_caller_school_guard,
-- 20260529_000002_fin002_payment_idempotency_window,
-- 20260403_010000_expenses_performance_and_overview,
-- 20260924213647_apply_student_promotions, baseline promote_year_execute /
-- soft_delete_student) and adapted to modon.
--
-- REVIEW BEFORE APPLYING. Idempotent. The first statement DROPs and re-creates
-- public.create_payment_atomic(...) because the live function's return type
-- cannot be changed with CREATE OR REPLACE; it is dropped and re-created in
-- the same transaction, so there is no window without the function. Existing
-- policies/views do not depend on it (it is only called through RPC).
--
-- ACCESS MODEL (matches modon's 20260924211500 / 20260924211600):
--   create_payment_atomic, promote_year_execute, soft_delete_student ->
--   service_role ONLY (the web/mobile routes authorize the actor first, then
--   call with the service client). When a user token is present (auth.uid()
--   not null) the functions additionally enforce the caller's school.
--   apply_student_promotions, school_expenses_summary,
--   school_expense_types_overview run as the CALLER (SECURITY INVOKER) so RLS
--   decides which rows are visible/changeable.
--
-- DEPENDS ON: 20261001090600 (resolve_class_fee, fee_override, fee_cycle_start),
--             20261001090400 (log_audit_action; optional - guarded).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_payment_atomic
--   * locks the student row (FOR UPDATE) so concurrent payments serialize;
--   * school guard: a user-token caller must belong to p_school_id (super_admin
--     exempt); the service role is trusted (the route already authorized it);
--   * idempotency window: an identical payment (student, amount, method) within
--     10 seconds is rejected as DUPLICATE_PAYMENT;
--   * never accepts more than the remaining balance (PAYMENT_EXCEEDS_REMAINING);
--   * the canonical receipt number comes from receipt_number_seq when the
--     caller passes none.
-- Error codes are returned in error_code (never raised) so the routes can map
-- them: SCHOOL_FORBIDDEN, STUDENT_NOT_FOUND, DUPLICATE_PAYMENT,
-- STUDENT_STATUS_<STATUS>, PAID_IN_FULL, PAYMENT_EXCEEDS_REMAINING.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_payment_atomic(
  uuid, uuid, uuid, numeric, text, text, timestamptz, text, text
);

CREATE FUNCTION public.create_payment_atomic(
  p_school_id uuid,
  p_student_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_notes text,
  p_created_at timestamptz,
  p_receipt_number text,
  p_manual_receipt_number text
)
RETURNS TABLE(
  id uuid,
  school_id uuid,
  branch_id uuid,
  student_id uuid,
  amount numeric,
  payment_method text,
  notes text,
  created_at timestamptz,
  receipt_number text,
  manual_receipt_number text,
  paid_fee_after numeric,
  remaining_fee_after numeric,
  error_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_student         record;
  v_class_fee       numeric;
  v_effective_total numeric;
  v_effective_disc  numeric;
  v_remaining       numeric;
  v_sum_paid        numeric;
  v_payment_id      uuid;
  v_receipt         text;
  v_created_at      timestamptz;
  v_branch_id       uuid;
  v_dup             uuid;
BEGIN
  -- School guard (user token only; service role is exempt).
  IF auth.uid() IS NOT NULL
     AND COALESCE(public.current_app_role(), '') <> 'super_admin'
     AND p_school_id IS DISTINCT FROM public.current_school_id() THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::numeric, NULL::text,
                        NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::numeric,
                        NULL::numeric, 'SCHOOL_FORBIDDEN'::text;
    RETURN;
  END IF;

  -- Lock the student row: concurrent payments for the same student serialize here.
  SELECT s.id, s.school_id AS s_school_id, s.branch_id AS s_branch_id, s.total_fee, s.discount_value,
         s.class_name, s.status, COALESCE(s.fee_override, false) AS fee_override, s.fee_cycle_start
    INTO v_student
    FROM public.students AS s
   WHERE s.id = p_student_id
     AND s.school_id = p_school_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::numeric, NULL::text,
                        NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::numeric,
                        NULL::numeric, 'STUDENT_NOT_FOUND'::text;
    RETURN;
  END IF;

  -- Idempotency window (the row lock above makes the second submit see the first).
  SELECT pay.id INTO v_dup
    FROM public.payments AS pay
   WHERE pay.student_id = p_student_id
     AND pay.school_id = p_school_id
     AND pay.amount = p_amount
     AND pay.payment_method IS NOT DISTINCT FROM p_payment_method
     AND pay.deleted_at IS NULL
     AND pay.created_at >= now() - interval '10 seconds'
   LIMIT 1;

  IF v_dup IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::numeric, NULL::text,
                        NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::numeric,
                        NULL::numeric, 'DUPLICATE_PAYMENT'::text;
    RETURN;
  END IF;

  IF COALESCE(v_student.status, 'active') <> 'active' THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::numeric, NULL::text,
                        NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::numeric,
                        NULL::numeric, ('STUDENT_STATUS_' || upper(COALESCE(v_student.status, 'unknown')))::text;
    RETURN;
  END IF;

  IF v_student.class_name IS NOT NULL THEN
    v_class_fee := public.resolve_class_fee(p_school_id, v_student.class_name, p_branch_id, v_student.s_branch_id);
  END IF;

  -- Class fee wins when configured (> 0); a student flagged fee_override keeps
  -- their own negotiated total_fee.
  v_effective_total := CASE
    WHEN v_student.fee_override AND COALESCE(v_student.total_fee, 0) > 0 THEN v_student.total_fee
    WHEN v_class_fee IS NOT NULL THEN v_class_fee
    ELSE COALESCE(v_student.total_fee, 0)
  END;
  v_effective_disc := COALESCE(v_student.discount_value, 0);

  SELECT COALESCE(SUM(pay.amount), 0) INTO v_sum_paid
    FROM public.payments AS pay
   WHERE pay.student_id = p_student_id
     AND pay.school_id = p_school_id
     AND pay.deleted_at IS NULL
     AND (v_student.fee_cycle_start IS NULL OR pay.created_at >= v_student.fee_cycle_start);

  v_remaining := GREATEST(v_effective_total - v_sum_paid - v_effective_disc, 0);

  IF v_remaining <= 0 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::numeric, NULL::text,
                        NULL::text, NULL::timestamptz, NULL::text, NULL::text, v_sum_paid,
                        0::numeric, 'PAID_IN_FULL'::text;
    RETURN;
  END IF;

  IF p_amount > v_remaining THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::numeric, NULL::text,
                        NULL::text, NULL::timestamptz, NULL::text, NULL::text, v_sum_paid,
                        v_remaining, 'PAYMENT_EXCEEDS_REMAINING'::text;
    RETURN;
  END IF;

  v_created_at := COALESCE(p_created_at, now());
  v_branch_id  := COALESCE(p_branch_id, v_student.s_branch_id);

  INSERT INTO public.payments AS ins (
    school_id, branch_id, student_id, amount, payment_method, notes, created_at,
    receipt_number, manual_receipt_number, created_by
  )
  VALUES (
    p_school_id, v_branch_id, p_student_id, p_amount, p_payment_method, p_notes, v_created_at,
    COALESCE(p_receipt_number, 'REC-' || nextval('public.receipt_number_seq')::text),
    p_manual_receipt_number, auth.uid()
  )
  RETURNING ins.id, ins.receipt_number INTO v_payment_id, v_receipt;

  RETURN QUERY SELECT v_payment_id, p_school_id, v_branch_id, p_student_id, p_amount, p_payment_method,
                      p_notes, v_created_at, v_receipt, p_manual_receipt_number,
                      v_sum_paid + p_amount,
                      GREATEST(v_effective_total - (v_sum_paid + p_amount) - v_effective_disc, 0),
                      NULL::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_payment_atomic(
  uuid, uuid, uuid, numeric, text, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_atomic(
  uuid, uuid, uuid, numeric, text, text, timestamptz, text, text
) TO service_role;

-- -----------------------------------------------------------------------------
-- Expenses overview RPCs (SECURITY INVOKER: RLS limits rows to the caller's
-- school/branches). Soft-deleted rows (deleted_at) are excluded, matching the
-- list query in lib/expenses-server.ts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_expenses_summary(
  p_school_id uuid,
  p_search text DEFAULT '',
  p_expense_type_id uuid DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  school_total_count bigint,
  school_total_amount numeric,
  school_today_amount numeric,
  filtered_total_count bigint,
  filtered_total_amount numeric
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH school_scope AS (
    SELECT e.id, e.amount, e.expense_date, e.expense_type_id, e.recipient, e.receipt_number, e.notes
      FROM public.expenses AS e
     WHERE e.school_id = p_school_id
       AND e.deleted_at IS NULL
  ),
  filtered_scope AS (
    SELECT s.*
      FROM school_scope AS s
     WHERE (p_expense_type_id IS NULL OR s.expense_type_id = p_expense_type_id)
       AND (p_from_date IS NULL OR s.expense_date >= p_from_date)
       AND (p_to_date IS NULL OR s.expense_date <= p_to_date)
       AND (
         COALESCE(NULLIF(trim(p_search), ''), '') = ''
         OR COALESCE(s.recipient, '') ILIKE '%' || trim(p_search) || '%'
         OR COALESCE(s.receipt_number, '') ILIKE '%' || trim(p_search) || '%'
         OR COALESCE(s.notes, '') ILIKE '%' || trim(p_search) || '%'
       )
  )
  SELECT
    (SELECT count(*)::bigint FROM school_scope),
    (SELECT COALESCE(sum(amount), 0) FROM school_scope),
    (SELECT COALESCE(sum(amount), 0) FROM school_scope WHERE expense_date = CURRENT_DATE),
    (SELECT count(*)::bigint FROM filtered_scope),
    (SELECT COALESCE(sum(amount), 0) FROM filtered_scope);
$function$;

CREATE OR REPLACE FUNCTION public.school_expense_types_overview(
  p_school_id uuid,
  p_search text DEFAULT ''
)
RETURNS TABLE (
  id uuid,
  school_id uuid,
  name text,
  notes text,
  usage_count bigint,
  usage_total numeric
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    et.id,
    et.school_id,
    et.name,
    et.notes,
    count(e.id)::bigint AS usage_count,
    COALESCE(sum(e.amount), 0) AS usage_total
  FROM public.expense_types AS et
  LEFT JOIN public.expenses AS e
    ON e.expense_type_id = et.id
   AND e.school_id = et.school_id
   AND e.deleted_at IS NULL
  WHERE et.school_id = p_school_id
    AND et.deleted_at IS NULL
    AND (
      COALESCE(NULLIF(trim(p_search), ''), '') = ''
      OR COALESCE(et.name, '') ILIKE '%' || trim(p_search) || '%'
    )
  GROUP BY et.id, et.school_id, et.name, et.notes
  ORDER BY et.name ASC;
$function$;

REVOKE ALL ON FUNCTION public.school_expenses_summary(uuid, text, uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.school_expense_types_overview(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_expenses_summary(uuid, text, uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.school_expense_types_overview(uuid, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- apply_student_promotions: atomic class promotion. All moves in ONE statement
-- (all or nothing); a row only moves if it is still in the class the plan was
-- built from, so a repeated/concurrent call is a no-op for already-promoted
-- students. SECURITY INVOKER: the students RLS policies still apply.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_student_promotions(
  p_school_id uuid,
  p_moves jsonb
)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  WITH moves AS (
    SELECT (m ->> 'id')::uuid AS id, m ->> 'from' AS from_class, m ->> 'to' AS to_class
      FROM jsonb_array_elements(COALESCE(p_moves, '[]'::jsonb)) AS m
  ),
  updated AS (
    UPDATE public.students AS s
       SET class_name = moves.to_class
      FROM moves
     WHERE s.id = moves.id
       AND s.school_id = p_school_id
       AND s.class_name IS NOT DISTINCT FROM moves.from_class
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$function$;

REVOKE ALL ON FUNCTION public.apply_student_promotions(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_student_promotions(uuid, jsonb) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- promote_year_execute: one-transaction year-end (promote, graduate, reset fees).
-- The fee reset stamps students.fee_cycle_start so last year's payments are not
-- counted again by recompute_student_payment_totals().
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.promote_year_execute(uuid, jsonb, uuid[], uuid[]);

CREATE FUNCTION public.promote_year_execute(
  p_school_id uuid,
  p_promotions jsonb,
  p_terminal_ids uuid[],
  p_reset_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  r jsonb;
  v_promoted int := 0;
  v_graduated int := 0;
  v_reset int := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF COALESCE(public.current_app_role(), '') NOT IN ('admin', 'super_admin') THEN
      RAISE EXCEPTION 'insufficient_privilege: promote_year requires admin role' USING ERRCODE = '42501';
    END IF;
    IF public.current_app_role() = 'admin' AND p_school_id IS DISTINCT FROM public.current_school_id() THEN
      RAISE EXCEPTION 'insufficient_privilege: cross-school promotion blocked' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_promotions IS NOT NULL THEN
    FOR r IN SELECT e FROM jsonb_array_elements(p_promotions) AS e LOOP
      UPDATE public.students AS s
         SET class_name = (r ->> 'to_class')
       WHERE s.id = (r ->> 'id')::uuid
         AND s.school_id = p_school_id;
      IF FOUND THEN v_promoted := v_promoted + 1; END IF;
    END LOOP;
  END IF;

  IF p_terminal_ids IS NOT NULL AND array_length(p_terminal_ids, 1) IS NOT NULL THEN
    UPDATE public.students AS s
       SET status = 'graduated'
     WHERE s.school_id = p_school_id
       AND s.id = ANY (p_terminal_ids);
    GET DIAGNOSTICS v_graduated = ROW_COUNT;
  END IF;

  IF p_reset_ids IS NOT NULL AND array_length(p_reset_ids, 1) IS NOT NULL THEN
    UPDATE public.students AS s
       SET paid_fee = 0,
           fee_cycle_start = now()
     WHERE s.school_id = p_school_id
       AND s.id = ANY (p_reset_ids);
    GET DIAGNOSTICS v_reset = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('promoted', v_promoted, 'graduated', v_graduated, 'fees_reset', v_reset);
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_year_execute(uuid, jsonb, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_year_execute(uuid, jsonb, uuid[], uuid[]) TO service_role;

-- -----------------------------------------------------------------------------
-- soft_delete_student: archive the row, then mark it deleted (never a hard
-- delete). Requires admin/super_admin of the student's school when called with
-- a user token; the service role is trusted.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.soft_delete_student(uuid, text);

CREATE FUNCTION public.soft_delete_student(
  p_student_id uuid,
  p_reason text DEFAULT 'User requested deletion'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF COALESCE(public.current_app_role(), '') NOT IN ('admin', 'super_admin') THEN
      RAISE EXCEPTION 'insufficient_privilege: soft_delete_student requires admin role' USING ERRCODE = '42501';
    END IF;
    IF public.current_app_role() = 'admin' AND NOT EXISTS (
      SELECT 1 FROM public.students AS s
       WHERE s.id = p_student_id AND s.school_id = public.current_school_id()
    ) THEN
      RAISE EXCEPTION 'insufficient_privilege: student not in caller school' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF to_regclass('public.deleted_data_archive') IS NOT NULL THEN
    INSERT INTO public.deleted_data_archive (deleted_by, reason, table_name, record_id, record_data)
    SELECT auth.uid(), p_reason, 'students', t.id, to_jsonb(t)
      FROM public.students AS t
     WHERE t.id = p_student_id;
  END IF;

  UPDATE public.students AS s
     SET deleted_at = now(),
         deleted_by = auth.uid(),
         status = 'deleted'
   WHERE s.id = p_student_id;

  IF to_regprocedure('public.log_audit_action(character varying, character varying, uuid, jsonb, jsonb, text)') IS NOT NULL THEN
    PERFORM public.log_audit_action(
      'DELETE', 'student', p_student_id, NULL,
      jsonb_build_object('deleted_reason', p_reason)
    );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.soft_delete_student(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_student(uuid, text) TO service_role;
