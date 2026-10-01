-- =============================================================================
-- Finance schema + student payment totals
-- Ported from the sister school-app project (20260428/20260429/20260430 remaining-fee clamp,
-- 20260728090100 fee_override, 20260728090200 clamp remaining_fee,
-- 20260728090300 unify class fee resolution, 20260924213550 student_fee_cycle,
-- 20260924211338/221244 definer lock-down) and adapted to modon.
--
-- REVIEW BEFORE APPLYING. Idempotent; guarded for objects that may or may not
-- exist on the live database. One statement DOES rewrite tables:
--   * widening payments/installments/expenses/... money columns integer ->
--     numeric(14,2) and re-creating students.remaining_fee (generated) take an
--     ACCESS EXCLUSIVE lock and rewrite the table. Run in a quiet window with
--     `SET lock_timeout = '5s';` first. Both steps are skipped automatically if
--     the live column is already numeric / already clamped.
--
-- FEE PRECEDENCE (modon-specific, differs from the sister project - see FINANCE_RULES.md)
--   modon keeps "class_fees first": the class fee (resolve_class_fee) wins when
--   it is > 0, otherwise the student's own total_fee. The only addition is the
--   students.fee_override flag: when TRUE the student's own negotiated
--   total_fee is authoritative and is never overwritten by the class fee.
--   With fee_override = FALSE (the default for every existing student) behaviour
--   is exactly what modon had before.
--
-- WHAT THIS DOES
--   1. payments.audited_at (used by the payments audit toggle; was missing).
--   2. Widen integer money columns to numeric(14,2) (skips already-wide ones).
--   3. students.fee_override boolean + students.fee_cycle_start timestamptz.
--      fee_cycle_start lets the year-end fee reset stop last year's payments
--      from coming back: only payments at/after it count toward paid_fee.
--      NULL (default) = count every payment = previous behaviour.
--   4. students.remaining_fee clamped at 0 (GREATEST(total - paid - discount, 0)).
--   5. public.resolve_class_fee(): one class_fees resolution for every caller
--      (requested branch > student's branch > school-wide row).
--   6. public.recompute_student_payment_totals(): final version using 3 + 5.
--   7. public.sync_student_payment_totals_from_payments() + trigger on payments.
--   8. public.mark_overdue_installments().
--
-- APPLY ORDER: after 20261001090000 (branch columns). Before 20261001090700.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. payments.audited_at
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.payments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS audited_at timestamptz';
    EXECUTE 'COMMENT ON COLUMN public.payments.audited_at IS ''When a finance user marked this payment as audited; NULL = not audited.''';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Widen integer money columns (fractional amounts must not be rounded away)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_type text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('payments',             'amount',             'numeric(14,2)'),
      ('installments',         'amount',             'numeric(14,2)'),
      ('expenses',             'amount',             'numeric(14,2)'),
      ('deductions',           'amount',             'numeric(14,2)'),
      ('incomes',              'amount',             'numeric(15,2)'),
      ('salary_advances',      'amount',             'numeric(15,2)'),
      ('daily_lectures',       'price',              'numeric(14,2)'),
      ('lecture_prices',       'price_per_lecture',  'numeric(14,2)'),
      ('teachers',             'base_salary',        'numeric(14,2)'),
      ('discounts',            'discount_value',     'numeric(14,2)'),
      ('salary_archives',      'total_amount',       'numeric(14,2)')
    ) AS v(tbl, col, target)
  LOOP
    SELECT c.data_type INTO v_type
      FROM information_schema.columns AS c
     WHERE c.table_schema = 'public' AND c.table_name = r.tbl AND c.column_name = r.col;

    IF v_type IS NULL THEN
      CONTINUE;  -- table or column not present on this database
    END IF;

    IF v_type IN ('integer', 'smallint', 'bigint') THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE %s', r.tbl, r.col, r.target);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'finance: could not widen %.% (%): left as % - widen it manually (dependent view/rule?)',
          r.tbl, r.col, SQLERRM, v_type;
      END;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. students.fee_override / fee_cycle_start
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.students') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.students ADD COLUMN IF NOT EXISTS fee_override boolean NOT NULL DEFAULT false';
  EXECUTE 'ALTER TABLE public.students ADD COLUMN IF NOT EXISTS fee_cycle_start timestamptz';
  EXECUTE $c$COMMENT ON COLUMN public.students.fee_override IS
    'When true, students.total_fee is a negotiated per-student amount and is never overwritten by class_fees (recompute_student_payment_totals / create_payment_atomic).'$c$;
  EXECUTE $c$COMMENT ON COLUMN public.students.fee_cycle_start IS
    'Start of the current fee cycle (stamped by the year-end fee reset). Payments created before it do not count toward paid_fee. NULL = all payments count.'$c$;
