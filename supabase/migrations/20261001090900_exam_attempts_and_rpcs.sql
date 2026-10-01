-- =============================================================================
-- Exam attempts: grading/release columns + atomic start/submit RPCs
-- Ported from the sister school-app project 20260719063633_release_security_closure
-- (exam attempt section), 20260727162004 / 20260727162123 and
-- 20260923192147_add_exam_attempts_fks.
--
-- REVIEW BEFORE APPLYING. Idempotent. The app already calls both RPCs
-- (app/api/student/exams/[examId]/{start,submit}, app/api/mobile/student/...);
-- until this is applied those routes fail with "function does not exist".
--
-- WHAT THIS DOES
--   1. exam_attempts.graded_by / graded_at / results_released_at (additive).
--   2. Integrity: UNIQUE (attempt_id, question_id) on student_answers (needed by
--      the submit upsert; skipped if it already exists), one in-progress attempt
--      per (exam, student) (skipped with a NOTICE if duplicates exist), and
--      NOT VALID foreign keys student_id/school_id on exam_attempts.
--   3. public.start_or_resume_exam_attempt(school, exam, student): advisory-lock
--      serialised, enforces class match, start/end window, attempt limit
--      (exam_settings.max_attempts, default 1) and resumes an open attempt.
--   4. public.submit_exam_attempt_atomic(...): validates the answer set against
--      the exam's questions, enforces the time window, upserts student_answers
--      and closes the attempt in ONE transaction.
--
-- Both RPCs are SECURITY INVOKER with an empty search_path and executable by
-- service_role ONLY: the routes authenticate the student first and call with
-- the service client (RLS bypassed), exactly like the mobile/web exam routes.
-- Error messages (exam_not_found, student_not_found, exam_attempt_limit_reached,
-- ...) are the contract the routes' mapStartAttemptError / mapSubmitAttemptError
-- translate.
--
-- APPLY ORDER: independent of the finance files.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.exam_attempts') IS NULL THEN
    RAISE NOTICE 'exam_attempts missing - exam migration skipped';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.exam_attempts
             ADD COLUMN IF NOT EXISTS graded_by uuid,
             ADD COLUMN IF NOT EXISTS graded_at timestamptz,
             ADD COLUMN IF NOT EXISTS results_released_at timestamptz';
END $$;

-- UNIQUE (attempt_id, question_id) on student_answers.
DO $$
BEGIN
  IF to_regclass('public.student_answers') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_index AS i
     WHERE i.indrelid = 'public.student_answers'::regclass
       AND i.indisunique
       AND i.indnatts = 2
       AND (
         SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM pg_attribute AS a
          WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
       ) = ARRAY['attempt_id', 'question_id']
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.student_answers
       GROUP BY attempt_id, question_id HAVING count(*) > 1
    ) THEN
      RAISE NOTICE 'student_answers has duplicate (attempt_id, question_id) rows - unique index skipped; submit_exam_attempt_atomic needs it';
    ELSE
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS student_answers_attempt_question_key
                 ON public.student_answers (attempt_id, question_id)';
    END IF;
  END IF;
END $$;

