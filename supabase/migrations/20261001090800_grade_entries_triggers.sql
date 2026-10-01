-- =============================================================================
-- grade_entries compute trigger
-- Ported from the sister school-app project (20260520_000000_grade_entries_system,
-- 20260520_100000_grade_flexible_entry_system) and adapted to modon.
--
-- REVIEW BEFORE APPLYING. Idempotent. Only a BEFORE INSERT/UPDATE trigger is
-- added; no existing row is rewritten (rows pick up the computed values the
-- next time they are written).
--
-- the sister project's trigger summed the five legacy component scores into total_score
-- unconditionally, which would force total_score to 0 for rows written with the
-- flexible model (score + max_score + grade_type_id) that modon's grades API
-- (app/api/web/grades) uses. This version supports both models:
--   * legacy rows (any of oral/homework/monthly/midterm/final_score present):
--       total_score = sum of the components (as in the sister project)
--   * flexible rows (score present, no components):
--       total_score = score
--   * otherwise total_score is left as supplied.
--   percentage = round(score / max_score * 100, 2) for flexible rows, or
--   round(total_score / max_score * 100, 2) for legacy rows when max_score > 0,
--   else NULL. updated_at is always refreshed.
--
-- APPLY ORDER: independent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.compute_grade_entry_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_has_components boolean;
BEGIN
  v_has_components :=
    NEW.oral_score IS NOT NULL
    OR NEW.homework_score IS NOT NULL
    OR NEW.monthly_score IS NOT NULL
    OR NEW.midterm_score IS NOT NULL
    OR NEW.final_score IS NOT NULL;

  IF v_has_components THEN
    NEW.total_score := COALESCE(NEW.oral_score, 0)
      + COALESCE(NEW.homework_score, 0)
      + COALESCE(NEW.monthly_score, 0)
      + COALESCE(NEW.midterm_score, 0)
      + COALESCE(NEW.final_score, 0);
  ELSIF NEW.score IS NOT NULL THEN
    NEW.total_score := NEW.score;
  END IF;

  IF NEW.max_score IS NOT NULL AND NEW.max_score > 0 THEN
    IF NEW.score IS NOT NULL THEN
      NEW.percentage := round((NEW.score / NEW.max_score) * 100, 2);
    ELSIF v_has_components AND NEW.total_score IS NOT NULL THEN
      NEW.percentage := round((NEW.total_score / NEW.max_score) * 100, 2);
    ELSE
      NEW.percentage := NULL;
    END IF;
  ELSE
    NEW.percentage := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_grade_entry_total() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_grade_entry_total() TO service_role;

DO $$
BEGIN
  IF to_regclass('public.grade_entries') IS NULL THEN
    RAISE NOTICE 'grade_entries missing - trigger skipped';
    RETURN;
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_grade_entries_compute_total ON public.grade_entries';
  EXECUTE 'CREATE TRIGGER trg_grade_entries_compute_total
             BEFORE INSERT OR UPDATE ON public.grade_entries
             FOR EACH ROW EXECUTE FUNCTION public.compute_grade_entry_total()';
END $$;