END $$;

-- -----------------------------------------------------------------------------
-- 4. students.remaining_fee clamped at zero
--    A generated expression cannot be altered in place: drop + re-add the column
--    and re-create any view that selects it (definition and options preserved).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_expr text;
  v_attnum smallint;
  v record;
  r record;
  v_views jsonb := '[]'::jsonb;
  v_opts text;
BEGIN
  IF to_regclass('public.students') IS NULL THEN
    RETURN;
  END IF;

  SELECT c.generation_expression INTO v_expr
    FROM information_schema.columns AS c
   WHERE c.table_schema = 'public' AND c.table_name = 'students' AND c.column_name = 'remaining_fee';

  IF v_expr IS NULL THEN
    RAISE NOTICE 'students.remaining_fee not found or not generated - clamp skipped';
    RETURN;
  END IF;
  IF v_expr ILIKE '%greatest%' THEN
    RAISE NOTICE 'students.remaining_fee already clamped - skipped';
    RETURN;
  END IF;

  SELECT a.attnum INTO v_attnum
    FROM pg_attribute AS a
   WHERE a.attrelid = 'public.students'::regclass AND a.attname = 'remaining_fee' AND NOT a.attisdropped;

  -- Everything below runs in a sub-transaction: if any step fails (for example
  -- a dependent object that is not a plain view) the whole swap is rolled back
  -- and the old column stays in place.
  BEGIN
    FOR v IN
      SELECT DISTINCT c.oid AS view_oid, n.nspname AS view_schema, c.relname AS view_name,
             c.relkind, c.reloptions, pg_get_viewdef(c.oid, true) AS view_def
        FROM pg_depend AS d
        JOIN pg_rewrite AS rw ON rw.oid = d.objid
        JOIN pg_class AS c ON c.oid = rw.ev_class
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE d.classid = 'pg_rewrite'::regclass
         AND d.refobjid = 'public.students'::regclass
         AND d.refobjsubid = v_attnum
         AND c.oid <> 'public.students'::regclass
    LOOP
      IF v.relkind <> 'v' THEN
        RAISE EXCEPTION 'dependent object %.% is not a plain view', v.view_schema, v.view_name;
      END IF;
      v_views := v_views || jsonb_build_object(
        'schema', v.view_schema,
        'name', v.view_name,
        'def', v.view_def,
        'opts', COALESCE(array_to_string(v.reloptions, ','), ''),
        'grants', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'grantee', CASE WHEN x.grantee = 0 THEN 'public' ELSE pg_get_userbyid(x.grantee) END,
                   'priv', x.privilege_type))
            FROM pg_class AS pc, LATERAL aclexplode(pc.relacl) AS x
           WHERE pc.oid = v.view_oid AND x.grantee <> pc.relowner
        ), '[]'::jsonb)
      );
    END LOOP;

    FOR v IN SELECT e.j FROM jsonb_array_elements(v_views) AS e(j) LOOP
      EXECUTE format('DROP VIEW %I.%I', v.j ->> 'schema', v.j ->> 'name');
    END LOOP;

    EXECUTE 'ALTER TABLE public.students DROP COLUMN remaining_fee';
    EXECUTE 'ALTER TABLE public.students ADD COLUMN remaining_fee numeric(14,2)
               GENERATED ALWAYS AS (GREATEST((total_fee - paid_fee) - discount_value, 0)) STORED';

    FOR v IN SELECT e.j FROM jsonb_array_elements(v_views) AS e(j) LOOP
      v_opts := v.j ->> 'opts';
      EXECUTE format('CREATE VIEW %I.%I %s AS %s',
        v.j ->> 'schema', v.j ->> 'name',
        CASE WHEN v_opts <> '' THEN 'WITH (' || v_opts || ')' ELSE '' END,
        rtrim(v.j ->> 'def', E';\n '));
      FOR r IN SELECT g.x FROM jsonb_array_elements(v.j -> 'grants') AS g(x) LOOP
        EXECUTE format('GRANT %s ON %I.%I TO %s',
          r.x ->> 'priv', v.j ->> 'schema', v.j ->> 'name',
          CASE WHEN r.x ->> 'grantee' = 'public' THEN 'PUBLIC' ELSE quote_ident(r.x ->> 'grantee') END);
      END LOOP;
    END LOOP;

    EXECUTE $c$COMMENT ON COLUMN public.students.remaining_fee IS
      'Generated: GREATEST(total_fee - paid_fee - discount_value, 0). Clamped so one overpaid student cannot cancel real debt in sum() aggregates.'$c$;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'students.remaining_fee clamp rolled back and skipped: %', SQLERRM;
  END;