-- One in-progress attempt per student per exam.
DO $$
BEGIN
  IF to_regclass('public.exam_attempts') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.exam_attempts
     WHERE status = 'in_progress'
     GROUP BY exam_id, student_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'duplicate in-progress exam attempts exist - exam_attempts_one_in_progress_per_student skipped; resolve them and re-run';
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS exam_attempts_one_in_progress_per_student
               ON public.exam_attempts (exam_id, student_id) WHERE status = ''in_progress''';
  END IF;
END $$;

-- Foreign keys (NOT VALID: new rows are checked, legacy orphans do not block).
DO $$
BEGIN
  IF to_regclass('public.exam_attempts') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.students') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.exam_attempts'::regclass AND conname = 'exam_attempts_student_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE public.exam_attempts ADD CONSTRAINT exam_attempts_student_id_fkey
               FOREIGN KEY (student_id) REFERENCES public.students (id) ON DELETE CASCADE NOT VALID';
  END IF;

  IF to_regclass('public.schools') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.exam_attempts'::regclass AND conname = 'exam_attempts_school_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE public.exam_attempts ADD CONSTRAINT exam_attempts_school_id_fkey
               FOREIGN KEY (school_id) REFERENCES public.schools (id) ON DELETE CASCADE NOT VALID';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- start_or_resume_exam_attempt
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.start_or_resume_exam_attempt(uuid, uuid, uuid);

CREATE FUNCTION public.start_or_resume_exam_attempt(
  p_school_id uuid,
  p_exam_id uuid,
  p_student_id uuid
)
RETURNS TABLE(attempt_id uuid, started_at timestamptz, resumed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_exam public.exams%ROWTYPE;
  v_student public.students%ROWTYPE;
  v_attempt_id uuid;
  v_started_at timestamptz;
  v_max_attempts integer;
  v_attempt_count integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_school_id IS NULL OR p_exam_id IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'missing_exam_attempt_scope';
  END IF;

  -- Serialise concurrent starts for the same (exam, student) pair.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_exam_id::text || ':' || p_student_id::text, 0)
  );

  SELECT * INTO v_exam
    FROM public.exams AS e
   WHERE e.id = p_exam_id
     AND e.school_id = p_school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exam_not_found';
  END IF;

  SELECT * INTO v_student
    FROM public.students AS s
   WHERE s.id = p_student_id
     AND s.school_id = p_school_id
     AND s.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_not_found';
  END IF;

  IF COALESCE(v_student.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'student_inactive';
  END IF;

  -- An exam without a class_name is open to the whole school.
  IF NULLIF(btrim(v_exam.class_name), '') IS NOT NULL
     AND NULLIF(btrim(v_student.class_name), '') IS DISTINCT FROM NULLIF(btrim(v_exam.class_name), '') THEN
    RAISE EXCEPTION 'exam_class_mismatch';
  END IF;

  IF v_exam.starts_at IS NOT NULL AND v_now < v_exam.starts_at THEN
    RAISE EXCEPTION 'exam_not_started';
  END IF;

  IF v_exam.ends_at IS NOT NULL AND v_now > v_exam.ends_at THEN
    RAISE EXCEPTION 'exam_ended';
  END IF;

  -- Resume an attempt that is already open.
  SELECT a.id, a.started_at
    INTO v_attempt_id, v_started_at
    FROM public.exam_attempts AS a
   WHERE a.exam_id = p_exam_id
     AND a.student_id = p_student_id
     AND a.school_id = p_school_id
     AND a.status = 'in_progress'
   ORDER BY a.started_at DESC NULLS LAST, a.id
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT v_attempt_id, v_started_at, true;
    RETURN;
  END IF;

  SELECT COALESCE(st.max_attempts, 1)
    INTO v_max_attempts
    FROM public.exam_settings AS st
   WHERE st.exam_id = p_exam_id;

  v_max_attempts := COALESCE(v_max_attempts, 1);

  SELECT count(*)::integer
    INTO v_attempt_count
    FROM public.exam_attempts AS a
   WHERE a.exam_id = p_exam_id
     AND a.student_id = p_student_id
     AND a.school_id = p_school_id;

  IF v_max_attempts > 0 AND v_attempt_count >= v_max_attempts THEN
    RAISE EXCEPTION 'exam_attempt_limit_reached';
  END IF;

  INSERT INTO public.exam_attempts AS inserted_attempt (
    exam_id, student_id, school_id, started_at, submitted_at, status
  )
  VALUES (
    p_exam_id, p_student_id, p_school_id, v_now, NULL, 'in_progress'
  )
  RETURNING inserted_attempt.id, inserted_attempt.started_at
  INTO v_attempt_id, v_started_at;

  RETURN QUERY SELECT v_attempt_id, v_started_at, false;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_or_resume_exam_attempt(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_or_resume_exam_attempt(uuid, uuid, uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- submit_exam_attempt_atomic
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_exam_attempt_atomic(uuid, uuid, uuid, uuid, jsonb, numeric, text);

CREATE FUNCTION public.submit_exam_attempt_atomic(
  p_school_id uuid,
  p_exam_id uuid,
  p_student_id uuid,
  p_attempt_id uuid,
  p_answers jsonb,
  p_score numeric,
  p_status text
)
RETURNS TABLE(
  attempt_id uuid,
  status text,
  score numeric,
  submitted_at timestamptz,
  time_spent_seconds integer,
  results_released_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_exam public.exams%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_duration_minutes integer;
  v_show_results boolean := false;
  v_duration_deadline timestamptz;
  v_time_spent integer;
  v_max_score numeric;
BEGIN
  IF p_school_id IS NULL OR p_exam_id IS NULL OR p_student_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'missing_exam_submission_scope';
  END IF;

  IF p_status NOT IN ('submitted', 'graded') THEN
    RAISE EXCEPTION 'invalid_exam_submission_status';
  END IF;

  IF jsonb_typeof(COALESCE(p_answers, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_answers, '[]'::jsonb)) > 500 THEN
    RAISE EXCEPTION 'invalid_exam_answers';
  END IF;

  SELECT * INTO v_attempt
    FROM public.exam_attempts AS a
   WHERE a.id = p_attempt_id
     AND a.exam_id = p_exam_id
     AND a.student_id = p_student_id
     AND a.school_id = p_school_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exam_attempt_not_found';
  END IF;

  IF v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'exam_attempt_already_submitted';
  END IF;

  SELECT * INTO v_exam
    FROM public.exams AS e
   WHERE e.id = p_exam_id
     AND e.school_id = p_school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exam_not_found';
  END IF;

  SELECT COALESCE(s.duration_minutes, 60), COALESCE(s.show_results_immediately, false)
    INTO v_duration_minutes, v_show_results
    FROM public.exam_settings AS s
   WHERE s.exam_id = p_exam_id;

  v_duration_minutes := COALESCE(v_duration_minutes, 60);
  v_show_results := COALESCE(v_show_results, false);

  IF v_attempt.started_at IS NULL THEN
    RAISE EXCEPTION 'exam_attempt_missing_start_time';
  END IF;

  v_duration_deadline := v_attempt.started_at + make_interval(mins => v_duration_minutes);

  IF (v_exam.ends_at IS NOT NULL AND v_now > v_exam.ends_at)
     OR v_now > v_duration_deadline THEN
    RAISE EXCEPTION 'exam_submission_window_closed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) AS item(value)
     WHERE jsonb_typeof(item.value) <> 'object'
        OR COALESCE(item.value ->> 'question_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'invalid_exam_answer_question_id';
  END IF;

  IF (
    SELECT count(*) FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) AS item(value)
  ) <> (
    SELECT count(DISTINCT item.value ->> 'question_id')
      FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) AS item(value)
  ) THEN
    RAISE EXCEPTION 'duplicate_exam_answer_question';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) AS item(value)
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.exam_questions AS eq
        WHERE eq.exam_id = p_exam_id
          AND eq.question_id = (item.value ->> 'question_id')::uuid
     )
  ) THEN
    RAISE EXCEPTION 'exam_answer_question_mismatch';
  END IF;

  SELECT COALESCE(sum(eq.marks), COALESCE(v_exam.total_marks, 0))
    INTO v_max_score
    FROM public.exam_questions AS eq
   WHERE eq.exam_id = p_exam_id;

  IF COALESCE(p_score, 0) < 0 OR COALESCE(p_score, 0) > COALESCE(v_max_score, 0) THEN
    RAISE EXCEPTION 'invalid_exam_score';
  END IF;

  INSERT INTO public.student_answers (
    attempt_id, question_id, student_answer, is_correct, marks_awarded, time_spent_seconds, flagged
  )
  SELECT
    p_attempt_id,
    (item.value ->> 'question_id')::uuid,
    item.value -> 'student_answer',
    CASE
      WHEN jsonb_typeof(item.value -> 'is_correct') = 'boolean'
        THEN (item.value ->> 'is_correct')::boolean
      ELSE NULL
    END,
    COALESCE((item.value ->> 'marks_awarded')::numeric, 0),
    CASE
      WHEN COALESCE(item.value ->> 'time_spent_seconds', '') ~ '^[0-9]+$'
        THEN (item.value ->> 'time_spent_seconds')::integer
      ELSE NULL
    END,
    CASE
      WHEN jsonb_typeof(item.value -> 'flagged') = 'boolean'
        THEN (item.value ->> 'flagged')::boolean
      ELSE false
    END
  FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) AS item(value)
  ON CONFLICT (attempt_id, question_id)
  DO UPDATE SET
    student_answer = EXCLUDED.student_answer,
    is_correct = EXCLUDED.is_correct,
    marks_awarded = EXCLUDED.marks_awarded,
    time_spent_seconds = EXCLUDED.time_spent_seconds,
    flagged = EXCLUDED.flagged;

  v_time_spent := GREATEST(
    0,
    floor(extract(epoch FROM (v_now - v_attempt.started_at)))::integer
  );

  UPDATE public.exam_attempts AS a
     SET status = p_status,
         score = COALESCE(p_score, 0),
         submitted_at = v_now,
         time_spent_seconds = v_time_spent,
         answers_json = COALESCE(p_answers, '[]'::jsonb),
         graded_at = CASE WHEN p_status = 'graded' THEN v_now ELSE a.graded_at END,
         results_released_at = CASE
           WHEN v_show_results THEN v_now
           ELSE a.results_released_at
         END
   WHERE a.id = p_attempt_id
  RETURNING a.id, a.status, a.score, a.submitted_at, a.time_spent_seconds, a.results_released_at
  INTO attempt_id, status, score, submitted_at, time_spent_seconds, results_released_at;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_exam_attempt_atomic(uuid, uuid, uuid, uuid, jsonb, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt_atomic(uuid, uuid, uuid, uuid, jsonb, numeric, text) TO service_role;
