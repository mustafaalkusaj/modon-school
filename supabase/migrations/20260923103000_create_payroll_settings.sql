-- Payroll settings per school.
--
-- The payroll section of /dashboard/settings has always called
-- /api/web/payroll/settings, but no table ever backed it, so the UI could
-- neither load nor save. One row per school; the API upserts on school_id.

CREATE TABLE IF NOT EXISTS public.payroll_settings (
  school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  working_days_per_month integer NOT NULL DEFAULT 22
    CHECK (working_days_per_month > 0 AND working_days_per_month <= 31),
  default_lecture_price numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (default_lecture_price >= 0),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_settings ENABLE ROW LEVEL SECURITY;

-- Salary figures are admin-only; no teacher or parent role reads this table.
DROP POLICY IF EXISTS payroll_settings_admin_all ON public.payroll_settings;
CREATE POLICY payroll_settings_admin_all ON public.payroll_settings
  FOR ALL TO authenticated
  USING (
    current_app_role() IN ('admin', 'super_admin')
    AND (current_app_role() = 'super_admin' OR school_id = current_school_id())
  )
  WITH CHECK (
    current_app_role() IN ('admin', 'super_admin')
    AND (current_app_role() = 'super_admin' OR school_id = current_school_id())
  );

-- anon must never see payroll numbers.
REVOKE ALL ON public.payroll_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_settings TO authenticated;
