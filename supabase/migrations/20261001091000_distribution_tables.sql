-- =============================================================================
-- Distribution module tables (uniforms / books): items, records, stock, settings
-- Ported from the sister school-app project 20260910221426_create_distribution_tables with the
-- tenant-scoped RLS of its 20260924203658_close_open_rls_policies (the original
-- "Authenticated users can ... USING (true)" policies are NOT recreated).
--
-- REVIEW BEFORE APPLYING. Idempotent (CREATE TABLE IF NOT EXISTS, DROP POLICY IF
-- EXISTS). app/[locale]/distribution already reads/writes these tables from the
-- browser with the signed-in user's token, so the policies below are the live
-- security boundary:
--   * super_admin: every school.
--   * admin / employee / manager: rows of their OWN school only
--     (school_id = public.current_school_id()).
--   * everyone else (students, teachers, parents, anon): no access.
--
-- Depends on: schools, students, public.current_app_role(),
-- public.current_school_id() (all present in modon).
-- updated_at maintenance is attached by 20261001091300 (generic updated_at
-- trigger pass), so it is not duplicated here.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.distribution_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year text        NOT NULL DEFAULT '2026-2027',
  category      text        NOT NULL CHECK (category IN ('uniform', 'book')),
  grade         text,                       -- NULL: uniform items apply to every grade; books are per grade
  name          text        NOT NULL,
  size_scale    text        CHECK (size_scale IN ('age', 'letter')),  -- uniform only
  variants      text[]      DEFAULT '{}',   -- e.g. {'بنطرون','تنورة'}
  sort_order    integer     NOT NULL DEFAULT 0,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.distribution_records (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id   uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  item_id      uuid        NOT NULL REFERENCES public.distribution_items(id) ON DELETE CASCADE,
  -- 0 = not delivered, 1 = delivered, 2 = unavailable, 3 = not required
  status       smallint    NOT NULL DEFAULT 0 CHECK (status IN (0, 1, 2, 3)),
  size         text,
  variant      text,
  note         text,
  delivered_at date,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.distribution_stock (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  item_id       uuid        NOT NULL REFERENCES public.distribution_items(id) ON DELETE CASCADE,
  size          text        NOT NULL DEFAULT '',
  variant       text        NOT NULL DEFAULT '',
  quantity      integer     NOT NULL DEFAULT 0,
  academic_year text        NOT NULL DEFAULT '2026-2027',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, size, variant)
);

CREATE TABLE IF NOT EXISTS public.distribution_settings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid        NOT NULL UNIQUE REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year text        NOT NULL DEFAULT '2026-2027',
  size_scales   jsonb       NOT NULL DEFAULT '{"age":{"name":"مقاس عمري","values":["4","6","8","10","12","14","16","18"]},"letter":{"name":"مقاس حرفي","values":["XS","S","M","L","XL","2XL","3XL"]}}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dist_items_school   ON public.distribution_items (school_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_dist_items_grade    ON public.distribution_items (school_id, category, grade);
CREATE INDEX IF NOT EXISTS idx_dist_records_student ON public.distribution_records (student_id);
CREATE INDEX IF NOT EXISTS idx_dist_records_item    ON public.distribution_records (item_id);
CREATE INDEX IF NOT EXISTS idx_dist_records_school  ON public.distribution_records (school_id);
CREATE INDEX IF NOT EXISTS idx_dist_stock_item      ON public.distribution_stock (item_id);
CREATE INDEX IF NOT EXISTS idx_dist_stock_school    ON public.distribution_stock (school_id);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  cmd text;
BEGIN
  FOREACH t IN ARRAY ARRAY['distribution_items', 'distribution_records', 'distribution_stock', 'distribution_settings']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Remove the blanket policies the sister project's original migration created, should
    -- they exist from a manual run.
    FOREACH cmd IN ARRAY ARRAY['read', 'insert', 'update', 'delete']
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Authenticated users can ' || cmd || ' ' || t, t);
    END LOOP;

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);

    EXECUTE format('DROP POLICY IF EXISTS distribution_staff_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY distribution_staff_all ON public.%I FOR ALL TO authenticated '
      'USING (
         (SELECT public.current_app_role()) = ''super_admin''
         OR ((SELECT public.current_app_role()) IN (''admin'', ''employee'', ''manager'')
             AND school_id = (SELECT public.current_school_id()))
       ) '
      'WITH CHECK (
         (SELECT public.current_app_role()) = ''super_admin''
         OR ((SELECT public.current_app_role()) IN (''admin'', ''employee'', ''manager'')
             AND school_id = (SELECT public.current_school_id()))
       )',
      t
    );
  END LOOP;
END $$;

-- A record may only point at an item and a student of its own school.
CREATE OR REPLACE FUNCTION public.distribution_records_validate_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.distribution_items AS i
     WHERE i.id = NEW.item_id AND i.school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'distribution item does not belong to school %', NEW.school_id USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.students AS s
     WHERE s.id = NEW.student_id AND s.school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'student does not belong to school %', NEW.school_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.distribution_records_validate_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.distribution_records_validate_scope() TO service_role;

DROP TRIGGER IF EXISTS trg_distribution_records_validate_scope ON public.distribution_records;
CREATE TRIGGER trg_distribution_records_validate_scope
  BEFORE INSERT OR UPDATE OF school_id, item_id, student_id ON public.distribution_records
  FOR EACH ROW EXECUTE FUNCTION public.distribution_records_validate_scope();
