-- ============================================================
-- Homework module completion — grading columns + assignment
-- lifecycle columns + RLS.
--
-- Context: `assignments` and `assignment_submissions` already exist
-- (see 20260528100000_schema_baseline.sql and
-- 20260622100000_add_assignment_submissions.sql) and are driven from the
-- mobile app only. This migration adds what the web admin/teacher/student
-- "homework" surfaces need on top of the same two tables — no new tables,
-- no parallel system.
--
-- All statements are additive and idempotent (IF NOT EXISTS / DROP+CREATE
-- POLICY) so this is safe to run against the live schema.
-- ============================================================

-- ------------------------------------------------------------
-- 1. assignments: lifecycle + grading-scale columns
-- ------------------------------------------------------------
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS max_grade INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS allow_late BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignments_status_check'
  ) THEN
    ALTER TABLE public.assignments
      ADD CONSTRAINT assignments_status_check
      CHECK (status = ANY (ARRAY['active'::text, 'draft'::text, 'archived'::text]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignments_max_grade_check'
  ) THEN
    ALTER TABLE public.assignments
      ADD CONSTRAINT assignments_max_grade_check CHECK (max_grade > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assignments_school_status
  ON public.assignments (school_id, status);

-- ------------------------------------------------------------
-- 2. assignment_submissions: grading + lateness + workflow status
-- ------------------------------------------------------------
ALTER TABLE public.assignment_submissions
  ADD COLUMN IF NOT EXISTS grade NUMERIC,
  ADD COLUMN IF NOT EXISTS feedback TEXT,
  ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS graded_by UUID,
  ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'submitted';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignment_submissions_status_check'
  ) THEN
    ALTER TABLE public.assignment_submissions
      ADD CONSTRAINT assignment_submissions_status_check
      CHECK (status = ANY (ARRAY['submitted'::text, 'graded'::text, 'returned'::text]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignment_submissions_grade_check'
  ) THEN
    ALTER TABLE public.assignment_submissions
      ADD CONSTRAINT assignment_submissions_grade_check CHECK (grade IS NULL OR grade >= 0);
  END IF;
END $$;

-- graded_by stores teachers.id of the grading teacher — the same identity
-- already used by assignments.teacher_id. No FK is declared, matching the
-- rest of this schema (teacher_id/student_id on assignments are unFK'd too).

CREATE INDEX IF NOT EXISTS idx_asub_status ON public.assignment_submissions (school_id, status);
CREATE INDEX IF NOT EXISTS idx_asub_graded_by ON public.assignment_submissions (graded_by);

-- ------------------------------------------------------------
-- 3. RLS — service-role API bypasses RLS (existing pattern for both
-- tables). These policies only matter for any direct authenticated-role
-- access and follow the same current_app_role()/current_school_id()
-- helpers used across the rest of the schema (see
-- 20260710120000_rls_functions_version_control.sql).
-- ------------------------------------------------------------
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;

-- Admin/employee: full visibility within their own school.
DROP POLICY IF EXISTS assignments_staff_select ON public.assignments;
CREATE POLICY assignments_staff_select ON public.assignments FOR SELECT TO authenticated
USING (
  current_app_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'employee'::text])
  AND (current_app_role() = 'super_admin' OR school_id = current_school_id())
);

-- Teacher: only assignments they authored.
DROP POLICY IF EXISTS assignments_teacher_select ON public.assignments;
CREATE POLICY assignments_teacher_select ON public.assignments FOR SELECT TO authenticated
USING (
  current_app_role() = 'teacher'
  AND school_id = current_school_id()
  AND EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.id = assignments.teacher_id AND t.auth_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS assignments_teacher_write ON public.assignments;
CREATE POLICY assignments_teacher_write ON public.assignments FOR ALL TO authenticated
USING (
  current_app_role() = 'teacher'
  AND school_id = current_school_id()
  AND EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.id = assignments.teacher_id AND t.auth_user_id = auth.uid()
  )
)
WITH CHECK (
  current_app_role() = 'teacher'
  AND school_id = current_school_id()
  AND EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.id = assignments.teacher_id AND t.auth_user_id = auth.uid()
  )
);

-- Student: only assignments targeting their own class/section or them directly.
DROP POLICY IF EXISTS assignments_student_select ON public.assignments;
CREATE POLICY assignments_student_select ON public.assignments FOR SELECT TO authenticated
USING (
  current_app_role() = 'student'
  AND school_id = current_school_id()
  AND status = 'active'
  AND EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.auth_user_id = auth.uid()
      AND s.school_id = assignments.school_id
      AND (
        assignments.student_id = s.id
        OR (
          assignments.student_id IS NULL
          AND assignments.class_name = s.class_name
          AND (assignments.section IS NULL OR assignments.section = s.section)
        )
      )
  )
);

-- assignment_submissions: student owns their own row.
DROP POLICY IF EXISTS assignment_submissions_student_select ON public.assignment_submissions;
CREATE POLICY assignment_submissions_student_select ON public.assignment_submissions FOR SELECT TO authenticated
USING (
  current_app_role() = 'student'
  AND school_id = current_school_id()
  AND EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = assignment_submissions.student_id AND s.auth_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS assignment_submissions_student_write ON public.assignment_submissions;
CREATE POLICY assignment_submissions_student_write ON public.assignment_submissions FOR ALL TO authenticated
USING (
  current_app_role() = 'student'
  AND school_id = current_school_id()
  AND EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = assignment_submissions.student_id AND s.auth_user_id = auth.uid()
  )
)
WITH CHECK (
  current_app_role() = 'student'
  AND school_id = current_school_id()
  AND EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = assignment_submissions.student_id AND s.auth_user_id = auth.uid()
  )
);

-- assignment_submissions: teacher can see/grade submissions for assignments they own.
DROP POLICY IF EXISTS assignment_submissions_teacher_select ON public.assignment_submissions;
CREATE POLICY assignment_submissions_teacher_select ON public.assignment_submissions FOR SELECT TO authenticated
USING (
  current_app_role() = 'teacher'
  AND school_id = current_school_id()
  AND EXISTS (
    SELECT 1 FROM public.assignments a
    JOIN public.teachers t ON t.id = a.teacher_id
    WHERE a.id = assignment_submissions.assignment_id AND t.auth_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS assignment_submissions_teacher_grade ON public.assignment_submissions;
CREATE POLICY assignment_submissions_teacher_grade ON public.assignment_submissions FOR UPDATE TO authenticated
USING (
  current_app_role() = 'teacher'
  AND school_id = current_school_id()
  AND EXISTS (
    SELECT 1 FROM public.assignments a
    JOIN public.teachers t ON t.id = a.teacher_id
    WHERE a.id = assignment_submissions.assignment_id AND t.auth_user_id = auth.uid()
  )
)
WITH CHECK (
  current_app_role() = 'teacher'
  AND school_id = current_school_id()
  AND EXISTS (
    SELECT 1 FROM public.assignments a
    JOIN public.teachers t ON t.id = a.teacher_id
    WHERE a.id = assignment_submissions.assignment_id AND t.auth_user_id = auth.uid()
  )
);

-- Admin/employee: full visibility of submissions within their own school.
DROP POLICY IF EXISTS assignment_submissions_staff_select ON public.assignment_submissions;
CREATE POLICY assignment_submissions_staff_select ON public.assignment_submissions FOR SELECT TO authenticated
USING (
  current_app_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'employee'::text])
  AND (current_app_role() = 'super_admin' OR school_id = current_school_id())
);