END $$;

-- -----------------------------------------------------------------------------
-- 5. resolve_class_fee: single class_fees resolution
--    requested branch (0) > student's own branch (1) > school-wide row (2).
--    Returns NULL when no class fee is configured. Only rows with a positive fee
--    are considered, matching lib/students/financials.ts (class fee <= 0 means
--    "not configured").
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_class_fee(
  p_school_id uuid,
  p_class_name text,
  p_branch_id uuid,
  p_student_branch_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT cf.total_fee
    FROM public.class_fees AS cf
   WHERE p_class_name IS NOT NULL
     AND cf.school_id = p_school_id
     AND cf.class_name = p_class_name
     AND cf.total_fee > 0
     AND (cf.branch_id = p_branch_id
          OR cf.branch_id = p_student_branch_id
          OR cf.branch_id IS NULL)
   ORDER BY
     CASE WHEN cf.branch_id = p_branch_id THEN 0
          WHEN cf.branch_id = p_student_branch_id THEN 1
          WHEN cf.branch_id IS NULL THEN 2
          ELSE 3 END
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.resolve_class_fee(uuid, text, uuid, uuid) IS
  'Single source of truth for class_fees resolution (requested branch, student branch, school-wide). NULL when no positive class fee exists.';

-- Server-side only: it takes school/class as arguments and would leak fees
-- across tenants to a signed-in user.
REVOKE ALL ON FUNCTION public.resolve_class_fee(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_class_fee(uuid, text, uuid, uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 6. recompute_student_payment_totals
--    paid_fee  = sum of the student's non-deleted payments in the current fee
--                cycle (all payments when fee_cycle_start IS NULL).
--    total_fee = resolved class fee when > 0 (modon precedence), unless the
--                student is flagged fee_override, in which case it is untouched.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_student_payment_totals(target_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_paid          numeric := 0;
  v_class_fee     numeric;
  v_school_id     uuid;
  v_class_name    text;
  v_branch_id     uuid;
  v_fee_override  boolean := false;
  v_cycle_start   timestamptz;
BEGIN
  IF target_student_id IS NULL THEN
    RETURN;
  END IF;

  SELECT s.school_id, s.class_name, s.branch_id, COALESCE(s.fee_override, false), s.fee_cycle_start
    INTO v_school_id, v_class_name, v_branch_id, v_fee_override, v_cycle_start
    FROM public.students AS s
   WHERE s.id = target_student_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
    FROM public.payments AS p
   WHERE p.student_id = target_student_id
     AND p.deleted_at IS NULL
     AND (v_cycle_start IS NULL OR p.created_at >= v_cycle_start);

  v_class_fee := public.resolve_class_fee(v_school_id, v_class_name, v_branch_id, v_branch_id);

  UPDATE public.students AS s
     SET paid_fee  = v_paid,
         total_fee = CASE
                       WHEN v_fee_override THEN s.total_fee
                       ELSE COALESCE(v_class_fee, s.total_fee)
                     END
   WHERE s.id = target_student_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_student_payment_totals(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_student_payment_totals(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 7. Trigger: keep students.paid_fee / total_fee in step with payments.
--    SECURITY DEFINER so payment writes made with a user token still recompute;
--    trigger firing does not require EXECUTE, so it is revoked from API roles.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_student_payment_totals_from_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_student_payment_totals(OLD.student_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_student_payment_totals(NEW.student_id);
  IF TG_OP = 'UPDATE' AND NEW.student_id IS DISTINCT FROM OLD.student_id THEN
    PERFORM public.recompute_student_payment_totals(OLD.student_id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_student_payment_totals_from_payments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_student_payment_totals_from_payments() TO service_role;

DO $$
BEGIN
  IF to_regclass('public.payments') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_sync_student_payment_totals_on_payments ON public.payments';
    EXECUTE 'CREATE TRIGGER trg_sync_student_payment_totals_on_payments
               AFTER INSERT OR UPDATE OR DELETE ON public.payments
               FOR EACH ROW EXECUTE FUNCTION public.sync_student_payment_totals_from_payments()';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8. mark_overdue_installments (scheduled job / service role only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_overdue_installments()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.installments
     SET is_overdue = true
   WHERE due_date < CURRENT_DATE
     AND is_paid = false
     AND is_overdue = false;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_overdue_installments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_overdue_installments() TO service_role;
