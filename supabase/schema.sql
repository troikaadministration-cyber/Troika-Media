-- ============================================================================
-- Troika Music Lessons — COMPLETE DATABASE SCHEMA (fresh install)
--
-- One file that creates everything the app needs on an EMPTY Supabase
-- project: types, tables, indexes, functions, triggers, row-level security,
-- grants, storage buckets + rules, realtime, and starter reference data
-- (instruments, lesson categories, locations, default rates).
--
-- It is generated from the migrations in supabase/migrations (00001–00020)
-- and verified to produce an identical database. Use it for a NEW project or
-- after deliberately wiping the database. To UPGRADE an existing database
-- that has real data, run supabase/migrations/00020_troika_app_updates.sql
-- instead (safe to re-run, keeps all data) — it reaches the same end state.
--
-- How to run: Supabase dashboard → SQL Editor → New query → paste this whole
-- file → Run. Then create the first coordinator (see the end of this file).
-- ============================================================================

-- Safety: refuse to run on a database that already has the app's tables.
DO $guard$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL OR to_regclass('public.students') IS NOT NULL THEN
    RAISE EXCEPTION 'This database already contains Troika tables. schema.sql is for an EMPTY project. To upgrade an existing database, run supabase/migrations/00020_troika_app_updates.sql instead.';
  END IF;
END
$guard$;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ── Part 1: public schema (types, tables, functions, triggers, RLS, grants) ──
--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

--
-- Name: absence_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.absence_category AS ENUM (
    'charged',
    'not_charged'
);

--
-- Name: lesson_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lesson_status AS ENUM (
    'scheduled',
    'completed',
    'cancelled'
);

--
-- Name: lesson_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lesson_type AS ENUM (
    'regular',
    'makeup',
    'special',
    'demo',
    'workshop',
    'one_time'
);

--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_type AS ENUM (
    'general',
    'payment_reminder',
    'lesson_cancelled',
    'lesson_updated',
    'attendance_marked',
    'makeup_available'
);

--
-- Name: payment_plan; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_plan AS ENUM (
    'trial',
    '1_instalment',
    '3_instalments',
    '10_instalments'
);

--
-- Name: piece_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.piece_status AS ENUM (
    'not_started',
    'in_progress',
    'completed'
);

--
-- Name: resource_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.resource_level AS ENUM (
    'beginner',
    'intermediate',
    'advanced'
);

--
-- Name: resource_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.resource_type AS ENUM (
    'piece',
    'exercise',
    'activity'
);

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'coordinator',
    'teacher',
    'student'
);

--
-- Name: _approved_login_for_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._approved_login_for_email(p_email text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.id
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE COALESCE(btrim(p_email), '') <> ''
    AND lower(btrim(p.email)) = lower(btrim(p_email))
    AND p.role = 'student' AND p.approved IS TRUE
    AND u.email_confirmed_at IS NOT NULL
  ORDER BY p.created_at, p.id
  LIMIT 1;
$$;

--
-- Name: _generate_group_sessions(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._generate_group_sessions(p_group_id uuid, p_from date, p_to date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE;
  v_end TIME;
  v_date DATE;
  v_lesson UUID;
  v_created INTEGER := 0;
  v_conflicts INTEGER := 0;
  v_conflict_dates TEXT[] := '{}';
BEGIN
  SELECT * INTO g FROM teacher_schedule_templates WHERE id = p_group_id;
  v_end := COALESCE(g.end_time, g.start_time + INTERVAL '45 minutes');
  FOR v_date IN
    SELECT d::date FROM generate_series(p_from, p_to, INTERVAL '1 day') d
    WHERE EXTRACT(DOW FROM d) = g.day_of_week ORDER BY d
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM lessons WHERE template_id = g.id AND date = v_date);
    IF EXISTS (
      SELECT 1 FROM lessons l
      WHERE l.teacher_id = g.teacher_id AND l.date = v_date AND l.status <> 'cancelled'
        AND l.start_time < v_end AND COALESCE(l.end_time, l.start_time + INTERVAL '45 minutes') > g.start_time
    ) THEN
      v_conflicts := v_conflicts + 1;
      v_conflict_dates := array_append(v_conflict_dates, v_date::text);
      CONTINUE;
    END IF;
    INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, date, start_time, end_time,
                         title, is_charged, template_id)
    VALUES (g.teacher_id, g.location_id, g.instrument_id, 'regular', v_date, g.start_time, g.end_time,
            g.title, g.counts_toward_lessons, g.id)
    RETURNING id INTO v_lesson;
    INSERT INTO lesson_students (lesson_id, student_id)
    SELECT v_lesson, s FROM unnest(COALESCE(g.student_ids, '{}')) s
    ON CONFLICT DO NOTHING;
    v_created := v_created + 1;
  END LOOP;
  RETURN jsonb_build_object('lessons_created', v_created, 'conflicts', v_conflicts,
                            'conflict_dates', to_jsonb(v_conflict_dates));
END;
$$;

--
-- Name: _lesson_when_label(date, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._lesson_when_label(p_date date, p_time time without time zone) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT to_char(p_date, 'Dy FMDD Mon') || ', ' || ltrim(to_char(p_time, 'HH12:MI AM'), '0')
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: teacher_schedule_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_schedule_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone,
    location_id uuid,
    instrument_id uuid,
    title text DEFAULT ''::text NOT NULL,
    student_ids uuid[] DEFAULT '{}'::uuid[],
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    counts_toward_lessons boolean DEFAULT true NOT NULL,
    is_group boolean DEFAULT false NOT NULL,
    max_students integer,
    CONSTRAINT teacher_schedule_templates_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT teacher_schedule_templates_max_students_check CHECK (((max_students IS NULL) OR (max_students > 0)))
);

--
-- Name: _require_group(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._require_group(p_group_id uuid, p_active boolean DEFAULT true) RETURNS public.teacher_schedule_templates
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE g teacher_schedule_templates%ROWTYPE;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can manage groups' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO g FROM teacher_schedule_templates WHERE id = p_group_id AND is_group FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF p_active AND NOT g.is_active THEN RAISE EXCEPTION 'This group has ended'; END IF;
  RETURN g;
END;
$$;

--
-- Name: _today_ist(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._today_ist() RETURNS date
    LANGUAGE sql STABLE
    AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

--
-- Name: add_group_members(uuid, uuid[], date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_group_members(p_group_id uuid, p_student_ids uuid[], p_from_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE := _require_group(p_group_id);
  v_new UUID[];
  v_joined INTEGER;
BEGIN
  v_new := ARRAY(SELECT DISTINCT s FROM unnest(COALESCE(p_student_ids, '{}')) s
                 WHERE NOT (s = ANY(COALESCE(g.student_ids, '{}'))));
  IF COALESCE(array_length(v_new, 1), 0) = 0 THEN
    RETURN jsonb_build_object('added', 0, 'sessions_joined', 0);
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_new) s WHERE NOT EXISTS (SELECT 1 FROM students WHERE id = s)) THEN
    RAISE EXCEPTION 'One of the selected students no longer exists';
  END IF;
  IF g.max_students IS NOT NULL
     AND COALESCE(array_length(g.student_ids, 1), 0) + array_length(v_new, 1) > g.max_students THEN
    RAISE EXCEPTION 'This group is full (maximum % students)', g.max_students;
  END IF;

  UPDATE teacher_schedule_templates SET student_ids = COALESCE(student_ids, '{}') || v_new, updated_at = now()
  WHERE id = g.id;

  INSERT INTO lesson_students (lesson_id, student_id)
  SELECT l.id, s FROM lessons l CROSS JOIN unnest(v_new) s
  WHERE l.template_id = g.id AND l.status = 'scheduled' AND l.date >= COALESCE(p_from_date, _today_ist())
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_joined = ROW_COUNT;
  RETURN jsonb_build_object('added', array_length(v_new, 1), 'sessions_joined', v_joined);
END;
$$;

--
-- Name: assert_calendar_feed_allowed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_calendar_feed_allowed() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role user_role;
  v_approved boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT role, approved INTO v_role, v_approved FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your account is not set up yet' USING ERRCODE = '42501';
  END IF;
  IF v_role <> 'coordinator' AND v_approved IS NOT TRUE THEN
    RAISE EXCEPTION 'Your account is awaiting approval — calendar sync is available once a coordinator approves it'
      USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END;
$$;

--
-- Name: block_non_coordinator_cancel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_non_coordinator_cancel() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND jwt_role() IS NOT NULL
     AND jwt_role() <> 'coordinator' THEN
    RAISE EXCEPTION 'Only a coordinator can cancel a lesson';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: cascade_lesson_category_rename(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cascade_lesson_category_rename() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE lesson_rates SET category = NEW.name WHERE category = OLD.name;
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    role public.user_role DEFAULT 'student'::public.user_role NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    approved boolean
);

--
-- Name: complete_profile_setup(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_profile_setup(p_role text, p_full_name text) RETURNS public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_profile profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('teacher', 'student') THEN
    RAISE EXCEPTION 'Choose Teacher or Student';
  END IF;
  IF COALESCE(trim(p_full_name), '') = '' OR length(trim(p_full_name)) > 120 THEN
    RAISE EXCEPTION 'Please enter your full name';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid FOR UPDATE;
  IF FOUND AND (v_profile.role = 'coordinator' OR COALESCE(trim(v_profile.full_name), '') <> ''
                OR v_profile.approved IS NOT NULL) THEN
    RAISE EXCEPTION 'Your account is already set up';
  END IF;

  INSERT INTO profiles (id, role, full_name, email, approved)
  VALUES (v_uid, p_role::user_role, trim(p_full_name), COALESCE(v_email, ''), NULL)
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, approved = NULL
  RETURNING * INTO v_profile;

  IF p_role = 'student' THEN
    PERFORM link_or_create_student(v_uid, COALESCE(v_email, ''), trim(p_full_name));
  END IF;

  RETURN v_profile;
END;
$$;

--
-- Name: create_break(text, date, date, uuid[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_break(p_title text, p_start_date date, p_end_date date, p_student_ids uuid[], p_dry_run boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_all BOOLEAN := COALESCE(array_length(p_student_ids, 1), 0) = 0;
  v_break_id UUID;
  v_lesson RECORD;
  v_copy UUID;
  v_cancelled INTEGER := 0;
  v_split INTEGER := 0;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can schedule breaks' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be on or after the start date';
  END IF;

  IF NOT p_dry_run THEN
    IF COALESCE(trim(p_title), '') = '' THEN RAISE EXCEPTION 'Please give the break a title'; END IF;
    INSERT INTO scheduled_breaks (created_by, title, start_date, end_date, student_ids, total_cancelled, total_rescheduled)
    VALUES (auth.uid(), trim(p_title), p_start_date, p_end_date, COALESCE(p_student_ids, '{}'), 0, 0)
    RETURNING id INTO v_break_id;
  END IF;

  FOR v_lesson IN
    SELECT l.*,
           (SELECT count(*) FROM lesson_students ls WHERE ls.lesson_id = l.id) AS n_students,
           (SELECT count(*) FROM lesson_students ls WHERE ls.lesson_id = l.id
              AND (v_all OR ls.student_id = ANY(p_student_ids))) AS n_on_break
    FROM lessons l
    WHERE l.status = 'scheduled' AND l.date BETWEEN p_start_date AND p_end_date
  LOOP
    CONTINUE WHEN v_lesson.n_on_break = 0 AND NOT v_all;

    IF v_all OR v_lesson.n_on_break = v_lesson.n_students THEN
      v_cancelled := v_cancelled + 1;
      CONTINUE WHEN p_dry_run;
      UPDATE lessons SET status = 'cancelled', pending_reschedule = true, source_break_id = v_break_id,
                         cancelled_by_role = 'coordinator', cancelled_by_user_id = auth.uid(),
                         cancel_reason = COALESCE(cancel_reason, trim(p_title))
      WHERE id = v_lesson.id;
    ELSE
      -- Some classmates aren't on break: split the break students off.
      v_cancelled := v_cancelled + 1;
      v_split := v_split + 1;
      CONTINUE WHEN p_dry_run;
      INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, status, date, start_time, end_time,
                           title, is_charged, makeup_direction, pending_reschedule, source_break_id,
                           cancelled_by_role, cancelled_by_user_id, cancel_reason)
      VALUES (v_lesson.teacher_id, v_lesson.location_id, v_lesson.instrument_id, v_lesson.lesson_type, 'cancelled',
              v_lesson.date, v_lesson.start_time, v_lesson.end_time, v_lesson.title, v_lesson.is_charged,
              v_lesson.makeup_direction, true, v_break_id, 'coordinator', auth.uid(), trim(p_title))
      RETURNING id INTO v_copy;
      UPDATE lesson_students SET lesson_id = v_copy
      WHERE lesson_id = v_lesson.id AND student_id = ANY(p_student_ids);
    END IF;
  END LOOP;

  IF NOT p_dry_run THEN
    UPDATE scheduled_breaks SET total_cancelled = v_cancelled WHERE id = v_break_id;
  END IF;
  RETURN jsonb_build_object('break_id', v_break_id, 'cancelled', v_cancelled, 'split_group_lessons', v_split);
END;
$$;

--
-- Name: create_group(text, uuid, integer, time without time zone, time without time zone, date, date, uuid[], boolean, uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_group(p_name text, p_teacher_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_start_date date, p_end_date date, p_student_ids uuid[] DEFAULT '{}'::uuid[], p_counts_toward_lessons boolean DEFAULT true, p_instrument_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid, p_max_students integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_members UUID[] := ARRAY(SELECT DISTINCT s FROM unnest(COALESCE(p_student_ids, '{}')) s);
  v_id UUID;
  v_result JSONB;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can manage groups' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Please give the group a name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_teacher_id AND role = 'teacher' AND approved IS TRUE) THEN
    RAISE EXCEPTION 'Please choose an approved teacher';
  END IF;
  IF p_day_of_week IS NULL OR p_day_of_week NOT BETWEEN 0 AND 6 OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'Choose a day and start time';
  END IF;
  IF p_end_time IS NOT NULL AND p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'End time must be after the start time';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be on or after the start date';
  END IF;
  IF p_end_date - p_start_date > 400 THEN RAISE EXCEPTION 'Schedule at most about a year at a time'; END IF;
  IF p_max_students IS NOT NULL AND p_max_students < COALESCE(array_length(v_members, 1), 0) THEN
    RAISE EXCEPTION 'More members than the group''s maximum (%)', p_max_students;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_members) s WHERE NOT EXISTS (SELECT 1 FROM students WHERE id = s)) THEN
    RAISE EXCEPTION 'One of the selected students no longer exists';
  END IF;

  INSERT INTO teacher_schedule_templates (teacher_id, day_of_week, start_time, end_time, location_id, instrument_id,
                                          title, student_ids, is_active, is_group, counts_toward_lessons, max_students)
  VALUES (p_teacher_id, p_day_of_week, p_start_time, p_end_time, p_location_id, p_instrument_id,
          trim(p_name), v_members, true, true, COALESCE(p_counts_toward_lessons, true), p_max_students)
  RETURNING id INTO v_id;

  v_result := _generate_group_sessions(v_id, p_start_date, p_end_date);
  RETURN v_result || jsonb_build_object('group_id', v_id);
END;
$$;

--
-- Name: custom_access_token_hook(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.custom_access_token_hook(event jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  claims     jsonb;
  v_role     text;
  v_approved boolean;
BEGIN
  SELECT role::text, COALESCE(approved, false)
  INTO v_role, v_approved
  FROM profiles
  WHERE id = (event->>'user_id')::uuid;

  claims := event->'claims';

  IF v_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}',     to_jsonb(v_role));
    claims := jsonb_set(claims, '{user_approved}', to_jsonb(v_approved));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

--
-- Name: dashboard_summary(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_summary(p_today date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_month_start date := date_trunc('month', p_today)::date;
  v_result jsonb;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can view the dashboard summary' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'active_students', (SELECT count(*) FROM students WHERE is_active),
    'total_students',  (SELECT count(*) FROM students),
    'collected_month', (SELECT COALESCE(sum(amount), 0) FROM payment_records
                         WHERE paid_date IS NOT NULL AND paid_date >= v_month_start AND paid_date <= p_today),
    -- Due now (today or earlier); future instalments are reported separately.
    'outstanding',     (SELECT COALESCE(sum(amount), 0) FROM payment_records WHERE paid_date IS NULL AND due_date <= p_today),
    'upcoming',        (SELECT COALESCE(sum(amount), 0) FROM payment_records WHERE paid_date IS NULL AND due_date > p_today),
    'overdue_count',   (SELECT count(*) FROM payment_records WHERE paid_date IS NULL AND due_date < p_today),
    'week_series',     (SELECT jsonb_agg(COALESCE(c.n, 0) ORDER BY d.day)
                          FROM generate_series(p_today - 6, p_today, interval '1 day') AS d(day)
                          LEFT JOIN (
                            SELECT date, count(*) AS n FROM lessons
                            WHERE date BETWEEN p_today - 6 AND p_today AND status <> 'cancelled'
                            GROUP BY date
                          ) c ON c.date = d.day::date),
    'top_dues',        (SELECT COALESCE(jsonb_agg(t ORDER BY t.due_date), '[]'::jsonb) FROM (
                          SELECT pr.amount, pr.due_date, pr.label,
                                 jsonb_build_object('id', s.id, 'full_name', s.full_name) AS student
                          FROM payment_records pr
                          LEFT JOIN students s ON s.id = pr.student_id
                          WHERE pr.paid_date IS NULL AND pr.due_date <= p_today + 7
                          ORDER BY pr.due_date
                          LIMIT 4
                        ) t)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

--
-- Name: decide_absence_request(uuid, boolean, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decide_absence_request(p_request_id uuid, p_approve boolean, p_charged boolean DEFAULT NULL::boolean, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r absence_requests%ROWTYPE;
  v_lesson lessons%ROWTYPE;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_charged BOOLEAN;
  v_n_students INTEGER;
  v_cancelled BOOLEAN := false;
  v_student_user UUID;
  v_student_name TEXT;
  v_when TEXT;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can decide absence requests' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Choose approve or decline'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN
    RAISE EXCEPTION 'Please keep the note under 300 characters';
  END IF;

  SELECT * INTO r FROM absence_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been %', r.status;
  END IF;

  SELECT * INTO v_lesson FROM lessons WHERE id = r.lesson_id FOR UPDATE;
  SELECT user_id, full_name INTO v_student_user, v_student_name FROM students WHERE id = r.student_id;
  v_when := _lesson_when_label(v_lesson.date, v_lesson.start_time);

  IF NOT p_approve THEN
    UPDATE absence_requests
    SET status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
    WHERE id = r.id;
    IF v_student_user IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (v_student_user, 'general', 'Absence request declined',
              'Your request to miss the lesson on ' || v_when || ' was declined — please attend as usual.'
              || COALESCE(' Note: ' || v_note, ''));
    END IF;
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  IF v_lesson.status = 'cancelled' THEN
    RAISE EXCEPTION 'This lesson has already been cancelled — decline the request instead';
  END IF;

  v_charged := COALESCE(p_charged, r.late_notice);

  UPDATE lesson_students
  SET attended = false,
      absence_category = (CASE WHEN v_charged THEN 'charged' ELSE 'not_charged' END)::absence_category
  WHERE lesson_id = r.lesson_id AND student_id = r.student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This student is no longer on that lesson — decline the request instead';
  END IF;

  SELECT count(*) INTO v_n_students FROM lesson_students WHERE lesson_id = r.lesson_id;

  -- 1:1 (only this student): the lesson itself is off. Group: goes ahead.
  IF v_n_students = 1 AND v_lesson.status = 'scheduled' THEN
    UPDATE lessons
    SET status = 'cancelled',
        cancel_reason = left('Absence: ' || r.reason, 300),
        cancelled_by_role = 'coordinator',
        cancelled_by_user_id = auth.uid(),
        cancelled_by_student_id = r.student_id,
        pending_reschedule = NOT v_charged
    WHERE id = r.lesson_id;
    v_cancelled := true;
  END IF;

  UPDATE absence_requests
  SET status = 'approved', charged = v_charged, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
  WHERE id = r.id;

  IF v_student_user IS NOT NULL THEN
    INSERT INTO notifications (user_id, type, title, body)
    VALUES (v_student_user,
            CASE WHEN v_cancelled THEN 'lesson_cancelled' ELSE 'lesson_updated' END::notification_type,
            'Absence approved',
            'You''re excused from the lesson on ' || v_when || '. '
            || CASE WHEN v_charged THEN 'This lesson will still be charged.'
                    WHEN v_cancelled THEN 'It won''t be charged — we''ll reschedule it.'
                    ELSE 'It won''t be charged.' END
            || COALESCE(' Note: ' || v_note, ''));
  END IF;

  INSERT INTO notifications (user_id, type, title, body)
  VALUES (v_lesson.teacher_id,
          CASE WHEN v_cancelled THEN 'lesson_cancelled' ELSE 'lesson_updated' END::notification_type,
          CASE WHEN v_cancelled THEN 'Lesson cancelled — student absent' ELSE 'Student absent' END,
          COALESCE(v_student_name, 'A student') || ' won''t attend the lesson on ' || v_when || '.'
          || CASE WHEN v_cancelled THEN ' The lesson is cancelled.' ELSE ' The class goes ahead for the others.' END);

  RETURN jsonb_build_object('status', 'approved', 'charged', v_charged, 'lesson_cancelled', v_cancelled);
END;
$$;

--
-- Name: delete_enrolment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_enrolment(p_enrolment_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_enr student_enrolments%ROWTYPE;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_unpaid INTEGER;
  v_lessons INTEGER;
  v_lesson_ids UUID[];
  v_slots UUID[];
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can delete enrolments' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_enr FROM student_enrolments WHERE id = p_enrolment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrolment not found';
  END IF;

  DELETE FROM payment_records WHERE enrolment_id = p_enrolment_id AND paid_date IS NULL;
  GET DIAGNOSTICS v_unpaid = ROW_COUNT;

  -- Unlink the student from this enrolment's future, not-yet-held lessons
  -- (every weekly slot of the class), then delete those lessons if nobody
  -- else is in them.
  WITH removed AS (
    DELETE FROM lesson_students ls
    USING lessons l
    WHERE ls.lesson_id = l.id AND ls.enrolment_id = p_enrolment_id
      AND l.date >= v_today AND l.status = 'scheduled'
    RETURNING ls.lesson_id
  )
  SELECT COALESCE(array_agg(lesson_id), '{}') INTO v_lesson_ids FROM removed;
  v_lessons := COALESCE(array_length(v_lesson_ids, 1), 0);

  DELETE FROM lessons l
  WHERE l.id = ANY(v_lesson_ids)
    AND NOT EXISTS (SELECT 1 FROM lesson_students ls WHERE ls.lesson_id = l.id);

  -- Take the student off weekly slots for this instrument.
  UPDATE teacher_schedule_templates
    SET student_ids = array_remove(student_ids, v_enr.student_id), updated_at = now()
    WHERE v_enr.student_id = ANY(student_ids)
      AND instrument_id IS NOT DISTINCT FROM v_enr.instrument_id
      AND NOT EXISTS (SELECT 1 FROM student_enrolments o
                       WHERE o.student_id = v_enr.student_id AND o.id <> v_enr.id
                         AND o.instrument_id IS NOT DISTINCT FROM v_enr.instrument_id);

  -- … and off this class's own weekly slots (incl. its 2nd/3rd weekly lesson).
  v_slots := array_remove(ARRAY[v_enr.template_id] || COALESCE(v_enr.extra_template_ids, '{}'), NULL);
  UPDATE teacher_schedule_templates t
    SET student_ids = array_remove(t.student_ids, v_enr.student_id), updated_at = now()
    WHERE t.id = ANY(v_slots)
      AND v_enr.student_id = ANY(COALESCE(t.student_ids, '{}'))
      AND NOT EXISTS (SELECT 1 FROM student_enrolments o
                       WHERE o.student_id = v_enr.student_id AND o.id <> v_enr.id
                         AND (o.template_id = t.id
                              OR t.id = ANY(COALESCE(o.extra_template_ids, '{}'))
                              OR (o.template_id IS NULL
                                  AND o.instrument_id IS NOT DISTINCT FROM v_enr.instrument_id)));

  DELETE FROM student_enrolments WHERE id = p_enrolment_id;

  RETURN jsonb_build_object('unpaid_instalments_removed', v_unpaid, 'future_lessons_removed', v_lessons);
END;
$$;

--
-- Name: end_group(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.end_group(p_group_id uuid, p_from_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE := _require_group(p_group_id, false);
  v_n INTEGER;
BEGIN
  UPDATE teacher_schedule_templates SET is_active = false, updated_at = now() WHERE id = g.id;
  DELETE FROM lessons
  WHERE template_id = g.id AND status = 'scheduled' AND date >= COALESCE(p_from_date, _today_ist());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('sessions_removed', v_n);
END;
$$;

--
-- Name: enrol_student(uuid, uuid, public.payment_plan, date, date, integer, numeric, numeric, numeric, uuid, text, text, boolean, numeric, uuid, integer, time without time zone, time without time zone, uuid, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enrol_student(p_student_id uuid, p_teacher_id uuid, p_payment_plan public.payment_plan, p_start_date date, p_end_date date, p_total_lessons integer, p_rate_per_lesson numeric, p_total_fee numeric, p_registration_fee numeric DEFAULT 0, p_lesson_rate_id uuid DEFAULT NULL::uuid, p_academic_year text DEFAULT NULL::text, p_discount_primary text DEFAULT 'none'::text, p_discount_multilesson boolean DEFAULT false, p_discount_value numeric DEFAULT 0, p_template_id uuid DEFAULT NULL::uuid, p_day_of_week integer DEFAULT NULL::integer, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_instrument_id uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text, p_location_id uuid DEFAULT NULL::uuid, p_extra_slots jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  c_days CONSTANT TEXT[] := ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  v_extras JSONB := COALESCE(p_extra_slots, '[]'::jsonb);
  v_slot_count INTEGER;
  v_max_lessons INTEGER;
  v_tpl teacher_schedule_templates%ROWTYPE;
  v_x teacher_schedule_templates%ROWTYPE;
  v_item JSONB;
  v_n INTEGER;
  v_i INTEGER;
  v_j INTEGER;
  v_raw TEXT;
  v_x_id UUID;
  v_x_day INTEGER;
  v_x_start TIME;
  v_x_end TIME;
  -- one entry per weekly occurrence (1 = the first slot)
  v_tpl_ids UUID[] := '{}';      -- NULL = new slot, created after validation
  v_joinable BOOLEAN[] := '{}';  -- existing slot picked on purpose → may join its lessons
  v_days INTEGER[] := '{}';
  v_starts TIME[] := '{}';
  v_ends TIME[] := '{}';         -- NULL end = 45 minutes (for overlap checks)
  v_new_ends TIME[] := '{}';     -- end time as entered (for new slots)
  v_enrolment_id UUID;
  v_location UUID;
  v_end_time TIME;
  v_occ RECORD;
  v_existing RECORD;
  v_lesson_id UUID;
  v_created INTEGER := 0;
  v_joined INTEGER := 0;
  v_conflicts INTEGER := 0;
  v_conflict_dates TEXT[] := '{}';
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can enrol students' USING ERRCODE = '42501';
  END IF;

  -- ── validation ──
  IF jsonb_typeof(v_extras) <> 'array' THEN
    RAISE EXCEPTION 'The extra weekly lessons could not be read — please re-select the days and times';
  END IF;
  IF jsonb_array_length(v_extras) > 2 THEN
    RAISE EXCEPTION 'A class can be at most 3 times a week';
  END IF;
  v_slot_count := 1 + jsonb_array_length(v_extras);
  v_max_lessons := 60 * v_slot_count;

  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_teacher_id AND role = 'teacher') THEN
    RAISE EXCEPTION 'Please choose a teacher';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'End date must be after the start date';
  END IF;
  IF p_total_lessons IS NULL OR p_total_lessons < 1 OR p_total_lessons > v_max_lessons THEN
    RAISE EXCEPTION 'Number of lessons must be between 1 and %', v_max_lessons;
  END IF;
  IF COALESCE(p_rate_per_lesson, -1) < 0 OR COALESCE(p_total_fee, -1) < 0
     OR COALESCE(p_registration_fee, 0) < 0 OR COALESCE(p_discount_value, 0) < 0 THEN
    RAISE EXCEPTION 'Fees and discounts cannot be negative';
  END IF;
  IF p_payment_plan <> 'trial' AND p_rate_per_lesson <= 0 THEN
    RAISE EXCEPTION 'Enter a lesson rate greater than ₹0 (or choose the Trial plan)';
  END IF;

  -- ── first weekly slot (unchanged behaviour) ──
  IF p_template_id IS NOT NULL THEN
    SELECT * INTO v_tpl FROM teacher_schedule_templates WHERE id = p_template_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That schedule slot no longer exists';
    END IF;
    IF v_tpl.teacher_id <> p_teacher_id THEN
      RAISE EXCEPTION 'That slot belongs to a different teacher — pick a slot for the selected teacher';
    END IF;
    IF NOT (p_student_id = ANY(COALESCE(v_tpl.student_ids, '{}'))) THEN
      UPDATE teacher_schedule_templates
        SET student_ids = array_append(COALESCE(student_ids, '{}'), p_student_id), updated_at = now()
        WHERE id = p_template_id;
    END IF;
  ELSE
    IF p_day_of_week IS NULL OR p_day_of_week NOT BETWEEN 0 AND 6 OR p_start_time IS NULL THEN
      RAISE EXCEPTION 'Choose a day and start time for the new slot';
    END IF;
    IF p_end_time IS NOT NULL AND p_end_time <= p_start_time THEN
      RAISE EXCEPTION 'Slot end time must be after the start time';
    END IF;
    INSERT INTO teacher_schedule_templates
      (teacher_id, day_of_week, start_time, end_time, location_id, instrument_id, title, student_ids, is_active)
    VALUES
      (p_teacher_id, p_day_of_week, p_start_time, p_end_time, p_location_id, p_instrument_id,
       COALESCE(NULLIF(trim(p_title), ''), 'Lesson'), ARRAY[p_student_id], true)
    RETURNING * INTO v_tpl;
  END IF;

  v_tpl_ids  := ARRAY[v_tpl.id];
  v_joinable := ARRAY[p_template_id IS NOT NULL];
  v_days     := ARRAY[v_tpl.day_of_week::INTEGER];
  v_starts   := ARRAY[v_tpl.start_time];
  v_ends     := ARRAY[COALESCE(v_tpl.end_time, (v_tpl.start_time + INTERVAL '45 minutes')::TIME)];
  v_new_ends := ARRAY[v_tpl.end_time];

  -- ── extra weekly occurrences: read + validate all before creating anything ──
  FOR v_i IN 0 .. jsonb_array_length(v_extras) - 1 LOOP
    v_n := v_i + 2;  -- "weekly lesson 2", "weekly lesson 3"
    v_item := v_extras -> v_i;
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Weekly lesson %: choose a slot or a day and time', v_n;
    END IF;

    IF NULLIF(v_item ->> 'template_id', '') IS NOT NULL THEN
      BEGIN
        v_x_id := (v_item ->> 'template_id')::UUID;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Weekly lesson %: that slot could not be found — please pick it again', v_n;
      END;
      SELECT * INTO v_x FROM teacher_schedule_templates WHERE id = v_x_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Weekly lesson %: that schedule slot no longer exists', v_n;
      END IF;
      IF v_x.teacher_id <> p_teacher_id THEN
        RAISE EXCEPTION 'Weekly lesson %: that slot belongs to a different teacher — all weekly lessons of a class are with the same teacher', v_n;
      END IF;
      IF NOT v_x.is_active THEN
        RAISE EXCEPTION 'Weekly lesson %: that slot is no longer active — pick another one', v_n;
      END IF;
      IF v_x.id = ANY(v_tpl_ids) THEN
        RAISE EXCEPTION 'The same weekly slot (% %) was chosen twice — pick a different day or time for weekly lesson %',
          c_days[v_x.day_of_week + 1], to_char(v_x.start_time, 'HH24:MI'), v_n;
      END IF;
      IF v_x.instrument_id IS NOT NULL AND COALESCE(v_tpl.instrument_id, p_instrument_id) IS NOT NULL
         AND v_x.instrument_id <> COALESCE(v_tpl.instrument_id, p_instrument_id) THEN
        RAISE EXCEPTION 'Weekly lesson %: that slot is for a different instrument — all weekly lessons of a class are the same instrument', v_n;
      END IF;
      v_tpl_ids  := v_tpl_ids || v_x.id;
      v_joinable := v_joinable || true;
      v_days     := v_days || v_x.day_of_week::INTEGER;
      v_starts   := v_starts || v_x.start_time;
      v_ends     := v_ends || COALESCE(v_x.end_time, (v_x.start_time + INTERVAL '45 minutes')::TIME);
      v_new_ends := v_new_ends || v_x.end_time;
    ELSE
      BEGIN
        v_x_day := (v_item ->> 'day_of_week')::INTEGER;
        v_x_start := NULLIF(v_item ->> 'start_time', '')::TIME;
        v_x_end := NULLIF(v_item ->> 'end_time', '')::TIME;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Weekly lesson %: the day or time is not valid', v_n;
      END;
      IF v_x_day IS NULL OR v_x_day NOT BETWEEN 0 AND 6 OR v_x_start IS NULL THEN
        RAISE EXCEPTION 'Weekly lesson %: choose a day and start time', v_n;
      END IF;
      IF v_x_end IS NOT NULL AND v_x_end <= v_x_start THEN
        RAISE EXCEPTION 'Weekly lesson %: end time must be after the start time', v_n;
      END IF;
      v_tpl_ids  := v_tpl_ids || NULL::UUID;
      v_joinable := v_joinable || false;
      v_days     := v_days || v_x_day;
      v_starts   := v_starts || v_x_start;
      v_ends     := v_ends || COALESCE(v_x_end, (v_x_start + INTERVAL '45 minutes')::TIME);
      v_new_ends := v_new_ends || v_x_end;
    END IF;
  END LOOP;

  -- No two weekly lessons of the class may overlap (same day, overlapping times).
  FOR v_i IN 1 .. v_slot_count LOOP
    FOR v_j IN v_i + 1 .. v_slot_count LOOP
      IF v_days[v_i] = v_days[v_j] AND v_starts[v_i] < v_ends[v_j] AND v_starts[v_j] < v_ends[v_i] THEN
        RAISE EXCEPTION 'Weekly lessons % and % overlap on % (% and %) — choose different days or times',
          v_i, v_j, c_days[v_days[v_i] + 1], to_char(v_starts[v_i], 'HH24:MI'), to_char(v_starts[v_j], 'HH24:MI');
      END IF;
    END LOOP;
  END LOOP;

  -- Create the new extra slots / put the student on the existing ones.
  FOR v_i IN 2 .. v_slot_count LOOP
    IF v_tpl_ids[v_i] IS NULL THEN
      INSERT INTO teacher_schedule_templates
        (teacher_id, day_of_week, start_time, end_time, location_id, instrument_id, title, student_ids,
         is_active, counts_toward_lessons)
      VALUES
        (p_teacher_id, v_days[v_i], v_starts[v_i], v_new_ends[v_i], COALESCE(v_tpl.location_id, p_location_id),
         COALESCE(v_tpl.instrument_id, p_instrument_id), COALESCE(NULLIF(v_tpl.title, ''), 'Lesson'),
         ARRAY[p_student_id], true, COALESCE(v_tpl.counts_toward_lessons, true))
      RETURNING id INTO v_x_id;
      v_tpl_ids[v_i] := v_x_id;
    ELSE
      UPDATE teacher_schedule_templates
        SET student_ids = array_append(COALESCE(student_ids, '{}'), p_student_id), updated_at = now()
        WHERE id = v_tpl_ids[v_i] AND NOT (p_student_id = ANY(COALESCE(student_ids, '{}')));
    END IF;
  END LOOP;

  v_location := COALESCE(v_tpl.location_id, p_location_id,
                         (SELECT location_id FROM students WHERE id = p_student_id));

  -- ── enrolment ──
  INSERT INTO student_enrolments (
    student_id, academic_year, lesson_rate_id, total_lessons, lessons_used, start_date,
    payment_plan, rate_per_lesson, total_fee, registration_fee, instrument_id,
    discount_primary, discount_multilesson, discount_value, template_id, extra_template_ids
  ) VALUES (
    p_student_id, COALESCE(NULLIF(p_academic_year, ''), to_char(p_start_date, 'YYYY')), p_lesson_rate_id,
    p_total_lessons, 0, p_start_date, p_payment_plan, p_rate_per_lesson, p_total_fee,
    COALESCE(p_registration_fee, 0), COALESCE(v_tpl.instrument_id, p_instrument_id),
    COALESCE(p_discount_primary, 'none'), COALESCE(p_discount_multilesson, false),
    CASE WHEN p_discount_primary = 'special' THEN COALESCE(p_discount_value, 0) ELSE 0 END,
    v_tpl.id,                         -- the class's first weekly slot
    v_tpl_ids[2:v_slot_count]         -- its 2nd/3rd weekly slots ('{}' at 1× per week)
  ) RETURNING id INTO v_enrolment_id;

  -- ── lessons: every weekly occurrence, in date order, until the total is reached ──
  FOR v_occ IN
    SELECT d::date AS lesson_date, o.joinable, o.ord,
           t.id AS tpl_id, t.start_time, t.end_time, t.title, t.instrument_id, t.location_id,
           t.counts_toward_lessons
    FROM unnest(v_tpl_ids, v_joinable) WITH ORDINALITY AS o(tpl_id, joinable, ord)
    JOIN teacher_schedule_templates t ON t.id = o.tpl_id
    JOIN generate_series(p_start_date, p_end_date, INTERVAL '1 day') AS d
      ON EXTRACT(DOW FROM d) = t.day_of_week
    ORDER BY d, t.start_time, o.ord
  LOOP
    EXIT WHEN v_created + v_joined >= p_total_lessons;
    v_end_time := COALESCE(v_occ.end_time, v_occ.start_time + INTERVAL '45 minutes');

    -- Same slot already has a lesson that day (e.g. a group class): join it.
    SELECT l.id, l.instrument_id INTO v_existing
    FROM lessons l
    WHERE l.teacher_id = p_teacher_id AND l.date = v_occ.lesson_date AND l.start_time = v_occ.start_time
      AND l.status <> 'cancelled'
    LIMIT 1;

    IF FOUND THEN
      -- Only join when the coordinator deliberately picked an existing slot;
      -- a NEW slot at an occupied time is a clash (never merge into someone's 1:1).
      IF v_occ.joinable AND v_existing.instrument_id IS NOT DISTINCT FROM v_occ.instrument_id THEN
        INSERT INTO lesson_students (lesson_id, student_id, enrolment_id)
        VALUES (v_existing.id, p_student_id, v_enrolment_id)
        ON CONFLICT (lesson_id, student_id) DO UPDATE SET enrolment_id = EXCLUDED.enrolment_id;
        v_joined := v_joined + 1;
      ELSE
        v_conflicts := v_conflicts + 1;
        v_conflict_dates := array_append(v_conflict_dates, v_occ.lesson_date::text);
      END IF;
      CONTINUE;
    END IF;

    -- Teacher busy with a different lesson overlapping this time: don't double-book.
    IF EXISTS (
      SELECT 1 FROM lessons l
      WHERE l.teacher_id = p_teacher_id AND l.date = v_occ.lesson_date AND l.status <> 'cancelled'
        AND l.start_time < v_end_time
        AND COALESCE(l.end_time, l.start_time + INTERVAL '45 minutes') > v_occ.start_time
    ) THEN
      v_conflicts := v_conflicts + 1;
      v_conflict_dates := array_append(v_conflict_dates, v_occ.lesson_date::text);
      CONTINUE;
    END IF;

    INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, date, start_time, end_time, title,
                         template_id, is_charged)
    VALUES (p_teacher_id, COALESCE(v_occ.location_id, v_location), v_occ.instrument_id, 'regular',
            v_occ.lesson_date, v_occ.start_time, v_occ.end_time,
            COALESCE(NULLIF(v_occ.title, ''), 'Lesson'), v_occ.tpl_id, COALESCE(v_occ.counts_toward_lessons, true))
    RETURNING id INTO v_lesson_id;

    INSERT INTO lesson_students (lesson_id, student_id, enrolment_id)
    VALUES (v_lesson_id, p_student_id, v_enrolment_id);
    v_created := v_created + 1;
  END LOOP;

  -- ── instalments (one schedule for the whole class) ──
  PERFORM generate_instalments(v_enrolment_id);

  RETURN jsonb_build_object(
    'enrolment_id', v_enrolment_id,
    'template_id', v_tpl.id,
    'extra_template_ids', to_jsonb(v_tpl_ids[2:v_slot_count]),
    'slots', v_slot_count,
    'lessons_created', v_created,
    'lessons_joined', v_joined,
    'lessons_scheduled', v_created + v_joined,
    'lessons_expected', p_total_lessons,
    'conflicts', v_conflicts,
    'conflict_dates', to_jsonb(v_conflict_dates)
  );
END;
$$;

--
-- Name: extend_group_schedule(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.extend_group_schedule(p_group_id uuid, p_end_date date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE := _require_group(p_group_id);
  v_from DATE;
BEGIN
  v_from := GREATEST(_today_ist(),
                     COALESCE((SELECT max(date) + 1 FROM lessons WHERE template_id = g.id), _today_ist()));
  IF p_end_date IS NULL OR p_end_date < v_from THEN
    RAISE EXCEPTION 'Sessions are already scheduled up to that date';
  END IF;
  IF p_end_date - v_from > 400 THEN RAISE EXCEPTION 'Schedule at most about a year at a time'; END IF;
  RETURN _generate_group_sessions(g.id, v_from, p_end_date);
END;
$$;

--
-- Name: fn_check_teacher_double_booking(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_check_teacher_double_booking() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_end TIME := COALESCE(NEW.end_time, NEW.start_time + INTERVAL '45 minutes');
  v_clash RECORD;
BEGIN
  IF NEW.teacher_id IS NULL OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.teacher_id IS NOT DISTINCT FROM OLD.teacher_id
     AND NEW.date IS NOT DISTINCT FROM OLD.date
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time
     AND OLD.status <> 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT start_time, title INTO v_clash FROM lessons
  WHERE id <> NEW.id
    AND teacher_id = NEW.teacher_id
    AND date = NEW.date
    AND status <> 'cancelled'
    AND start_time < v_end
    AND COALESCE(end_time, start_time + INTERVAL '45 minutes') > NEW.start_time
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Teacher already has a lesson at % on % (%)',
      to_char(v_clash.start_time, 'HH24:MI'), to_char(NEW.date, 'DD Mon'), v_clash.title;
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: fn_enrolments_forget_deleted_slot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_enrolments_forget_deleted_slot() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE student_enrolments
    SET extra_template_ids = array_remove(extra_template_ids, OLD.id)
    WHERE OLD.id = ANY(extra_template_ids);
  RETURN OLD;
END;
$$;

--
-- Name: fn_increment_lessons_used(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_increment_lessons_used() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  ls RECORD;
  acad_year TEXT;
BEGIN
  -- Only fire when lesson status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    -- Skip if lesson is not charged or is a teacher-learning makeup
    IF NEW.is_charged = false OR NEW.makeup_direction = 'teacher_learning' THEN
      RETURN NEW;
    END IF;

    -- Determine academic year from lesson date
    acad_year := EXTRACT(YEAR FROM NEW.date)::TEXT;

    -- For each student in this lesson who attended or has a charged absence
    FOR ls IN
      SELECT student_id FROM lesson_students
      WHERE lesson_id = NEW.id
        AND (attended = true OR absence_category = 'charged')
    LOOP
      UPDATE student_enrolments
      SET lessons_used = lessons_used + 1,
          updated_at = now()
      WHERE student_id = ls.student_id
        AND academic_year = acad_year;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: fn_lesson_students_recompute_used(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_lesson_students_recompute_used() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_student UUID := COALESCE(NEW.student_id, OLD.student_id);
  v_lesson UUID := COALESCE(NEW.lesson_id, OLD.lesson_id);
  yr TEXT;
BEGIN
  SELECT EXTRACT(YEAR FROM date)::TEXT INTO yr FROM lessons WHERE id = v_lesson;
  -- yr is NULL when the lesson itself is being deleted: recount all years.
  PERFORM fn_recompute_lessons_used(v_student, yr);
  RETURN COALESCE(NEW, OLD);
END;
$$;

--
-- Name: fn_lessons_recompute_used(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_lessons_recompute_used() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  ls RECORD;
  yr_new TEXT := EXTRACT(YEAR FROM NEW.date)::TEXT;
  yr_old TEXT := EXTRACT(YEAR FROM OLD.date)::TEXT;
BEGIN
  FOR ls IN SELECT DISTINCT student_id FROM lesson_students WHERE lesson_id = NEW.id LOOP
    PERFORM fn_recompute_lessons_used(ls.student_id, yr_new);
    IF yr_old IS DISTINCT FROM yr_new THEN
      PERFORM fn_recompute_lessons_used(ls.student_id, yr_old);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

--
-- Name: fn_profiles_link_students_on_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_profiles_link_students_on_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.role = 'student' AND NEW.approved IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.approved IS DISTINCT FROM TRUE OR OLD.role IS DISTINCT FROM 'student')
     AND COALESCE(btrim(NEW.email), '') <> ''
     AND EXISTS (SELECT 1 FROM auth.users u
                 WHERE u.id = NEW.id AND u.email_confirmed_at IS NOT NULL
                   AND lower(btrim(u.email)) = lower(btrim(NEW.email))) THEN
    UPDATE students
    SET user_id = NEW.id, updated_at = now()
    WHERE user_id IS NULL AND lower(btrim(email)) = lower(btrim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: fn_recompute_lessons_used(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_recompute_lessons_used(p_student_id uuid, p_acad_year text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE student_enrolments se
  SET lessons_used = (
        SELECT COUNT(*)
        FROM lesson_students lst
        JOIN lessons l ON l.id = lst.lesson_id
        WHERE lst.student_id = p_student_id
          -- A held lesson counts; so does a charged absence even if the
          -- lesson itself was cancelled (e.g. approved late-notice absence).
          AND (l.status = 'completed' OR (l.status = 'cancelled' AND lst.absence_category = 'charged'))
          AND COALESCE(l.is_charged, true) = true
          AND (l.makeup_direction IS DISTINCT FROM 'teacher_learning')
          AND (lst.attended = true OR lst.absence_category = 'charged')
          AND EXTRACT(YEAR FROM l.date)::TEXT = p_acad_year
      ),
      updated_at = now()
  WHERE se.student_id = p_student_id
    AND se.academic_year = p_acad_year;
END;
$$;

--
-- Name: fn_students_link_login_by_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_students_link_login_by_email() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.user_id IS NULL
     AND COALESCE(btrim(NEW.email), '') <> ''
     AND (TG_OP = 'INSERT' OR lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(COALESCE(OLD.email, '')))) THEN
    NEW.user_id := _approved_login_for_email(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: generate_instalments(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_instalments(p_enrolment_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  rec RECORD;
  num_instalments INTEGER;
  per_instalment NUMERIC(10,2);
  amount NUMERIC(10,2);
  i INTEGER;
  due DATE;
BEGIN
  SELECT * INTO rec FROM student_enrolments WHERE id = p_enrolment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrolment not found: %', p_enrolment_id;
  END IF;

  -- Idempotent per enrolment (not per student+plan).
  IF EXISTS (SELECT 1 FROM payment_records WHERE enrolment_id = p_enrolment_id) THEN
    RETURN;
  END IF;

  CASE rec.payment_plan
    WHEN 'trial' THEN RETURN;
    WHEN '1_instalment' THEN num_instalments := 1;
    WHEN '3_instalments' THEN num_instalments := 3;
    WHEN '10_instalments' THEN num_instalments := 10;
    ELSE RAISE EXCEPTION 'Unknown payment plan: %', rec.payment_plan;
  END CASE;

  IF COALESCE(rec.total_fee, 0) + COALESCE(rec.registration_fee, 0) <= 0 THEN
    RETURN; -- nothing to bill (avoid ₹0 "overdue" rows)
  END IF;

  per_instalment := ROUND(rec.total_fee / num_instalments, 2);

  FOR i IN 1..num_instalments LOOP
    CASE num_instalments
      WHEN 1 THEN due := rec.start_date;
      WHEN 3 THEN due := (rec.start_date + ((i - 1) * 4 * INTERVAL '1 month'))::DATE;
      WHEN 10 THEN due := (rec.start_date + ((i - 1) * INTERVAL '1 month'))::DATE;
    END CASE;

    -- Last instalment absorbs rounding so the instalments add up to total_fee exactly.
    IF i = num_instalments THEN
      amount := rec.total_fee - per_instalment * (num_instalments - 1);
    ELSE
      amount := per_instalment;
    END IF;
    IF i = 1 THEN
      amount := amount + COALESCE(rec.registration_fee, 0);
    END IF;

    INSERT INTO payment_records (student_id, plan, amount, instalment_number, due_date, enrolment_id)
    VALUES (rec.student_id, rec.payment_plan, amount, i, due, p_enrolment_id);
  END LOOP;
END;
$$;

--
-- Name: get_calendar_token(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_calendar_token() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := public.assert_calendar_feed_allowed();
  v_token text;
BEGIN
  SELECT token INTO v_token FROM calendar_tokens WHERE user_id = v_uid;
  IF v_token IS NOT NULL THEN
    RETURN v_token;
  END IF;

  INSERT INTO calendar_tokens (user_id, token)
  VALUES (v_uid, public.new_calendar_token())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT token INTO v_token FROM calendar_tokens WHERE user_id = v_uid;
  RETURN v_token;
END;
$$;

--
-- Name: get_student_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_student_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT s.id
  FROM students s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.user_id = auth.uid() AND p.role = 'student' AND p.approved IS TRUE
  ORDER BY s.created_at, s.id
  LIMIT 1;
$$;

--
-- Name: get_student_lesson_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_student_lesson_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT DISTINCT ls.lesson_id
  FROM lesson_students ls
  WHERE ls.student_id IN (SELECT my_student_ids());
$$;

--
-- Name: get_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_role() RETURNS public.user_role
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'user_role')::user_role,
    (SELECT role FROM profiles WHERE id = auth.uid())
  );
$$;

--
-- Name: guard_lesson_students_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_lesson_students_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND jwt_role() IS DISTINCT FROM 'coordinator'
     AND (NEW.student_id IS DISTINCT FROM OLD.student_id
          OR NEW.lesson_id IS DISTINCT FROM OLD.lesson_id
          OR NEW.enrolment_id IS DISTINCT FROM OLD.enrolment_id) THEN
    RAISE EXCEPTION 'Only a coordinator can move students between lessons' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: guard_profile_privileged_columns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_profile_privileged_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Server-side code (SECURITY DEFINER functions, service role, SQL editor) is trusted.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF jwt_role() = 'coordinator' THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.approved IS DISTINCT FROM OLD.approved
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Only a coordinator can change account role or approval' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO profiles (id, role, full_name, email)
  VALUES (
    NEW.id,
    'student',
    '',  -- Empty full_name forces RoleSetup
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

--
-- Name: is_approved_teacher(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_approved_teacher() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN auth.jwt() ->> 'user_role' IS NOT NULL THEN
      (auth.jwt() ->> 'user_role') = 'teacher'
      AND (auth.jwt() ->> 'user_approved')::boolean = true
    ELSE
      EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND role = 'teacher' AND approved = true
      )
  END;
$$;

--
-- Name: jwt_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jwt_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    auth.jwt() ->> 'user_role',
    (SELECT role::text FROM profiles WHERE id = auth.uid())
  );
$$;

--
-- Name: link_or_create_student(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_or_create_student(p_user_id uuid, p_email text, p_full_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_student_id uuid;
BEGIN
  -- user_id is no longer unique: serialise per login so a double submit
  -- can't create two records.
  PERFORM pg_advisory_xact_lock(hashtextextended('link_or_create_student:' || p_user_id::text, 0));

  SELECT id INTO v_student_id FROM students WHERE user_id = p_user_id
  ORDER BY created_at, id LIMIT 1;
  IF v_student_id IS NOT NULL THEN
    RETURN v_student_id;
  END IF;

  IF COALESCE(p_email, '') <> '' AND EXISTS (
       SELECT 1 FROM auth.users u
       WHERE u.id = p_user_id
         AND lower(u.email) = lower(p_email)
         AND u.email_confirmed_at IS NOT NULL) THEN
    WITH matched AS (
      SELECT id FROM students
      WHERE lower(btrim(email)) = lower(btrim(p_email)) AND user_id IS NULL
      FOR UPDATE
    ), linked AS (
      UPDATE students s
      SET user_id = p_user_id,
          full_name = COALESCE(NULLIF(trim(s.full_name), ''), p_full_name),
          updated_at = now()
      FROM matched
      WHERE s.id = matched.id
      RETURNING s.id, s.created_at
    )
    SELECT id INTO v_student_id FROM linked ORDER BY created_at, id LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;
  END IF;

  INSERT INTO students (full_name, email, user_id, is_active, payment_plan)
  VALUES (p_full_name, COALESCE(p_email, ''), p_user_id, true, 'trial')
  RETURNING id INTO v_student_id;
  RETURN v_student_id;
END;
$$;

--
-- Name: log_payment_marked_paid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_payment_marked_paid() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO payment_events (payment_id, event, amount, paid_date, actor)
  VALUES (NEW.id, 'marked_paid', NEW.amount, NEW.paid_date, auth.uid());
  RETURN NULL;
END;
$$;

--
-- Name: my_student_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_student_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT s.id
  FROM students s
  WHERE s.user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles p
                WHERE p.id = auth.uid() AND p.role = 'student' AND p.approved IS TRUE);
$$;

--
-- Name: new_calendar_token(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.new_calendar_token() RETURNS text
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  SELECT translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
$$;

--
-- Name: next_invoice_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_invoice_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  y TEXT := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY');
  n INTEGER;
BEGIN
  INSERT INTO invoice_counters AS c (year, last_number)
  VALUES (
    y,
    COALESCE((SELECT MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER))
              FROM invoices WHERE invoice_number LIKE 'INV-' || y || '-%'), 0) + 1
  )
  ON CONFLICT (year) DO UPDATE SET last_number = c.last_number + 1
  RETURNING last_number INTO n;
  RETURN 'INV-' || y || '-' || LPAD(n::TEXT, 4, '0');
END;
$$;

--
-- Name: reassign_lessons(uuid[], uuid, time without time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reassign_lessons(p_lesson_ids uuid[], p_new_teacher_id uuid, p_new_start_time time without time zone DEFAULT NULL::time without time zone, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_sub RECORD;
  v_l RECORD;
  v_clash RECORD;
  v_start TIME;
  v_end TIME;
  v_moved INTEGER := 0;
  v_skipped JSONB := '[]'::jsonb;
  v_info JSONB := '[]'::jsonb;   -- one object per moved lesson, for notifications
  v_id UUID;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can reassign lessons' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(array_length(p_lesson_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Choose at least one lesson to reassign';
  END IF;

  SELECT id, full_name INTO v_sub FROM profiles
  WHERE id = p_new_teacher_id AND role = 'teacher' AND approved IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an approved teacher to take these lessons';
  END IF;

  -- Serialise reassignments onto the same substitute so two coordinators
  -- can't both pass the clash check for the same slot.
  PERFORM pg_advisory_xact_lock(hashtext('reassign_lessons:' || p_new_teacher_id::text));

  -- Ids that don't exist.
  FOR v_id IN
    SELECT DISTINCT x FROM unnest(p_lesson_ids) AS x
    WHERE x IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lessons WHERE id = x)
  LOOP
    v_skipped := v_skipped || jsonb_build_object('lesson_id', v_id, 'reason', 'Lesson not found');
  END LOOP;

  FOR v_l IN
    SELECT l.*, p.full_name AS teacher_name
    FROM lessons l LEFT JOIN profiles p ON p.id = l.teacher_id
    WHERE l.id = ANY(p_lesson_ids)
    ORDER BY l.date, l.start_time
    FOR UPDATE OF l
  LOOP
    IF v_l.status <> 'scheduled' THEN
      v_skipped := v_skipped || jsonb_build_object('lesson_id', v_l.id,
        'reason', format('Lesson is %s — only scheduled lessons can be reassigned', v_l.status));
      CONTINUE;
    END IF;
    IF v_l.teacher_id = p_new_teacher_id THEN
      v_skipped := v_skipped || jsonb_build_object('lesson_id', v_l.id,
        'reason', format('Already taught by %s', v_sub.full_name));
      CONTINUE;
    END IF;

    v_start := COALESCE(p_new_start_time, v_l.start_time);
    -- Keep the lesson's length when the time changes.
    v_end := CASE WHEN v_l.end_time IS NULL THEN NULL
                  ELSE v_start + (v_l.end_time - v_l.start_time) END;
    IF v_end IS NOT NULL AND v_end <= v_start THEN
      v_skipped := v_skipped || jsonb_build_object('lesson_id', v_l.id,
        'reason', 'The new time would run past midnight');
      CONTINUE;
    END IF;

    -- Same rule as fn_check_teacher_double_booking (end = end_time or start + 45 min).
    SELECT start_time, title INTO v_clash FROM lessons
    WHERE id <> v_l.id
      AND teacher_id = p_new_teacher_id
      AND date = v_l.date
      AND status <> 'cancelled'
      AND start_time < COALESCE(v_end, v_start + INTERVAL '45 minutes')
      AND COALESCE(end_time, start_time + INTERVAL '45 minutes') > v_start
    ORDER BY start_time
    LIMIT 1;
    IF FOUND THEN
      v_skipped := v_skipped || jsonb_build_object('lesson_id', v_l.id,
        'reason', format('%s already has a lesson at %s (%s)', v_sub.full_name,
                         to_char(v_clash.start_time, 'HH24:MI'), COALESCE(NULLIF(v_clash.title, ''), 'Lesson')));
      CONTINUE;
    END IF;

    BEGIN
      UPDATE lessons SET
        teacher_id = p_new_teacher_id,
        start_time = v_start,
        end_time = v_end,
        -- Back to the original teacher → no longer a substitution.
        substitute_for_teacher_id = CASE WHEN substitute_for_teacher_id = p_new_teacher_id THEN NULL
                                         ELSE COALESCE(substitute_for_teacher_id, v_l.teacher_id) END,
        reassign_reason = CASE WHEN substitute_for_teacher_id = p_new_teacher_id THEN NULL
                               ELSE COALESCE(v_reason, reassign_reason) END
      WHERE id = v_l.id;
    EXCEPTION WHEN raise_exception OR check_violation THEN
      v_skipped := v_skipped || jsonb_build_object('lesson_id', v_l.id, 'reason', SQLERRM);
      CONTINUE;
    END;

    v_moved := v_moved + 1;
    v_info := v_info || jsonb_build_object(
      'id', v_l.id, 'date', v_l.date, 'old_start', v_l.start_time, 'new_start', v_start,
      'title', COALESCE(NULLIF(v_l.title, ''), 'Lesson'),
      'old_teacher_id', v_l.teacher_id, 'old_teacher_name', COALESCE(v_l.teacher_name, 'another teacher'),
      'is_return', v_l.substitute_for_teacher_id IS NOT DISTINCT FROM p_new_teacher_id);
  END LOOP;

  IF v_moved > 0 THEN
    -- The substitute: one notification per day covered (or "back with you"
    -- when lessons return to their original teacher).
    INSERT INTO notifications (user_id, type, title, body)
    SELECT p_new_teacher_id, 'lesson_updated',
           CASE WHEN bool_and(m.is_return) THEN
                  CASE WHEN count(*) = 1 THEN 'A lesson is back with you'
                       ELSE format('%s lessons are back with you', count(*)) END
                WHEN count(*) = 1 THEN 'You''re covering a lesson'
                ELSE format('You''re covering %s lessons', count(*)) END,
           format('%s %s %s: %s.%s',
                  to_char(m.date, 'Dy DD Mon'),
                  CASE WHEN bool_and(m.is_return) THEN 'from' ELSE 'for' END,
                  string_agg(DISTINCT m.old_teacher_name, ', '),
                  string_agg(to_char(m.new_start, 'HH24:MI') || ' ' || m.title, ', ' ORDER BY m.new_start),
                  COALESCE(' Reason: ' || v_reason, ''))
    FROM jsonb_to_recordset(v_info) AS m(id UUID, date DATE, new_start TIME, title TEXT, old_teacher_name TEXT, is_return BOOLEAN)
    GROUP BY m.date;

    -- The teacher(s) the lessons were taken from.
    INSERT INTO notifications (user_id, type, title, body)
    SELECT m.old_teacher_id, 'lesson_updated',
           CASE WHEN count(*) = 1 THEN 'Your lesson has been reassigned'
                ELSE format('%s of your lessons have been reassigned', count(*)) END,
           format('%s: %s will be taught by %s.',
                  to_char(m.date, 'Dy DD Mon'),
                  string_agg(to_char(m.old_start, 'HH24:MI') || ' ' || m.title, ', ' ORDER BY m.old_start),
                  v_sub.full_name)
    FROM jsonb_to_recordset(v_info) AS m(id UUID, date DATE, old_start TIME, title TEXT, old_teacher_id UUID)
    WHERE m.old_teacher_id IS NOT NULL
    GROUP BY m.old_teacher_id, m.date;

    -- Every student (with a login) in the moved lessons.
    INSERT INTO notifications (user_id, type, title, body)
    SELECT DISTINCT s.user_id, 'lesson_updated'::notification_type, 'Lesson teacher changed',
           format('Your lesson (%s) on %s at %s will be taught by %s%s.',
                  m.title, to_char(m.date, 'Dy DD Mon'), to_char(m.new_start, 'HH24:MI'), v_sub.full_name,
                  CASE WHEN m.new_start <> m.old_start
                       THEN format(' (moved from %s)', to_char(m.old_start, 'HH24:MI')) ELSE '' END)
    FROM jsonb_to_recordset(v_info) AS m(id UUID, date DATE, old_start TIME, new_start TIME, title TEXT)
    JOIN lesson_students ls ON ls.lesson_id = m.id
    JOIN students s ON s.id = ls.student_id
    WHERE s.user_id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object('moved', v_moved, 'skipped', v_skipped);
END;
$$;

--
-- Name: remove_group_member(uuid, uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_group_member(p_group_id uuid, p_student_id uuid, p_from_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE := _require_group(p_group_id, false);
  v_left INTEGER;
BEGIN
  UPDATE teacher_schedule_templates SET student_ids = array_remove(student_ids, p_student_id), updated_at = now()
  WHERE id = g.id;
  -- Leave not-yet-held sessions; past attendance stays on record.
  DELETE FROM lesson_students ls USING lessons l
  WHERE ls.lesson_id = l.id AND ls.student_id = p_student_id AND l.template_id = g.id
    AND l.status = 'scheduled' AND l.date >= COALESCE(p_from_date, _today_ist());
  GET DIAGNOSTICS v_left = ROW_COUNT;
  RETURN jsonb_build_object('sessions_left', v_left);
END;
$$;

--
-- Name: renewal_candidates(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.renewal_candidates(p_from_year text, p_to_year text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can renew enrolments' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_from_year), '') = '' OR COALESCE(trim(p_to_year), '') = '' THEN
    RAISE EXCEPTION 'Choose the year to renew from and to';
  END IF;
  IF p_to_year <= p_from_year THEN
    RAISE EXCEPTION 'The new year must be after the year you renew from';
  END IF;

  WITH cls AS (
    SELECT se.*,
           -- teacher: the slot's, else whoever taught most of this enrolment's lessons
           COALESCE(t.teacher_id, (
             SELECT l.teacher_id FROM lesson_students ls JOIN lessons l ON l.id = ls.lesson_id
             WHERE ls.enrolment_id = se.id
             GROUP BY l.teacher_id ORDER BY count(*) DESC, l.teacher_id LIMIT 1)) AS cls_teacher_id,
           t.id AS t_id, t.day_of_week, t.start_time, t.end_time, t.is_active AS t_active,
           t.is_group, t.title AS t_title, t.instrument_id AS t_instrument_id, t.teacher_id AS t_teacher_id,
           (se.student_id = ANY(COALESCE(t.student_ids, '{}'))) AS t_on_slot,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', x.id, 'teacher_id', x.teacher_id, 'day_of_week', x.day_of_week,
                      'start_time', x.start_time, 'end_time', x.end_time, 'is_active', x.is_active,
                      'is_group', x.is_group, 'title', x.title, 'instrument_id', x.instrument_id,
                      'student_on_slot', se.student_id = ANY(COALESCE(x.student_ids, '{}'))) ORDER BY u.ord)
             FROM unnest(COALESCE(se.extra_template_ids, '{}')) WITH ORDINALITY AS u(tid, ord)
             JOIN teacher_schedule_templates x ON x.id = u.tid), '[]'::jsonb) AS x_slots
    FROM student_enrolments se
    JOIN students s ON s.id = se.student_id AND s.is_active
    LEFT JOIN teacher_schedule_templates t ON t.id = se.template_id
    WHERE se.academic_year = p_from_year
  ),
  per_student AS (
    SELECT c.student_id,
           jsonb_agg(jsonb_build_object(
             'enrolment_id', c.id,
             'instrument_id', c.instrument_id,
             'instrument_name', i.name,
             'template_id', c.template_id,
             'teacher_id', c.cls_teacher_id,
             'teacher_name', p.full_name,
             'slot', CASE WHEN c.t_id IS NULL THEN NULL ELSE jsonb_build_object(
                        'id', c.t_id, 'teacher_id', c.t_teacher_id, 'day_of_week', c.day_of_week,
                        'start_time', c.start_time, 'end_time', c.end_time, 'is_active', c.t_active,
                        'is_group', c.is_group, 'title', c.t_title, 'instrument_id', c.t_instrument_id,
                        'student_on_slot', c.t_on_slot) END,
             'extra_slots', c.x_slots,
             'times_per_week', 1 + jsonb_array_length(c.x_slots),
             'rate_per_lesson', c.rate_per_lesson,
             'payment_plan', c.payment_plan,
             'lesson_rate_id', c.lesson_rate_id,
             'discount_primary', c.discount_primary,
             'discount_multilesson', c.discount_multilesson,
             'discount_value', c.discount_value,
             'total_lessons', c.total_lessons,
             'total_fee', c.total_fee,
             'start_date', c.start_date
           ) ORDER BY i.name NULLS LAST, c.created_at, c.id) AS classes
    FROM cls c
    LEFT JOIN instruments i ON i.id = c.instrument_id
    LEFT JOIN profiles p ON p.id = c.cls_teacher_id
    GROUP BY c.student_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'student_id', s.id,
           'full_name', s.full_name,
           'location_id', s.location_id,
           'classes', ps.classes,
           'renewed', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'enrolment_id', n.id, 'instrument_id', n.instrument_id, 'instrument_name', ni.name,
                      'template_id', n.template_id, 'extra_template_ids', to_jsonb(COALESCE(n.extra_template_ids, '{}')),
                      'rate_per_lesson', n.rate_per_lesson,
                      'payment_plan', n.payment_plan, 'total_fee', n.total_fee) ORDER BY n.created_at, n.id)
             FROM student_enrolments n LEFT JOIN instruments ni ON ni.id = n.instrument_id
             WHERE n.student_id = s.id AND n.academic_year = p_to_year), '[]'::jsonb)
         ) ORDER BY s.full_name, s.id), '[]'::jsonb)
  INTO v_result
  FROM per_student ps
  JOIN students s ON s.id = ps.student_id;

  RETURN v_result;
END;
$$;

--
-- Name: reports_summary(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reports_summary(p_today date) RETURNS TABLE(student_id uuid, full_name text, collected numeric, outstanding numeric, overdue numeric, lessons_used bigint, lessons_total bigint, attended bigint, absent bigint, charged_absent bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can view reports' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH pay AS (
    SELECT pr.student_id,
           COALESCE(sum(pr.amount) FILTER (WHERE pr.paid_date IS NOT NULL), 0) AS collected,
           COALESCE(sum(pr.amount) FILTER (WHERE pr.paid_date IS NULL), 0) AS outstanding,
           COALESCE(sum(pr.amount) FILTER (WHERE pr.paid_date IS NULL AND pr.due_date < p_today), 0) AS overdue
    FROM payment_records pr
    GROUP BY pr.student_id
  ),
  enr AS (
    SELECT se.student_id,
           COALESCE(sum(se.lessons_used), 0)::bigint AS lessons_used,
           COALESCE(sum(se.total_lessons), 0)::bigint AS lessons_total
    FROM student_enrolments se
    GROUP BY se.student_id
  ),
  att AS (
    SELECT ls.student_id,
           count(*) FILTER (WHERE ls.attended IS TRUE) AS attended,
           count(*) FILTER (WHERE ls.attended IS FALSE) AS absent,
           count(*) FILTER (WHERE ls.attended IS FALSE AND ls.absence_category = 'charged') AS charged_absent
    FROM lesson_students ls
    JOIN lessons l ON l.id = ls.lesson_id AND l.status = 'completed'  -- reopened/cancelled lessons don't count
    GROUP BY ls.student_id
  ),
  ids AS (
    SELECT p.student_id FROM pay p UNION SELECT e.student_id FROM enr e UNION SELECT a.student_id FROM att a
  )
  SELECT s.id, s.full_name,
         COALESCE(pay.collected, 0), COALESCE(pay.outstanding, 0), COALESCE(pay.overdue, 0),
         COALESCE(enr.lessons_used, 0), COALESCE(enr.lessons_total, 0),
         COALESCE(att.attended, 0), COALESCE(att.absent, 0), COALESCE(att.charged_absent, 0)
  FROM ids
  JOIN students s ON s.id = ids.student_id
  LEFT JOIN pay ON pay.student_id = s.id
  LEFT JOIN enr ON enr.student_id = s.id
  LEFT JOIN att ON att.student_id = s.id;
END;
$$;

--
-- Name: request_absence(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_absence(p_lesson_id uuid, p_reason text, p_student_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_student UUID;
  v_n INTEGER;
  v_student_name TEXT;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_lesson lessons%ROWTYPE;
  v_starts TIMESTAMPTZ;
  v_late BOOLEAN;
  v_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM my_student_ids()) THEN
    RAISE EXCEPTION 'Only enrolled students can request an absence' USING ERRCODE = '42501';
  END IF;
  IF p_student_id IS NOT NULL AND p_student_id NOT IN (SELECT my_student_ids()) THEN
    RAISE EXCEPTION 'That student isn''t on your account' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'Please tell us why you can''t attend'; END IF;
  IF char_length(v_reason) > 300 THEN RAISE EXCEPTION 'Please keep the reason under 300 characters'; END IF;

  -- Which of the caller's children on this lesson is it for?
  SELECT count(*), min(ls.student_id::text)::uuid INTO v_n, v_student
  FROM lesson_students ls
  WHERE ls.lesson_id = p_lesson_id
    AND ls.student_id IN (SELECT my_student_ids())
    AND (p_student_id IS NULL OR ls.student_id = p_student_id);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Lesson not found' USING ERRCODE = '42501';
  END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'More than one of your children is in this lesson — choose which one can''t attend';
  END IF;

  SELECT l.* INTO v_lesson FROM lessons l WHERE l.id = p_lesson_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lesson not found' USING ERRCODE = '42501';
  END IF;
  IF v_lesson.status <> 'scheduled' THEN
    RAISE EXCEPTION 'This lesson is already %', v_lesson.status;
  END IF;

  v_starts := (v_lesson.date + v_lesson.start_time) AT TIME ZONE 'Asia/Kolkata';
  IF v_starts <= now() THEN
    RAISE EXCEPTION 'This lesson has already started';
  END IF;
  v_late := v_starts < now() + INTERVAL '24 hours';

  IF EXISTS (SELECT 1 FROM absence_requests
             WHERE lesson_id = p_lesson_id AND student_id = v_student AND status = 'approved') THEN
    RAISE EXCEPTION 'Your absence for this lesson is already approved';
  END IF;

  BEGIN
    INSERT INTO absence_requests (lesson_id, student_id, requested_by, reason, late_notice)
    VALUES (p_lesson_id, v_student, auth.uid(), v_reason, v_late)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You''ve already asked to miss this lesson — it''s waiting for approval';
  END;

  -- Let coordinators know (in-app).
  SELECT full_name INTO v_student_name FROM students WHERE id = v_student;
  INSERT INTO notifications (user_id, type, title, body)
  SELECT p.id, 'general', 'Absence request',
         COALESCE(v_student_name, 'A student') || ' can''t attend ' ||
         _lesson_when_label(v_lesson.date, v_lesson.start_time) ||
         CASE WHEN v_late THEN ' (late notice)' ELSE '' END || ': ' || v_reason
  FROM profiles p WHERE p.role = 'coordinator';

  RETURN jsonb_build_object('id', v_id, 'late_notice', v_late, 'student_id', v_student);
END;
$$;

--
-- Name: reset_calendar_token(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_calendar_token() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := public.assert_calendar_feed_allowed();
  v_token text := public.new_calendar_token();
BEGIN
  INSERT INTO calendar_tokens (user_id, token, created_at)
  VALUES (v_uid, v_token, now())
  ON CONFLICT (user_id) DO UPDATE
    SET token = EXCLUDED.token, created_at = EXCLUDED.created_at;
  RETURN v_token;
END;
$$;

--
-- Name: resolve_pending_on_makeup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_pending_on_makeup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_lesson lessons%ROWTYPE;
BEGIN
  SELECT * INTO v_lesson FROM lessons WHERE id = NEW.lesson_id;
  IF v_lesson.lesson_type <> 'makeup' OR v_lesson.status <> 'scheduled' THEN
    RETURN NEW;
  END IF;

  IF v_lesson.makeup_for_lesson_id IS NOT NULL THEN
    UPDATE lessons SET pending_reschedule = false
    WHERE id = v_lesson.makeup_for_lesson_id AND pending_reschedule = true;
    RETURN NEW;
  END IF;

  -- Makeups not tied to a specific lesson clear the oldest outstanding one.
  UPDATE lessons
  SET pending_reschedule = false
  WHERE id = (
    SELECT l.id
    FROM lessons l
    JOIN lesson_students ls ON ls.lesson_id = l.id
    WHERE ls.student_id = NEW.student_id
      AND l.pending_reschedule = true
      AND l.id <> NEW.lesson_id
    ORDER BY l.date, l.start_time
    LIMIT 1
  );
  RETURN NEW;
END;
$$;

--
-- Name: rollover_release_slot(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rollover_release_slot(p_student_id uuid, p_template_id uuid, p_to_year text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can renew enrolments' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM student_enrolments
             WHERE student_id = p_student_id
               AND (template_id = p_template_id OR p_template_id = ANY(COALESCE(extra_template_ids, '{}')))
               AND academic_year >= p_to_year) THEN
    RETURN false;
  END IF;
  UPDATE teacher_schedule_templates
    SET student_ids = array_remove(student_ids, p_student_id), updated_at = now()
    WHERE id = p_template_id AND p_student_id = ANY(COALESCE(student_ids, '{}'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

--
-- Name: schedule_group_session(text, uuid, date, time without time zone, time without time zone, uuid[], boolean, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.schedule_group_session(p_title text, p_teacher_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_student_ids uuid[] DEFAULT '{}'::uuid[], p_counts_toward_lessons boolean DEFAULT false, p_group_id uuid DEFAULT NULL::uuid, p_instrument_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE;
  v_teacher UUID := p_teacher_id;
  v_members UUID[] := COALESCE(p_student_ids, '{}');
  v_end TIME;
  v_clash RECORD;
  v_lesson UUID;
  v_n INTEGER;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can schedule sessions' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NOT NULL THEN
    g := _require_group(p_group_id);
    v_teacher := COALESCE(p_teacher_id, g.teacher_id);
    v_members := COALESCE(g.student_ids, '{}') || v_members;
  END IF;
  v_members := ARRAY(SELECT DISTINCT s FROM unnest(v_members) s);

  IF COALESCE(trim(p_title), '') = '' THEN RAISE EXCEPTION 'Please give the session a title'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_teacher AND role = 'teacher' AND approved IS TRUE) THEN
    RAISE EXCEPTION 'Please choose an approved teacher';
  END IF;
  IF p_date IS NULL OR p_start_time IS NULL THEN RAISE EXCEPTION 'Choose a date and start time'; END IF;
  IF p_end_time IS NOT NULL AND p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'End time must be after the start time';
  END IF;
  IF COALESCE(array_length(v_members, 1), 0) = 0 THEN RAISE EXCEPTION 'Add at least one student'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_members) s WHERE NOT EXISTS (SELECT 1 FROM students WHERE id = s)) THEN
    RAISE EXCEPTION 'One of the selected students no longer exists';
  END IF;

  v_end := COALESCE(p_end_time, p_start_time + INTERVAL '45 minutes');
  SELECT start_time, title INTO v_clash FROM lessons l
  WHERE l.teacher_id = v_teacher AND l.date = p_date AND l.status <> 'cancelled'
    AND l.start_time < v_end AND COALESCE(l.end_time, l.start_time + INTERVAL '45 minutes') > p_start_time
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'The teacher already has "%" at % that day', v_clash.title, to_char(v_clash.start_time, 'HH24:MI');
  END IF;

  INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, date, start_time, end_time,
                       title, is_charged, template_id)
  VALUES (v_teacher, COALESCE(p_location_id, g.location_id), COALESCE(p_instrument_id, g.instrument_id),
          'one_time', p_date, p_start_time, p_end_time, trim(p_title), COALESCE(p_counts_toward_lessons, false),
          p_group_id)
  RETURNING id INTO v_lesson;
  INSERT INTO lesson_students (lesson_id, student_id) SELECT v_lesson, s FROM unnest(v_members) s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('lesson_id', v_lesson, 'students', v_n);
END;
$$;

--
-- Name: set_student_login(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_student_login(p_student_id uuid, p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_profile profiles%ROWTYPE;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can change a student''s login' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'That login no longer exists'; END IF;
    IF v_profile.role <> 'student' THEN
      RAISE EXCEPTION 'Only a student / parent login can be linked (this login is a %)', v_profile.role;
    END IF;
    IF v_profile.approved IS NOT TRUE THEN
      RAISE EXCEPTION 'This login isn''t approved yet — approve it first, then link it';
    END IF;
  END IF;

  UPDATE students SET user_id = p_user_id, updated_at = now() WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'student_id', p_student_id,
    'login', CASE WHEN p_user_id IS NULL THEN NULL ELSE
      jsonb_build_object('id', v_profile.id, 'full_name', v_profile.full_name, 'email', v_profile.email) END,
    'children', CASE WHEN p_user_id IS NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'full_name', s.full_name, 'is_active', s.is_active)
                       ORDER BY s.full_name, s.id)
      FROM students s WHERE s.user_id = p_user_id), '[]'::jsonb) END
  );
END;
$$;

--
-- Name: teaches_lesson(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teaches_lesson(p_lesson_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM lessons WHERE id = p_lesson_id AND teacher_id = auth.uid());
$$;

--
-- Name: teaches_student(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teaches_student(p_student_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM lesson_students ls JOIN lessons l ON l.id = ls.lesson_id
    WHERE ls.student_id = p_student_id AND l.teacher_id = auth.uid()
  );
$$;

--
-- Name: undo_payment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.undo_payment(p_payment_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_pay payment_records%ROWTYPE;
  v_invoice_number TEXT;
  v_pdf_path TEXT;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can undo a payment' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pay FROM payment_records WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF v_pay.paid_date IS NULL THEN
    RAISE EXCEPTION 'This payment is not marked as paid — nothing to undo';
  END IF;

  DELETE FROM invoices WHERE payment_id = p_payment_id
    RETURNING invoice_number, pdf_path INTO v_invoice_number, v_pdf_path;

  UPDATE payment_records
     SET paid_date = NULL,
         verified_at = NULL,
         verified_by = NULL,
         reminder_sent = false,
         payment_method = NULL,
         payment_reference = NULL
   WHERE id = p_payment_id;

  INSERT INTO payment_events (payment_id, event, amount, invoice_number, paid_date, actor)
  VALUES (p_payment_id, 'undo_paid', v_pay.amount, v_invoice_number, v_pay.paid_date, auth.uid());

  RETURN jsonb_build_object('invoice_number', v_invoice_number, 'pdf_path', v_pdf_path);
END;
$$;

--
-- Name: update_group(uuid, text, boolean, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_group(p_group_id uuid, p_name text DEFAULT NULL::text, p_counts_toward_lessons boolean DEFAULT NULL::boolean, p_max_students integer DEFAULT NULL::integer, p_location_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE := _require_group(p_group_id, false);
  v_n INTEGER;
BEGIN
  IF p_name IS NOT NULL AND trim(p_name) = '' THEN RAISE EXCEPTION 'Please give the group a name'; END IF;
  IF p_max_students IS NOT NULL AND p_max_students < COALESCE(array_length(g.student_ids, 1), 0) THEN
    RAISE EXCEPTION 'The group already has % members', array_length(g.student_ids, 1);
  END IF;
  UPDATE teacher_schedule_templates SET
    title = COALESCE(NULLIF(trim(p_name), ''), title),
    counts_toward_lessons = COALESCE(p_counts_toward_lessons, counts_toward_lessons),
    max_students = COALESCE(p_max_students, max_students),
    location_id = COALESCE(p_location_id, location_id),
    updated_at = now()
  WHERE id = g.id RETURNING * INTO g;

  UPDATE lessons SET title = g.title, is_charged = g.counts_toward_lessons,
                     location_id = COALESCE(p_location_id, location_id)
  WHERE template_id = g.id AND status = 'scheduled' AND date >= _today_ist() AND lesson_type = 'regular';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('future_sessions_updated', v_n);
END;
$$;

--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

--
-- Name: withdraw_absence_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.withdraw_absence_request(p_request_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM my_student_ids()) THEN
    RAISE EXCEPTION 'Only enrolled students can withdraw a request' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM absence_requests
  WHERE id = p_request_id AND student_id IN (SELECT my_student_ids()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE = '42501'; END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been %', v_status;
  END IF;
  UPDATE absence_requests SET status = 'withdrawn', decided_at = now() WHERE id = p_request_id;
END;
$$;

--
-- Name: absence_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.absence_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lesson_id uuid NOT NULL,
    student_id uuid NOT NULL,
    requested_by uuid,
    reason text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    late_notice boolean DEFAULT false NOT NULL,
    charged boolean,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT absence_requests_note_check CHECK (((decision_note IS NULL) OR (char_length(decision_note) <= 300))),
    CONSTRAINT absence_requests_reason_check CHECK (((char_length(btrim(reason)) >= 1) AND (char_length(btrim(reason)) <= 300))),
    CONSTRAINT absence_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'withdrawn'::text])))
);

--
-- Name: calendar_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_tokens (
    user_id uuid NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: curriculum_resource_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_resource_tags (
    resource_id uuid NOT NULL,
    tag_id uuid NOT NULL
);

--
-- Name: curriculum_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    type public.resource_type DEFAULT 'piece'::public.resource_type NOT NULL,
    level public.resource_level DEFAULT 'beginner'::public.resource_level NOT NULL,
    teaching_tip text,
    location_id uuid,
    source_file text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);

--
-- Name: curriculum_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: instruments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instruments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    icon text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: invoice_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_counters (
    year text NOT NULL,
    last_number integer NOT NULL
);

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number text NOT NULL,
    payment_id uuid NOT NULL,
    student_id uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    description text,
    issued_date date DEFAULT CURRENT_DATE NOT NULL,
    pdf_path text,
    emailed_to text,
    emailed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: lesson_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lesson_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: lesson_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lesson_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid,
    location_id uuid,
    category text NOT NULL,
    rate_per_lesson numeric(10,2) NOT NULL,
    is_online boolean DEFAULT false NOT NULL,
    academic_year text DEFAULT '2025'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lesson_rate_positive CHECK ((rate_per_lesson > (0)::numeric))
);

--
-- Name: lesson_students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lesson_students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lesson_id uuid NOT NULL,
    student_id uuid NOT NULL,
    attended boolean,
    absence_category public.absence_category,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    enrolment_id uuid
);

--
-- Name: lessons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lessons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    location_id uuid,
    instrument_id uuid,
    lesson_type public.lesson_type DEFAULT 'regular'::public.lesson_type NOT NULL,
    status public.lesson_status DEFAULT 'scheduled'::public.lesson_status NOT NULL,
    date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone,
    title text DEFAULT ''::text NOT NULL,
    notes text,
    cancelled_by_student_id uuid,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_charged boolean DEFAULT true NOT NULL,
    cancelled_by_role text,
    cancelled_by_user_id uuid,
    makeup_direction text,
    source_break_id uuid,
    pending_reschedule boolean DEFAULT false NOT NULL,
    template_id uuid,
    makeup_for_lesson_id uuid,
    substitute_for_teacher_id uuid,
    reassign_reason text,
    CONSTRAINT lessons_cancelled_by_role_check CHECK (((cancelled_by_role IS NULL) OR (cancelled_by_role = ANY (ARRAY['student'::text, 'teacher'::text, 'coordinator'::text])))),
    CONSTRAINT lessons_end_after_start CHECK (((end_time IS NULL) OR (end_time > start_time))),
    CONSTRAINT lessons_makeup_direction_check CHECK (((makeup_direction IS NULL) OR (makeup_direction = ANY (ARRAY['teacher_teaching'::text, 'teacher_learning'::text]))))
);

--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text NOT NULL,
    city text DEFAULT ''::text NOT NULL,
    zone text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: media_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lesson_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    file_name text NOT NULL,
    file_type text NOT NULL,
    file_size bigint DEFAULT 0 NOT NULL,
    supabase_path text NOT NULL,
    google_drive_url text,
    synced_to_drive boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type public.notification_type DEFAULT 'general'::public.notification_type NOT NULL,
    title text NOT NULL,
    body text,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: payment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid,
    event text NOT NULL,
    amount numeric(10,2),
    invoice_number text,
    paid_date date,
    actor uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_events_event_check CHECK ((event = ANY (ARRAY['marked_paid'::text, 'undo_paid'::text])))
);

--
-- Name: payment_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    plan public.payment_plan,
    amount numeric(10,2) DEFAULT 0 NOT NULL,
    instalment_number integer DEFAULT 1 NOT NULL,
    due_date date NOT NULL,
    paid_date date,
    reminder_sent boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    verified_by uuid,
    label text,
    enrolment_id uuid,
    payment_method text,
    payment_reference text,
    CONSTRAINT payment_amount_non_negative CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payment_instalment_positive CHECK ((instalment_number >= 1)),
    CONSTRAINT payment_records_payment_method_check CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['cash'::text, 'upi'::text, 'bank_transfer'::text, 'cheque'::text, 'other'::text])))),
    CONSTRAINT payment_records_payment_reference_length CHECK (((payment_reference IS NULL) OR (char_length(payment_reference) <= 100)))
);

--
-- Name: scheduled_breaks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_breaks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by uuid NOT NULL,
    title text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    student_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    total_cancelled integer DEFAULT 0 NOT NULL,
    total_rescheduled integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT break_dates_valid CHECK ((end_date >= start_date))
);

--
-- Name: student_enrolments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_enrolments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    academic_year text DEFAULT '2025'::text NOT NULL,
    lesson_rate_id uuid,
    total_lessons integer DEFAULT 39 NOT NULL,
    lessons_used integer DEFAULT 0 NOT NULL,
    start_date date NOT NULL,
    payment_plan public.payment_plan NOT NULL,
    rate_per_lesson numeric(10,2) NOT NULL,
    total_fee numeric(10,2) NOT NULL,
    registration_fee numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    discount_kind text DEFAULT 'percent'::text NOT NULL,
    discount_value numeric(10,2) DEFAULT 0 NOT NULL,
    discount_primary text DEFAULT 'none'::text NOT NULL,
    discount_multilesson boolean DEFAULT false NOT NULL,
    instrument_id uuid,
    template_id uuid,
    extra_template_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    CONSTRAINT enrolment_fee_non_negative CHECK ((total_fee >= (0)::numeric)),
    CONSTRAINT enrolment_lessons_non_negative CHECK ((lessons_used >= 0)),
    CONSTRAINT student_enrolments_discount_kind_check CHECK ((discount_kind = ANY (ARRAY['percent'::text, 'amount'::text]))),
    CONSTRAINT student_enrolments_discount_primary_check CHECK ((discount_primary = ANY (ARRAY['none'::text, 'plan'::text, 'legacy'::text, 'special'::text]))),
    CONSTRAINT student_enrolments_discount_value_check CHECK ((discount_value >= (0)::numeric))
);

--
-- Name: student_instruments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_instruments (
    student_id uuid NOT NULL,
    instrument_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: student_pieces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_pieces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    title text NOT NULL,
    status public.piece_status DEFAULT 'not_started'::public.piece_status NOT NULL,
    added_date date DEFAULT CURRENT_DATE NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    full_name text NOT NULL,
    email text,
    phone text,
    parent_name text,
    parent_phone text,
    parent_email text,
    location_id uuid,
    instrument_id uuid,
    payment_plan public.payment_plan DEFAULT 'trial'::public.payment_plan NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    address text
);

--
-- Name: student_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.student_stats WITH (security_invoker='true') AS
 SELECT s.id AS student_id,
    s.full_name AS student_name,
    count(DISTINCT ls.lesson_id) FILTER (WHERE (l.status = 'completed'::public.lesson_status)) AS total_lessons,
    count(DISTINCT ls.lesson_id) FILTER (WHERE ((l.status = 'completed'::public.lesson_status) AND (l.lesson_type = 'regular'::public.lesson_type))) AS regular_lessons,
    count(DISTINCT ls.lesson_id) FILTER (WHERE ((l.status = 'completed'::public.lesson_status) AND (l.lesson_type = 'makeup'::public.lesson_type))) AS makeup_lessons,
    count(DISTINCT ls.lesson_id) FILTER (WHERE ((l.status = 'completed'::public.lesson_status) AND (l.lesson_type = 'special'::public.lesson_type))) AS special_lessons,
    count(DISTINCT ls.id) FILTER (WHERE ((ls.attended = false) AND (ls.absence_category = 'charged'::public.absence_category))) AS charged_absences,
    count(DISTINCT ls.id) FILTER (WHERE ((ls.attended = false) AND (ls.absence_category = 'not_charged'::public.absence_category))) AS not_charged_absences
   FROM ((public.students s
     LEFT JOIN public.lesson_students ls ON ((ls.student_id = s.id)))
     LEFT JOIN public.lessons l ON ((l.id = ls.lesson_id)))
  GROUP BY s.id, s.full_name;

--
-- Name: absence_requests absence_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_requests
    ADD CONSTRAINT absence_requests_pkey PRIMARY KEY (id);

--
-- Name: calendar_tokens calendar_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_tokens
    ADD CONSTRAINT calendar_tokens_pkey PRIMARY KEY (user_id);

--
-- Name: calendar_tokens calendar_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_tokens
    ADD CONSTRAINT calendar_tokens_token_key UNIQUE (token);

--
-- Name: curriculum_resource_tags curriculum_resource_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_resource_tags
    ADD CONSTRAINT curriculum_resource_tags_pkey PRIMARY KEY (resource_id, tag_id);

--
-- Name: curriculum_resources curriculum_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_resources
    ADD CONSTRAINT curriculum_resources_pkey PRIMARY KEY (id);

--
-- Name: curriculum_tags curriculum_tags_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_tags
    ADD CONSTRAINT curriculum_tags_name_key UNIQUE (name);

--
-- Name: curriculum_tags curriculum_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_tags
    ADD CONSTRAINT curriculum_tags_pkey PRIMARY KEY (id);

--
-- Name: instruments instruments_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instruments
    ADD CONSTRAINT instruments_name_key UNIQUE (name);

--
-- Name: instruments instruments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instruments
    ADD CONSTRAINT instruments_pkey PRIMARY KEY (id);

--
-- Name: invoice_counters invoice_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_counters
    ADD CONSTRAINT invoice_counters_pkey PRIMARY KEY (year);

--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);

--
-- Name: invoices invoices_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_payment_id_key UNIQUE (payment_id);

--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);

--
-- Name: lesson_categories lesson_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_categories
    ADD CONSTRAINT lesson_categories_name_key UNIQUE (name);

--
-- Name: lesson_categories lesson_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_categories
    ADD CONSTRAINT lesson_categories_pkey PRIMARY KEY (id);

--
-- Name: lesson_rates lesson_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_rates
    ADD CONSTRAINT lesson_rates_pkey PRIMARY KEY (id);

--
-- Name: lesson_rates lesson_rates_teacher_id_location_id_category_is_online_acad_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_rates
    ADD CONSTRAINT lesson_rates_teacher_id_location_id_category_is_online_acad_key UNIQUE (teacher_id, location_id, category, is_online, academic_year);

--
-- Name: lesson_students lesson_students_lesson_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_students
    ADD CONSTRAINT lesson_students_lesson_id_student_id_key UNIQUE (lesson_id, student_id);

--
-- Name: lesson_students lesson_students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_students
    ADD CONSTRAINT lesson_students_pkey PRIMARY KEY (id);

--
-- Name: lessons lessons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_pkey PRIMARY KEY (id);

--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);

--
-- Name: media_uploads media_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_uploads
    ADD CONSTRAINT media_uploads_pkey PRIMARY KEY (id);

--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

--
-- Name: payment_events payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);

--
-- Name: payment_records payment_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_records
    ADD CONSTRAINT payment_records_pkey PRIMARY KEY (id);

--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

--
-- Name: scheduled_breaks scheduled_breaks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_breaks
    ADD CONSTRAINT scheduled_breaks_pkey PRIMARY KEY (id);

--
-- Name: student_enrolments student_enrolments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrolments
    ADD CONSTRAINT student_enrolments_pkey PRIMARY KEY (id);

--
-- Name: student_instruments student_instruments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_instruments
    ADD CONSTRAINT student_instruments_pkey PRIMARY KEY (student_id, instrument_id);

--
-- Name: student_pieces student_pieces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_pieces
    ADD CONSTRAINT student_pieces_pkey PRIMARY KEY (id);

--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);

--
-- Name: teacher_schedule_templates teacher_schedule_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_schedule_templates
    ADD CONSTRAINT teacher_schedule_templates_pkey PRIMARY KEY (id);

--
-- Name: idx_absence_requests_lesson; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_absence_requests_lesson ON public.absence_requests USING btree (lesson_id);

--
-- Name: idx_absence_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_absence_requests_status ON public.absence_requests USING btree (status, created_at DESC);

--
-- Name: idx_absence_requests_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_absence_requests_student ON public.absence_requests USING btree (student_id, created_at DESC);

--
-- Name: idx_curriculum_tags_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_curriculum_tags_name ON public.curriculum_tags USING btree (name);

--
-- Name: idx_enrolments_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrolments_student ON public.student_enrolments USING btree (student_id);

--
-- Name: idx_enrolments_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrolments_template ON public.student_enrolments USING btree (template_id);

--
-- Name: idx_enrolments_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrolments_year ON public.student_enrolments USING btree (academic_year);

--
-- Name: idx_invoices_issued_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_issued_date ON public.invoices USING btree (issued_date);

--
-- Name: idx_invoices_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_payment ON public.invoices USING btree (payment_id);

--
-- Name: idx_invoices_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_student ON public.invoices USING btree (student_id);

--
-- Name: idx_lesson_rates_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lesson_rates_category ON public.lesson_rates USING btree (category, is_online, academic_year);

--
-- Name: idx_lesson_rates_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lesson_rates_teacher ON public.lesson_rates USING btree (teacher_id, category);

--
-- Name: idx_lesson_students_enrolment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lesson_students_enrolment ON public.lesson_students USING btree (enrolment_id);

--
-- Name: idx_lesson_students_lesson; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lesson_students_lesson ON public.lesson_students USING btree (lesson_id);

--
-- Name: idx_lesson_students_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lesson_students_student ON public.lesson_students USING btree (student_id);

--
-- Name: idx_lessons_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lessons_date ON public.lessons USING btree (date);

--
-- Name: idx_lessons_date_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lessons_date_status ON public.lessons USING btree (date, status);

--
-- Name: idx_lessons_pending_reschedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lessons_pending_reschedule ON public.lessons USING btree (pending_reschedule) WHERE (pending_reschedule = true);

--
-- Name: idx_lessons_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lessons_status ON public.lessons USING btree (status);

--
-- Name: idx_lessons_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lessons_teacher ON public.lessons USING btree (teacher_id);

--
-- Name: idx_lessons_teacher_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lessons_teacher_date ON public.lessons USING btree (teacher_id, date);

--
-- Name: idx_lessons_template_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lessons_template_date ON public.lessons USING btree (template_id, date);

--
-- Name: idx_media_uploads_lesson; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_uploads_lesson ON public.media_uploads USING btree (lesson_id);

--
-- Name: idx_media_uploads_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_uploads_teacher ON public.media_uploads USING btree (teacher_id);

--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id, read) WHERE (read = false);

--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);

--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id) WHERE (read = false);

--
-- Name: idx_payment_events_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_events_payment ON public.payment_events USING btree (payment_id, created_at);

--
-- Name: idx_payment_records_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_records_due ON public.payment_records USING btree (due_date);

--
-- Name: idx_payment_records_enrolment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_records_enrolment ON public.payment_records USING btree (enrolment_id);

--
-- Name: idx_payment_records_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_records_student ON public.payment_records USING btree (student_id);

--
-- Name: idx_payment_records_student_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_records_student_plan ON public.payment_records USING btree (student_id, plan);

--
-- Name: idx_payment_records_unpaid_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_records_unpaid_due ON public.payment_records USING btree (due_date) WHERE (paid_date IS NULL);

--
-- Name: idx_profiles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_role ON public.profiles USING btree (role);

--
-- Name: idx_resource_tags_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_tags_resource ON public.curriculum_resource_tags USING btree (resource_id);

--
-- Name: idx_resource_tags_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_tags_tag ON public.curriculum_resource_tags USING btree (tag_id);

--
-- Name: idx_schedule_templates_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_templates_day ON public.teacher_schedule_templates USING btree (day_of_week);

--
-- Name: idx_schedule_templates_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_templates_teacher ON public.teacher_schedule_templates USING btree (teacher_id);

--
-- Name: idx_student_instruments_instrument; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_instruments_instrument ON public.student_instruments USING btree (instrument_id);

--
-- Name: idx_student_instruments_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_instruments_student ON public.student_instruments USING btree (student_id);

--
-- Name: idx_student_pieces_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_pieces_student ON public.student_pieces USING btree (student_id);

--
-- Name: idx_student_pieces_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_pieces_teacher ON public.student_pieces USING btree (teacher_id);

--
-- Name: idx_students_instrument; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_instrument ON public.students USING btree (instrument_id);

--
-- Name: idx_students_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_is_active ON public.students USING btree (is_active);

--
-- Name: idx_students_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_location ON public.students USING btree (location_id);

--
-- Name: idx_students_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_user_id ON public.students USING btree (user_id);

--
-- Name: uq_absence_requests_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_absence_requests_pending ON public.absence_requests USING btree (lesson_id, student_id) WHERE (status = 'pending'::text);

--
-- Name: curriculum_resources set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.curriculum_resources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: lessons set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lessons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: profiles set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: student_pieces set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.student_pieces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: students set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: teacher_schedule_templates set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.teacher_schedule_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: student_enrolments set_updated_at_enrolments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_enrolments BEFORE UPDATE ON public.student_enrolments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: lessons trg_block_non_coordinator_cancel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_block_non_coordinator_cancel BEFORE UPDATE ON public.lessons FOR EACH ROW EXECUTE FUNCTION public.block_non_coordinator_cancel();

--
-- Name: lesson_categories trg_cascade_lesson_category_rename; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cascade_lesson_category_rename AFTER UPDATE OF name ON public.lesson_categories FOR EACH ROW EXECUTE FUNCTION public.cascade_lesson_category_rename();

--
-- Name: lessons trg_check_teacher_double_booking; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_teacher_double_booking BEFORE INSERT OR UPDATE ON public.lessons FOR EACH ROW EXECUTE FUNCTION public.fn_check_teacher_double_booking();

--
-- Name: teacher_schedule_templates trg_enrolments_forget_deleted_slot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enrolments_forget_deleted_slot AFTER DELETE ON public.teacher_schedule_templates FOR EACH ROW EXECUTE FUNCTION public.fn_enrolments_forget_deleted_slot();

--
-- Name: lesson_students trg_guard_lesson_students_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_lesson_students_update BEFORE UPDATE ON public.lesson_students FOR EACH ROW EXECUTE FUNCTION public.guard_lesson_students_update();

--
-- Name: profiles trg_guard_profile_privileged_columns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_profile_privileged_columns BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();

--
-- Name: lesson_students trg_lesson_students_recompute_used; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lesson_students_recompute_used AFTER INSERT OR DELETE OR UPDATE ON public.lesson_students FOR EACH ROW EXECUTE FUNCTION public.fn_lesson_students_recompute_used();

--
-- Name: lessons trg_lessons_recompute_used; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lessons_recompute_used AFTER UPDATE ON public.lessons FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) OR (old.is_charged IS DISTINCT FROM new.is_charged) OR (old.makeup_direction IS DISTINCT FROM new.makeup_direction) OR (old.date IS DISTINCT FROM new.date))) EXECUTE FUNCTION public.fn_lessons_recompute_used();

--
-- Name: payment_records trg_payment_marked_paid; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_marked_paid AFTER UPDATE OF paid_date ON public.payment_records FOR EACH ROW WHEN (((old.paid_date IS NULL) AND (new.paid_date IS NOT NULL))) EXECUTE FUNCTION public.log_payment_marked_paid();

--
-- Name: profiles trg_profiles_link_students_on_approval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_link_students_on_approval AFTER INSERT OR UPDATE OF approved, role ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_link_students_on_approval();

--
-- Name: lesson_students trg_resolve_pending_on_makeup; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_resolve_pending_on_makeup AFTER INSERT ON public.lesson_students FOR EACH ROW EXECUTE FUNCTION public.resolve_pending_on_makeup();

--
-- Name: students trg_students_link_login_by_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_students_link_login_by_email BEFORE INSERT OR UPDATE OF email ON public.students FOR EACH ROW EXECUTE FUNCTION public.fn_students_link_login_by_email();

--
-- Name: absence_requests absence_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_requests
    ADD CONSTRAINT absence_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

--
-- Name: absence_requests absence_requests_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_requests
    ADD CONSTRAINT absence_requests_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE CASCADE;

--
-- Name: absence_requests absence_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_requests
    ADD CONSTRAINT absence_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

--
-- Name: absence_requests absence_requests_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_requests
    ADD CONSTRAINT absence_requests_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

--
-- Name: calendar_tokens calendar_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_tokens
    ADD CONSTRAINT calendar_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: curriculum_resource_tags curriculum_resource_tags_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_resource_tags
    ADD CONSTRAINT curriculum_resource_tags_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.curriculum_resources(id) ON DELETE CASCADE;

--
-- Name: curriculum_resource_tags curriculum_resource_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_resource_tags
    ADD CONSTRAINT curriculum_resource_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.curriculum_tags(id) ON DELETE CASCADE;

--
-- Name: curriculum_resources curriculum_resources_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_resources
    ADD CONSTRAINT curriculum_resources_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

--
-- Name: curriculum_resources curriculum_resources_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_resources
    ADD CONSTRAINT curriculum_resources_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

--
-- Name: invoices invoices_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payment_records(id) ON DELETE CASCADE;

--
-- Name: invoices invoices_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE RESTRICT;

--
-- Name: lesson_rates lesson_rates_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_rates
    ADD CONSTRAINT lesson_rates_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

--
-- Name: lesson_rates lesson_rates_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_rates
    ADD CONSTRAINT lesson_rates_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

--
-- Name: lesson_students lesson_students_enrolment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_students
    ADD CONSTRAINT lesson_students_enrolment_id_fkey FOREIGN KEY (enrolment_id) REFERENCES public.student_enrolments(id) ON DELETE SET NULL;

--
-- Name: lesson_students lesson_students_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_students
    ADD CONSTRAINT lesson_students_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE CASCADE;

--
-- Name: lesson_students lesson_students_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_students
    ADD CONSTRAINT lesson_students_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

--
-- Name: lessons lessons_cancelled_by_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_cancelled_by_student_id_fkey FOREIGN KEY (cancelled_by_student_id) REFERENCES public.students(id) ON DELETE SET NULL;

--
-- Name: lessons lessons_cancelled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_cancelled_by_user_id_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES public.profiles(id);

--
-- Name: lessons lessons_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE SET NULL;

--
-- Name: lessons lessons_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

--
-- Name: lessons lessons_makeup_for_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_makeup_for_lesson_id_fkey FOREIGN KEY (makeup_for_lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;

--
-- Name: lessons lessons_source_break_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_source_break_fkey FOREIGN KEY (source_break_id) REFERENCES public.scheduled_breaks(id) ON DELETE SET NULL;

--
-- Name: lessons lessons_substitute_for_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_substitute_for_teacher_id_fkey FOREIGN KEY (substitute_for_teacher_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

--
-- Name: lessons lessons_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

--
-- Name: lessons lessons_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.teacher_schedule_templates(id) ON DELETE SET NULL;

--
-- Name: media_uploads media_uploads_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_uploads
    ADD CONSTRAINT media_uploads_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE CASCADE;

--
-- Name: media_uploads media_uploads_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_uploads
    ADD CONSTRAINT media_uploads_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: payment_events payment_events_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payment_records(id) ON DELETE SET NULL;

--
-- Name: payment_records payment_records_enrolment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_records
    ADD CONSTRAINT payment_records_enrolment_id_fkey FOREIGN KEY (enrolment_id) REFERENCES public.student_enrolments(id) ON DELETE SET NULL;

--
-- Name: payment_records payment_records_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_records
    ADD CONSTRAINT payment_records_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE RESTRICT;

--
-- Name: payment_records payment_records_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_records
    ADD CONSTRAINT payment_records_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: scheduled_breaks scheduled_breaks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_breaks
    ADD CONSTRAINT scheduled_breaks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);

--
-- Name: student_enrolments student_enrolments_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrolments
    ADD CONSTRAINT student_enrolments_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE SET NULL;

--
-- Name: student_enrolments student_enrolments_lesson_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrolments
    ADD CONSTRAINT student_enrolments_lesson_rate_id_fkey FOREIGN KEY (lesson_rate_id) REFERENCES public.lesson_rates(id) ON DELETE SET NULL;

--
-- Name: student_enrolments student_enrolments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrolments
    ADD CONSTRAINT student_enrolments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

--
-- Name: student_enrolments student_enrolments_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrolments
    ADD CONSTRAINT student_enrolments_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.teacher_schedule_templates(id) ON DELETE SET NULL;

--
-- Name: student_instruments student_instruments_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_instruments
    ADD CONSTRAINT student_instruments_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE CASCADE;

--
-- Name: student_instruments student_instruments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_instruments
    ADD CONSTRAINT student_instruments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

--
-- Name: student_pieces student_pieces_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_pieces
    ADD CONSTRAINT student_pieces_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

--
-- Name: student_pieces student_pieces_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_pieces
    ADD CONSTRAINT student_pieces_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: students students_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE SET NULL;

--
-- Name: students students_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

--
-- Name: students students_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: teacher_schedule_templates teacher_schedule_templates_instrument_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_schedule_templates
    ADD CONSTRAINT teacher_schedule_templates_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(id) ON DELETE SET NULL;

--
-- Name: teacher_schedule_templates teacher_schedule_templates_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_schedule_templates
    ADD CONSTRAINT teacher_schedule_templates_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

--
-- Name: teacher_schedule_templates teacher_schedule_templates_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_schedule_templates
    ADD CONSTRAINT teacher_schedule_templates_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: instruments Anyone can view instruments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view instruments" ON public.instruments FOR SELECT USING (true);

--
-- Name: lesson_categories Anyone can view lesson categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view lesson categories" ON public.lesson_categories FOR SELECT USING (true);

--
-- Name: locations Anyone can view locations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view locations" ON public.locations FOR SELECT USING (true);

--
-- Name: curriculum_resource_tags Anyone can view resource tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view resource tags" ON public.curriculum_resource_tags FOR SELECT TO authenticated USING (true);

--
-- Name: curriculum_resources Anyone can view resources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view resources" ON public.curriculum_resources FOR SELECT TO authenticated USING (true);

--
-- Name: curriculum_tags Anyone can view tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view tags" ON public.curriculum_tags FOR SELECT TO authenticated USING (true);

--
-- Name: profiles Coordinators can view all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators can view all profiles" ON public.profiles FOR SELECT USING ((( SELECT public.jwt_role() AS v) = 'coordinator'::text));

--
-- Name: lessons Coordinators manage all lessons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage all lessons" ON public.lessons USING ((( SELECT public.jwt_role() AS v) = 'coordinator'::text));

--
-- Name: media_uploads Coordinators manage all media; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage all media" ON public.media_uploads USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: student_pieces Coordinators manage all pieces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage all pieces" ON public.student_pieces USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: profiles Coordinators manage all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage all profiles" ON public.profiles USING ((( SELECT public.jwt_role() AS v) = 'coordinator'::text));

--
-- Name: instruments Coordinators manage instruments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage instruments" ON public.instruments USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: invoices Coordinators manage invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage invoices" ON public.invoices USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role)) WITH CHECK ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: lesson_categories Coordinators manage lesson categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage lesson categories" ON public.lesson_categories USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: lesson_students Coordinators manage lesson students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage lesson students" ON public.lesson_students USING ((( SELECT public.jwt_role() AS v) = 'coordinator'::text));

--
-- Name: lesson_rates Coordinators manage lesson_rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage lesson_rates" ON public.lesson_rates USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role)) WITH CHECK ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: locations Coordinators manage locations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage locations" ON public.locations USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: payment_records Coordinators manage payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage payments" ON public.payment_records USING ((( SELECT public.jwt_role() AS v) = 'coordinator'::text));

--
-- Name: curriculum_resource_tags Coordinators manage resource tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage resource tags" ON public.curriculum_resource_tags USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: curriculum_resources Coordinators manage resources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage resources" ON public.curriculum_resources USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: teacher_schedule_templates Coordinators manage schedule templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage schedule templates" ON public.teacher_schedule_templates USING ((( SELECT public.jwt_role() AS jwt_role) = 'coordinator'::text)) WITH CHECK ((( SELECT public.jwt_role() AS jwt_role) = 'coordinator'::text));

--
-- Name: scheduled_breaks Coordinators manage scheduled_breaks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage scheduled_breaks" ON public.scheduled_breaks USING ((( SELECT public.jwt_role() AS jwt_role) = 'coordinator'::text)) WITH CHECK ((( SELECT public.jwt_role() AS jwt_role) = 'coordinator'::text));

--
-- Name: student_instruments Coordinators manage student instruments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage student instruments" ON public.student_instruments USING ((( SELECT public.jwt_role() AS v) = 'coordinator'::text));

--
-- Name: student_enrolments Coordinators manage student_enrolments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage student_enrolments" ON public.student_enrolments USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role)) WITH CHECK ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: students Coordinators manage students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage students" ON public.students USING ((( SELECT public.jwt_role() AS v) = 'coordinator'::text));

--
-- Name: curriculum_tags Coordinators manage tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators manage tags" ON public.curriculum_tags USING ((( SELECT public.get_user_role() AS v) = 'coordinator'::public.user_role));

--
-- Name: absence_requests Coordinators read absence requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators read absence requests" ON public.absence_requests FOR SELECT USING ((( SELECT public.jwt_role() AS jwt_role) = 'coordinator'::text));

--
-- Name: payment_events Coordinators read payment events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coordinators read payment events" ON public.payment_events FOR SELECT USING ((( SELECT public.jwt_role() AS jwt_role) = 'coordinator'::text));

--
-- Name: notifications Insert own or coordinator notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Insert own or coordinator notifications" ON public.notifications FOR INSERT WITH CHECK (((user_id = ( SELECT auth.uid() AS v)) OR (( SELECT public.jwt_role() AS v) = 'coordinator'::text)));

--
-- Name: profiles Students can view teacher profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can view teacher profiles" ON public.profiles FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.my_student_ids() my_student_ids(my_student_ids))) AND (role = 'teacher'::public.user_role) AND (approved IS TRUE)));

--
-- Name: lesson_rates Students read lesson_rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students read lesson_rates" ON public.lesson_rates FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.my_student_ids() my_student_ids(my_student_ids))));

--
-- Name: absence_requests Students read own absence requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students read own absence requests" ON public.absence_requests FOR SELECT USING ((student_id IN ( SELECT public.my_student_ids() AS my_student_ids)));

--
-- Name: scheduled_breaks Students read own breaks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students read own breaks" ON public.scheduled_breaks FOR SELECT USING ((student_ids && ARRAY( SELECT public.my_student_ids() AS my_student_ids)));

--
-- Name: student_enrolments Students read own enrolments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students read own enrolments" ON public.student_enrolments FOR SELECT USING (((( SELECT public.get_user_role() AS get_user_role) = 'student'::public.user_role) AND (student_id IN ( SELECT public.my_student_ids() AS my_student_ids))));

--
-- Name: invoices Students read own invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students read own invoices" ON public.invoices FOR SELECT USING (((( SELECT public.get_user_role() AS get_user_role) = 'student'::public.user_role) AND (student_id IN ( SELECT public.my_student_ids() AS my_student_ids))));

--
-- Name: media_uploads Students read own lesson media; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students read own lesson media" ON public.media_uploads FOR SELECT USING (((( SELECT public.jwt_role() AS jwt_role) = 'student'::text) AND (lesson_id IN ( SELECT public.get_student_lesson_ids() AS get_student_lesson_ids))));

--
-- Name: lessons Students see enrolled lessons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students see enrolled lessons" ON public.lessons FOR SELECT USING (((( SELECT public.jwt_role() AS jwt_role) = 'student'::text) AND (id IN ( SELECT public.get_student_lesson_ids() AS get_student_lesson_ids))));

--
-- Name: lesson_students Students see own enrollments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students see own enrollments" ON public.lesson_students FOR SELECT USING (((( SELECT public.jwt_role() AS jwt_role) = 'student'::text) AND (student_id IN ( SELECT public.my_student_ids() AS my_student_ids))));

--
-- Name: payment_records Students see own payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students see own payments" ON public.payment_records FOR SELECT USING (((( SELECT public.jwt_role() AS jwt_role) = 'student'::text) AND (student_id IN ( SELECT public.my_student_ids() AS my_student_ids))));

--
-- Name: student_pieces Students see own pieces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students see own pieces" ON public.student_pieces FOR SELECT USING ((student_id IN ( SELECT public.my_student_ids() AS my_student_ids)));

--
-- Name: students Students see own record; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students see own record" ON public.students FOR SELECT USING ((id IN ( SELECT public.my_student_ids() AS my_student_ids)));

--
-- Name: student_instruments Students view own instruments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students view own instruments" ON public.student_instruments FOR SELECT USING (((( SELECT public.jwt_role() AS jwt_role) = 'student'::text) AND (student_id IN ( SELECT public.my_student_ids() AS my_student_ids))));

--
-- Name: profiles Teachers can view teacher profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers can view teacher profiles" ON public.profiles FOR SELECT USING ((( SELECT public.is_approved_teacher() AS v) AND (role = 'teacher'::public.user_role)));

--
-- Name: curriculum_resources Teachers create curriculum_resources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers create curriculum_resources" ON public.curriculum_resources FOR INSERT WITH CHECK (( SELECT public.is_approved_teacher() AS is_approved_teacher));

--
-- Name: curriculum_tags Teachers create tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers create tags" ON public.curriculum_tags FOR INSERT WITH CHECK (( SELECT public.is_approved_teacher() AS is_approved_teacher));

--
-- Name: curriculum_resources Teachers delete own curriculum_resources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers delete own curriculum_resources" ON public.curriculum_resources FOR DELETE USING ((( SELECT public.is_approved_teacher() AS is_approved_teacher) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (created_by IS NULL))));

--
-- Name: media_uploads Teachers manage own media; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers manage own media" ON public.media_uploads USING (((teacher_id = ( SELECT auth.uid() AS v)) AND ( SELECT public.is_approved_teacher() AS v)));

--
-- Name: student_pieces Teachers manage own student pieces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers manage own student pieces" ON public.student_pieces USING (((teacher_id = ( SELECT auth.uid() AS v)) AND ( SELECT public.is_approved_teacher() AS v)));

--
-- Name: absence_requests Teachers read absence requests for own lessons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers read absence requests for own lessons" ON public.absence_requests FOR SELECT USING (((( SELECT public.jwt_role() AS jwt_role) = 'teacher'::text) AND ( SELECT public.is_approved_teacher() AS is_approved_teacher) AND public.teaches_lesson(lesson_id)));

--
-- Name: scheduled_breaks Teachers read affected breaks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers read affected breaks" ON public.scheduled_breaks FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.lessons l
  WHERE ((l.source_break_id = scheduled_breaks.id) AND (l.teacher_id = ( SELECT auth.uid() AS v))))));

--
-- Name: lesson_rates Teachers read lesson_rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers read lesson_rates" ON public.lesson_rates FOR SELECT USING (( SELECT public.is_approved_teacher() AS is_approved_teacher));

--
-- Name: student_enrolments Teachers read own students enrolments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers read own students enrolments" ON public.student_enrolments FOR SELECT USING (((( SELECT public.jwt_role() AS jwt_role) = 'teacher'::text) AND ( SELECT public.is_approved_teacher() AS is_approved_teacher) AND public.teaches_student(student_id)));

--
-- Name: lesson_students Teachers see own lesson students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers see own lesson students" ON public.lesson_students FOR SELECT USING (((( SELECT public.jwt_role() AS jwt_role) = 'teacher'::text) AND ( SELECT public.is_approved_teacher() AS is_approved_teacher) AND public.teaches_lesson(lesson_id)));

--
-- Name: lessons Teachers see own lessons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers see own lessons" ON public.lessons FOR SELECT USING (((teacher_id = ( SELECT auth.uid() AS v)) AND ( SELECT public.is_approved_teacher() AS v)));

--
-- Name: students Teachers see their lesson students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers see their lesson students" ON public.students FOR SELECT USING (((( SELECT public.jwt_role() AS jwt_role) = 'teacher'::text) AND ( SELECT public.is_approved_teacher() AS is_approved_teacher) AND public.teaches_student(id)));

--
-- Name: curriculum_resource_tags Teachers tag own resources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers tag own resources" ON public.curriculum_resource_tags USING ((( SELECT public.is_approved_teacher() AS is_approved_teacher) AND (EXISTS ( SELECT 1
   FROM public.curriculum_resources r
  WHERE ((r.id = curriculum_resource_tags.resource_id) AND (r.created_by = ( SELECT auth.uid() AS uid))))))) WITH CHECK ((( SELECT public.is_approved_teacher() AS is_approved_teacher) AND (EXISTS ( SELECT 1
   FROM public.curriculum_resources r
  WHERE ((r.id = curriculum_resource_tags.resource_id) AND (r.created_by = ( SELECT auth.uid() AS uid)))))));

--
-- Name: curriculum_resources Teachers update own curriculum_resources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers update own curriculum_resources" ON public.curriculum_resources FOR UPDATE USING ((( SELECT public.is_approved_teacher() AS is_approved_teacher) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (created_by IS NULL))));

--
-- Name: lesson_students Teachers update own lesson students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers update own lesson students" ON public.lesson_students FOR UPDATE USING (((( SELECT public.jwt_role() AS jwt_role) = 'teacher'::text) AND ( SELECT public.is_approved_teacher() AS is_approved_teacher) AND public.teaches_lesson(lesson_id)));

--
-- Name: lessons Teachers update own lessons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers update own lessons" ON public.lessons FOR UPDATE USING (((teacher_id = ( SELECT auth.uid() AS v)) AND ( SELECT public.is_approved_teacher() AS v)));

--
-- Name: teacher_schedule_templates Teachers view own templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers view own templates" ON public.teacher_schedule_templates FOR SELECT USING ((teacher_id = ( SELECT auth.uid() AS v)));

--
-- Name: student_instruments Teachers view student instruments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers view student instruments" ON public.student_instruments FOR SELECT USING ((( SELECT public.is_approved_teacher() AS is_approved_teacher) AND public.teaches_student(student_id)));

--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));

--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((id = ( SELECT auth.uid() AS v)));

--
-- Name: notifications Users delete own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own notifications" ON public.notifications FOR DELETE USING ((user_id = ( SELECT auth.uid() AS v)));

--
-- Name: calendar_tokens Users read own calendar token; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own calendar token" ON public.calendar_tokens FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

--
-- Name: notifications Users see own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own notifications" ON public.notifications FOR SELECT USING ((user_id = ( SELECT auth.uid() AS v)));

--
-- Name: notifications Users update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS v)));

--
-- Name: absence_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.absence_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: curriculum_resource_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.curriculum_resource_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: curriculum_resources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.curriculum_resources ENABLE ROW LEVEL SECURITY;

--
-- Name: curriculum_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.curriculum_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: instruments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: lesson_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lesson_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: lesson_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lesson_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: lesson_students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lesson_students ENABLE ROW LEVEL SECURITY;

--
-- Name: lessons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

--
-- Name: locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

--
-- Name: media_uploads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.media_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: scheduled_breaks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scheduled_breaks ENABLE ROW LEVEL SECURITY;

--
-- Name: student_enrolments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_enrolments ENABLE ROW LEVEL SECURITY;

--
-- Name: student_instruments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_instruments ENABLE ROW LEVEL SECURITY;

--
-- Name: student_pieces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_pieces ENABLE ROW LEVEL SECURITY;

--
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_schedule_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_schedule_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

--
-- Name: FUNCTION _approved_login_for_email(p_email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._approved_login_for_email(p_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public._approved_login_for_email(p_email text) TO service_role;

--
-- Name: FUNCTION _generate_group_sessions(p_group_id uuid, p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._generate_group_sessions(p_group_id uuid, p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public._generate_group_sessions(p_group_id uuid, p_from date, p_to date) TO service_role;

--
-- Name: FUNCTION _lesson_when_label(p_date date, p_time time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._lesson_when_label(p_date date, p_time time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public._lesson_when_label(p_date date, p_time time without time zone) TO service_role;

--
-- Name: TABLE teacher_schedule_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_schedule_templates TO anon;
GRANT ALL ON TABLE public.teacher_schedule_templates TO authenticated;
GRANT ALL ON TABLE public.teacher_schedule_templates TO service_role;

--
-- Name: FUNCTION _require_group(p_group_id uuid, p_active boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._require_group(p_group_id uuid, p_active boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public._require_group(p_group_id uuid, p_active boolean) TO service_role;

--
-- Name: FUNCTION _today_ist(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public._today_ist() TO anon;
GRANT ALL ON FUNCTION public._today_ist() TO authenticated;
GRANT ALL ON FUNCTION public._today_ist() TO service_role;

--
-- Name: FUNCTION add_group_members(p_group_id uuid, p_student_ids uuid[], p_from_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_group_members(p_group_id uuid, p_student_ids uuid[], p_from_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_group_members(p_group_id uuid, p_student_ids uuid[], p_from_date date) TO authenticated;
GRANT ALL ON FUNCTION public.add_group_members(p_group_id uuid, p_student_ids uuid[], p_from_date date) TO service_role;

--
-- Name: FUNCTION assert_calendar_feed_allowed(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assert_calendar_feed_allowed() FROM PUBLIC;
GRANT ALL ON FUNCTION public.assert_calendar_feed_allowed() TO service_role;

--
-- Name: FUNCTION block_non_coordinator_cancel(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.block_non_coordinator_cancel() TO anon;
GRANT ALL ON FUNCTION public.block_non_coordinator_cancel() TO authenticated;
GRANT ALL ON FUNCTION public.block_non_coordinator_cancel() TO service_role;

--
-- Name: FUNCTION cascade_lesson_category_rename(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cascade_lesson_category_rename() TO anon;
GRANT ALL ON FUNCTION public.cascade_lesson_category_rename() TO authenticated;
GRANT ALL ON FUNCTION public.cascade_lesson_category_rename() TO service_role;

--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

--
-- Name: FUNCTION complete_profile_setup(p_role text, p_full_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_profile_setup(p_role text, p_full_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_profile_setup(p_role text, p_full_name text) TO authenticated;
GRANT ALL ON FUNCTION public.complete_profile_setup(p_role text, p_full_name text) TO service_role;

--
-- Name: FUNCTION create_break(p_title text, p_start_date date, p_end_date date, p_student_ids uuid[], p_dry_run boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_break(p_title text, p_start_date date, p_end_date date, p_student_ids uuid[], p_dry_run boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_break(p_title text, p_start_date date, p_end_date date, p_student_ids uuid[], p_dry_run boolean) TO authenticated;
GRANT ALL ON FUNCTION public.create_break(p_title text, p_start_date date, p_end_date date, p_student_ids uuid[], p_dry_run boolean) TO service_role;

--
-- Name: FUNCTION create_group(p_name text, p_teacher_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_start_date date, p_end_date date, p_student_ids uuid[], p_counts_toward_lessons boolean, p_instrument_id uuid, p_location_id uuid, p_max_students integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_group(p_name text, p_teacher_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_start_date date, p_end_date date, p_student_ids uuid[], p_counts_toward_lessons boolean, p_instrument_id uuid, p_location_id uuid, p_max_students integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_group(p_name text, p_teacher_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_start_date date, p_end_date date, p_student_ids uuid[], p_counts_toward_lessons boolean, p_instrument_id uuid, p_location_id uuid, p_max_students integer) TO authenticated;
GRANT ALL ON FUNCTION public.create_group(p_name text, p_teacher_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_start_date date, p_end_date date, p_student_ids uuid[], p_counts_toward_lessons boolean, p_instrument_id uuid, p_location_id uuid, p_max_students integer) TO service_role;

--
-- Name: FUNCTION custom_access_token_hook(event jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.custom_access_token_hook(event jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.custom_access_token_hook(event jsonb) TO service_role;
GRANT ALL ON FUNCTION public.custom_access_token_hook(event jsonb) TO supabase_auth_admin;

--
-- Name: FUNCTION dashboard_summary(p_today date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_summary(p_today date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_summary(p_today date) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_summary(p_today date) TO service_role;

--
-- Name: FUNCTION decide_absence_request(p_request_id uuid, p_approve boolean, p_charged boolean, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.decide_absence_request(p_request_id uuid, p_approve boolean, p_charged boolean, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decide_absence_request(p_request_id uuid, p_approve boolean, p_charged boolean, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.decide_absence_request(p_request_id uuid, p_approve boolean, p_charged boolean, p_note text) TO service_role;

--
-- Name: FUNCTION delete_enrolment(p_enrolment_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_enrolment(p_enrolment_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_enrolment(p_enrolment_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_enrolment(p_enrolment_id uuid) TO service_role;

--
-- Name: FUNCTION end_group(p_group_id uuid, p_from_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.end_group(p_group_id uuid, p_from_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.end_group(p_group_id uuid, p_from_date date) TO authenticated;
GRANT ALL ON FUNCTION public.end_group(p_group_id uuid, p_from_date date) TO service_role;

--
-- Name: FUNCTION enrol_student(p_student_id uuid, p_teacher_id uuid, p_payment_plan public.payment_plan, p_start_date date, p_end_date date, p_total_lessons integer, p_rate_per_lesson numeric, p_total_fee numeric, p_registration_fee numeric, p_lesson_rate_id uuid, p_academic_year text, p_discount_primary text, p_discount_multilesson boolean, p_discount_value numeric, p_template_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_instrument_id uuid, p_title text, p_location_id uuid, p_extra_slots jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enrol_student(p_student_id uuid, p_teacher_id uuid, p_payment_plan public.payment_plan, p_start_date date, p_end_date date, p_total_lessons integer, p_rate_per_lesson numeric, p_total_fee numeric, p_registration_fee numeric, p_lesson_rate_id uuid, p_academic_year text, p_discount_primary text, p_discount_multilesson boolean, p_discount_value numeric, p_template_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_instrument_id uuid, p_title text, p_location_id uuid, p_extra_slots jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enrol_student(p_student_id uuid, p_teacher_id uuid, p_payment_plan public.payment_plan, p_start_date date, p_end_date date, p_total_lessons integer, p_rate_per_lesson numeric, p_total_fee numeric, p_registration_fee numeric, p_lesson_rate_id uuid, p_academic_year text, p_discount_primary text, p_discount_multilesson boolean, p_discount_value numeric, p_template_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_instrument_id uuid, p_title text, p_location_id uuid, p_extra_slots jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.enrol_student(p_student_id uuid, p_teacher_id uuid, p_payment_plan public.payment_plan, p_start_date date, p_end_date date, p_total_lessons integer, p_rate_per_lesson numeric, p_total_fee numeric, p_registration_fee numeric, p_lesson_rate_id uuid, p_academic_year text, p_discount_primary text, p_discount_multilesson boolean, p_discount_value numeric, p_template_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_instrument_id uuid, p_title text, p_location_id uuid, p_extra_slots jsonb) TO service_role;

--
-- Name: FUNCTION extend_group_schedule(p_group_id uuid, p_end_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.extend_group_schedule(p_group_id uuid, p_end_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.extend_group_schedule(p_group_id uuid, p_end_date date) TO authenticated;
GRANT ALL ON FUNCTION public.extend_group_schedule(p_group_id uuid, p_end_date date) TO service_role;

--
-- Name: FUNCTION fn_check_teacher_double_booking(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_check_teacher_double_booking() TO anon;
GRANT ALL ON FUNCTION public.fn_check_teacher_double_booking() TO authenticated;
GRANT ALL ON FUNCTION public.fn_check_teacher_double_booking() TO service_role;

--
-- Name: FUNCTION fn_enrolments_forget_deleted_slot(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fn_enrolments_forget_deleted_slot() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_enrolments_forget_deleted_slot() TO service_role;

--
-- Name: FUNCTION fn_increment_lessons_used(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_increment_lessons_used() TO anon;
GRANT ALL ON FUNCTION public.fn_increment_lessons_used() TO authenticated;
GRANT ALL ON FUNCTION public.fn_increment_lessons_used() TO service_role;

--
-- Name: FUNCTION fn_lesson_students_recompute_used(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_lesson_students_recompute_used() TO anon;
GRANT ALL ON FUNCTION public.fn_lesson_students_recompute_used() TO authenticated;
GRANT ALL ON FUNCTION public.fn_lesson_students_recompute_used() TO service_role;

--
-- Name: FUNCTION fn_lessons_recompute_used(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_lessons_recompute_used() TO anon;
GRANT ALL ON FUNCTION public.fn_lessons_recompute_used() TO authenticated;
GRANT ALL ON FUNCTION public.fn_lessons_recompute_used() TO service_role;

--
-- Name: FUNCTION fn_profiles_link_students_on_approval(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fn_profiles_link_students_on_approval() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_profiles_link_students_on_approval() TO service_role;

--
-- Name: FUNCTION fn_recompute_lessons_used(p_student_id uuid, p_acad_year text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fn_recompute_lessons_used(p_student_id uuid, p_acad_year text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_recompute_lessons_used(p_student_id uuid, p_acad_year text) TO service_role;

--
-- Name: FUNCTION fn_students_link_login_by_email(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fn_students_link_login_by_email() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_students_link_login_by_email() TO service_role;

--
-- Name: FUNCTION generate_instalments(p_enrolment_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.generate_instalments(p_enrolment_id uuid) TO anon;
GRANT ALL ON FUNCTION public.generate_instalments(p_enrolment_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.generate_instalments(p_enrolment_id uuid) TO service_role;

--
-- Name: FUNCTION get_calendar_token(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_calendar_token() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_calendar_token() TO authenticated;
GRANT ALL ON FUNCTION public.get_calendar_token() TO service_role;

--
-- Name: FUNCTION get_student_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_student_id() TO anon;
GRANT ALL ON FUNCTION public.get_student_id() TO authenticated;
GRANT ALL ON FUNCTION public.get_student_id() TO service_role;

--
-- Name: FUNCTION get_student_lesson_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_student_lesson_ids() TO anon;
GRANT ALL ON FUNCTION public.get_student_lesson_ids() TO authenticated;
GRANT ALL ON FUNCTION public.get_student_lesson_ids() TO service_role;

--
-- Name: FUNCTION get_user_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_user_role() TO anon;
GRANT ALL ON FUNCTION public.get_user_role() TO authenticated;
GRANT ALL ON FUNCTION public.get_user_role() TO service_role;

--
-- Name: FUNCTION guard_lesson_students_update(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_lesson_students_update() TO anon;
GRANT ALL ON FUNCTION public.guard_lesson_students_update() TO authenticated;
GRANT ALL ON FUNCTION public.guard_lesson_students_update() TO service_role;

--
-- Name: FUNCTION guard_profile_privileged_columns(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_profile_privileged_columns() TO anon;
GRANT ALL ON FUNCTION public.guard_profile_privileged_columns() TO authenticated;
GRANT ALL ON FUNCTION public.guard_profile_privileged_columns() TO service_role;

--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

--
-- Name: FUNCTION is_approved_teacher(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_approved_teacher() TO anon;
GRANT ALL ON FUNCTION public.is_approved_teacher() TO authenticated;
GRANT ALL ON FUNCTION public.is_approved_teacher() TO service_role;

--
-- Name: FUNCTION jwt_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.jwt_role() TO anon;
GRANT ALL ON FUNCTION public.jwt_role() TO authenticated;
GRANT ALL ON FUNCTION public.jwt_role() TO service_role;

--
-- Name: FUNCTION link_or_create_student(p_user_id uuid, p_email text, p_full_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.link_or_create_student(p_user_id uuid, p_email text, p_full_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.link_or_create_student(p_user_id uuid, p_email text, p_full_name text) TO service_role;

--
-- Name: FUNCTION log_payment_marked_paid(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_payment_marked_paid() FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_payment_marked_paid() TO service_role;

--
-- Name: FUNCTION my_student_ids(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_student_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_student_ids() TO anon;
GRANT ALL ON FUNCTION public.my_student_ids() TO authenticated;
GRANT ALL ON FUNCTION public.my_student_ids() TO service_role;

--
-- Name: FUNCTION new_calendar_token(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.new_calendar_token() FROM PUBLIC;
GRANT ALL ON FUNCTION public.new_calendar_token() TO service_role;

--
-- Name: FUNCTION next_invoice_number(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.next_invoice_number() FROM PUBLIC;
GRANT ALL ON FUNCTION public.next_invoice_number() TO service_role;

--
-- Name: FUNCTION reassign_lessons(p_lesson_ids uuid[], p_new_teacher_id uuid, p_new_start_time time without time zone, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reassign_lessons(p_lesson_ids uuid[], p_new_teacher_id uuid, p_new_start_time time without time zone, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reassign_lessons(p_lesson_ids uuid[], p_new_teacher_id uuid, p_new_start_time time without time zone, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.reassign_lessons(p_lesson_ids uuid[], p_new_teacher_id uuid, p_new_start_time time without time zone, p_reason text) TO service_role;

--
-- Name: FUNCTION remove_group_member(p_group_id uuid, p_student_id uuid, p_from_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remove_group_member(p_group_id uuid, p_student_id uuid, p_from_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_group_member(p_group_id uuid, p_student_id uuid, p_from_date date) TO authenticated;
GRANT ALL ON FUNCTION public.remove_group_member(p_group_id uuid, p_student_id uuid, p_from_date date) TO service_role;

--
-- Name: FUNCTION renewal_candidates(p_from_year text, p_to_year text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.renewal_candidates(p_from_year text, p_to_year text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.renewal_candidates(p_from_year text, p_to_year text) TO authenticated;
GRANT ALL ON FUNCTION public.renewal_candidates(p_from_year text, p_to_year text) TO service_role;

--
-- Name: FUNCTION reports_summary(p_today date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reports_summary(p_today date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reports_summary(p_today date) TO authenticated;
GRANT ALL ON FUNCTION public.reports_summary(p_today date) TO service_role;

--
-- Name: FUNCTION request_absence(p_lesson_id uuid, p_reason text, p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_absence(p_lesson_id uuid, p_reason text, p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_absence(p_lesson_id uuid, p_reason text, p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.request_absence(p_lesson_id uuid, p_reason text, p_student_id uuid) TO service_role;

--
-- Name: FUNCTION reset_calendar_token(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reset_calendar_token() FROM PUBLIC;
GRANT ALL ON FUNCTION public.reset_calendar_token() TO authenticated;
GRANT ALL ON FUNCTION public.reset_calendar_token() TO service_role;

--
-- Name: FUNCTION resolve_pending_on_makeup(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resolve_pending_on_makeup() TO anon;
GRANT ALL ON FUNCTION public.resolve_pending_on_makeup() TO authenticated;
GRANT ALL ON FUNCTION public.resolve_pending_on_makeup() TO service_role;

--
-- Name: FUNCTION rollover_release_slot(p_student_id uuid, p_template_id uuid, p_to_year text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rollover_release_slot(p_student_id uuid, p_template_id uuid, p_to_year text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rollover_release_slot(p_student_id uuid, p_template_id uuid, p_to_year text) TO authenticated;
GRANT ALL ON FUNCTION public.rollover_release_slot(p_student_id uuid, p_template_id uuid, p_to_year text) TO service_role;

--
-- Name: FUNCTION schedule_group_session(p_title text, p_teacher_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_student_ids uuid[], p_counts_toward_lessons boolean, p_group_id uuid, p_instrument_id uuid, p_location_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.schedule_group_session(p_title text, p_teacher_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_student_ids uuid[], p_counts_toward_lessons boolean, p_group_id uuid, p_instrument_id uuid, p_location_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.schedule_group_session(p_title text, p_teacher_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_student_ids uuid[], p_counts_toward_lessons boolean, p_group_id uuid, p_instrument_id uuid, p_location_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.schedule_group_session(p_title text, p_teacher_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_student_ids uuid[], p_counts_toward_lessons boolean, p_group_id uuid, p_instrument_id uuid, p_location_id uuid) TO service_role;

--
-- Name: FUNCTION set_student_login(p_student_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_student_login(p_student_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_student_login(p_student_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.set_student_login(p_student_id uuid, p_user_id uuid) TO service_role;

--
-- Name: FUNCTION teaches_lesson(p_lesson_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teaches_lesson(p_lesson_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teaches_lesson(p_lesson_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.teaches_lesson(p_lesson_id uuid) TO service_role;

--
-- Name: FUNCTION teaches_student(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teaches_student(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teaches_student(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.teaches_student(p_student_id uuid) TO service_role;

--
-- Name: FUNCTION undo_payment(p_payment_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.undo_payment(p_payment_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.undo_payment(p_payment_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.undo_payment(p_payment_id uuid) TO service_role;

--
-- Name: FUNCTION update_group(p_group_id uuid, p_name text, p_counts_toward_lessons boolean, p_max_students integer, p_location_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_group(p_group_id uuid, p_name text, p_counts_toward_lessons boolean, p_max_students integer, p_location_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_group(p_group_id uuid, p_name text, p_counts_toward_lessons boolean, p_max_students integer, p_location_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.update_group(p_group_id uuid, p_name text, p_counts_toward_lessons boolean, p_max_students integer, p_location_id uuid) TO service_role;

--
-- Name: FUNCTION update_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;

--
-- Name: FUNCTION withdraw_absence_request(p_request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.withdraw_absence_request(p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.withdraw_absence_request(p_request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.withdraw_absence_request(p_request_id uuid) TO service_role;

--
-- Name: TABLE absence_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.absence_requests TO authenticated;
GRANT ALL ON TABLE public.absence_requests TO service_role;

--
-- Name: TABLE calendar_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.calendar_tokens TO service_role;
GRANT SELECT ON TABLE public.calendar_tokens TO authenticated;

--
-- Name: TABLE curriculum_resource_tags; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.curriculum_resource_tags TO anon;
GRANT ALL ON TABLE public.curriculum_resource_tags TO authenticated;
GRANT ALL ON TABLE public.curriculum_resource_tags TO service_role;

--
-- Name: TABLE curriculum_resources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.curriculum_resources TO anon;
GRANT ALL ON TABLE public.curriculum_resources TO authenticated;
GRANT ALL ON TABLE public.curriculum_resources TO service_role;

--
-- Name: TABLE curriculum_tags; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.curriculum_tags TO anon;
GRANT ALL ON TABLE public.curriculum_tags TO authenticated;
GRANT ALL ON TABLE public.curriculum_tags TO service_role;

--
-- Name: TABLE instruments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.instruments TO anon;
GRANT ALL ON TABLE public.instruments TO authenticated;
GRANT ALL ON TABLE public.instruments TO service_role;

--
-- Name: TABLE invoice_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_counters TO anon;
GRANT ALL ON TABLE public.invoice_counters TO authenticated;
GRANT ALL ON TABLE public.invoice_counters TO service_role;

--
-- Name: TABLE invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoices TO anon;
GRANT ALL ON TABLE public.invoices TO authenticated;
GRANT ALL ON TABLE public.invoices TO service_role;

--
-- Name: TABLE lesson_categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lesson_categories TO anon;
GRANT ALL ON TABLE public.lesson_categories TO authenticated;
GRANT ALL ON TABLE public.lesson_categories TO service_role;

--
-- Name: TABLE lesson_rates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lesson_rates TO anon;
GRANT ALL ON TABLE public.lesson_rates TO authenticated;
GRANT ALL ON TABLE public.lesson_rates TO service_role;

--
-- Name: TABLE lesson_students; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lesson_students TO anon;
GRANT ALL ON TABLE public.lesson_students TO authenticated;
GRANT ALL ON TABLE public.lesson_students TO service_role;

--
-- Name: TABLE lessons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lessons TO anon;
GRANT ALL ON TABLE public.lessons TO authenticated;
GRANT ALL ON TABLE public.lessons TO service_role;

--
-- Name: TABLE locations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.locations TO anon;
GRANT ALL ON TABLE public.locations TO authenticated;
GRANT ALL ON TABLE public.locations TO service_role;

--
-- Name: TABLE media_uploads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.media_uploads TO anon;
GRANT ALL ON TABLE public.media_uploads TO authenticated;
GRANT ALL ON TABLE public.media_uploads TO service_role;

--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;

--
-- Name: TABLE payment_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_events TO service_role;
GRANT SELECT ON TABLE public.payment_events TO authenticated;

--
-- Name: TABLE payment_records; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_records TO anon;
GRANT ALL ON TABLE public.payment_records TO authenticated;
GRANT ALL ON TABLE public.payment_records TO service_role;

--
-- Name: TABLE scheduled_breaks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scheduled_breaks TO anon;
GRANT ALL ON TABLE public.scheduled_breaks TO authenticated;
GRANT ALL ON TABLE public.scheduled_breaks TO service_role;

--
-- Name: TABLE student_enrolments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_enrolments TO anon;
GRANT ALL ON TABLE public.student_enrolments TO authenticated;
GRANT ALL ON TABLE public.student_enrolments TO service_role;

--
-- Name: TABLE student_instruments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_instruments TO anon;
GRANT ALL ON TABLE public.student_instruments TO authenticated;
GRANT ALL ON TABLE public.student_instruments TO service_role;

--
-- Name: TABLE student_pieces; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_pieces TO anon;
GRANT ALL ON TABLE public.student_pieces TO authenticated;
GRANT ALL ON TABLE public.student_pieces TO service_role;

--
-- Name: TABLE students; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.students TO anon;
GRANT ALL ON TABLE public.students TO authenticated;
GRANT ALL ON TABLE public.students TO service_role;

--
-- Name: TABLE student_stats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_stats TO anon;
GRANT ALL ON TABLE public.student_stats TO authenticated;
GRANT ALL ON TABLE public.student_stats TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

--
-- PostgreSQL database dump complete
--

SET search_path = public, extensions;

-- ── Exact permissions ─────────────────────────────────────────────────────────
-- Supabase auto-grants new functions/tables to anon/authenticated. Internal and
-- coordinator-only functions must NOT be callable by everyone, so the exact
-- permissions from the verified database are re-applied here.
REVOKE EXECUTE ON FUNCTION public._approved_login_for_email(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._generate_group_sessions(uuid,date,date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._lesson_when_label(date,time without time zone) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._require_group(uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_group_members(uuid,uuid[],date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assert_calendar_feed_allowed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_profile_setup(text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_break(text,date,date,uuid[],boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_group(text,uuid,integer,time without time zone,time without time zone,date,date,uuid[],boolean,uuid,uuid,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dashboard_summary(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decide_absence_request(uuid,boolean,boolean,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_enrolment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_group(uuid,date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enrol_student(uuid,uuid,payment_plan,date,date,integer,numeric,numeric,numeric,uuid,text,text,boolean,numeric,uuid,integer,time without time zone,time without time zone,uuid,text,uuid,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.extend_group_schedule(uuid,date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_enrolments_forget_deleted_slot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_profiles_link_students_on_approval() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_recompute_lessons_used(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_students_link_login_by_email() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_calendar_token() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.link_or_create_student(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_payment_marked_paid() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_student_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.new_calendar_token() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reassign_lessons(uuid[],uuid,time without time zone,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_group_member(uuid,uuid,date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.renewal_candidates(text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reports_summary(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_absence(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reset_calendar_token() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rollover_release_slot(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.schedule_group_session(text,uuid,date,time without time zone,time without time zone,uuid[],boolean,uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_student_login(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.teaches_lesson(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.teaches_student(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.undo_payment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_group(uuid,text,boolean,integer,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.withdraw_absence_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.absence_requests FROM anon, authenticated; GRANT REFERENCES, SELECT, TRIGGER ON TABLE public.absence_requests TO authenticated;
REVOKE ALL ON TABLE public.calendar_tokens FROM anon, authenticated; GRANT SELECT ON TABLE public.calendar_tokens TO authenticated;
REVOKE ALL ON TABLE public.payment_events FROM anon, authenticated; GRANT SELECT ON TABLE public.payment_events TO authenticated;

-- ── Part 2: sign-up trigger (creates a profile for every new auth user) ──────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Part 3: storage buckets (private) and their access rules ─────────────────
INSERT INTO storage.buckets (id, name, public) VALUES
  ('invoices', 'invoices', false),
  ('lesson-media', 'lesson-media', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Coordinators delete invoice files" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'invoices'::text) AND (get_user_role() = 'coordinator'::user_role)));
CREATE POLICY "Coordinators manage invoice files" ON storage.objects AS PERMISSIVE FOR ALL TO public USING (((bucket_id = 'invoices'::text) AND (get_user_role() = 'coordinator'::user_role))) WITH CHECK (((bucket_id = 'invoices'::text) AND (get_user_role() = 'coordinator'::user_role)));
CREATE POLICY "Service role manages invoice files" ON storage.objects AS PERMISSIVE FOR ALL TO public USING (((bucket_id = 'invoices'::text) AND (auth.role() = 'service_role'::text))) WITH CHECK (((bucket_id = 'invoices'::text) AND (auth.role() = 'service_role'::text)));
CREATE POLICY "Students read own invoice files" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'invoices'::text) AND (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.pdf_path = objects.name) AND (i.student_id IN ( SELECT my_student_ids() AS my_student_ids)))))));
CREATE POLICY "Students read own lesson media files" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'lesson-media'::text) AND (EXISTS ( SELECT 1
   FROM media_uploads m
  WHERE ((m.supabase_path = objects.name) AND (m.lesson_id IN ( SELECT get_student_lesson_ids() AS get_student_lesson_ids)))))));
CREATE POLICY "Teachers delete own media" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'lesson-media'::text) AND ((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = 'coordinator'::user_role) OR (owner = auth.uid()))));
CREATE POLICY "Teachers update own media" ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (((bucket_id = 'lesson-media'::text) AND ((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = 'coordinator'::user_role) OR (owner = auth.uid()))));
CREATE POLICY "Teachers upload media" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'lesson-media'::text) AND (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['teacher'::user_role, 'coordinator'::user_role])) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "Teachers view own media" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'lesson-media'::text) AND ((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = 'coordinator'::user_role) OR (owner = auth.uid()))));

-- ── Part 4: realtime (live notifications, teacher schedule refresh) ──────────
DO $rt$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['notifications', 'lessons'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END
$rt$;

-- ── Part 5: starter reference data ──────────────────────────────────────────
INSERT INTO public.instruments VALUES ('649cb33d-843f-458c-a7a6-321416c6ff1f', 'Piano', '🎹', '2026-11-03 18:41:28.344003+00') ON CONFLICT DO NOTHING;
INSERT INTO public.instruments VALUES ('46aca164-de3e-45c8-a33b-e98b5736b8dd', 'Violin', '🎻', '2026-11-03 18:41:28.344003+00') ON CONFLICT DO NOTHING;
INSERT INTO public.instruments VALUES ('fcc6fec1-2cff-4552-853a-e33c17c58c27', 'Guitar', '🎸', '2026-11-03 18:41:28.344003+00') ON CONFLICT DO NOTHING;
INSERT INTO public.instruments VALUES ('ff706aab-e637-4a81-8b0e-c012e9226cb2', 'Cello', '🎻', '2026-11-03 18:41:28.344003+00') ON CONFLICT DO NOTHING;
INSERT INTO public.instruments VALUES ('343ea0fb-97fb-4b9c-9509-9ed48c6c86f3', 'Voice', '🎤', '2026-11-03 18:41:28.344003+00') ON CONFLICT DO NOTHING;
INSERT INTO public.instruments VALUES ('3abf530c-2ab1-4fed-ad75-b34da8a5b48f', 'Viola', NULL, '2026-11-03 18:41:28.507175+00') ON CONFLICT DO NOTHING;
INSERT INTO public.instruments VALUES ('68feb754-d830-48c1-8e46-a7922db67c4e', 'IGCSE Music', NULL, '2026-11-03 18:41:28.971997+00') ON CONFLICT DO NOTHING;
INSERT INTO public.instruments VALUES ('200b9373-0c8c-4422-a3cf-0e990c9bae4b', 'Music Theory', NULL, '2026-11-03 18:41:28.971997+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_categories VALUES ('f377a218-ffa2-48a4-b8fc-d3311f3358f8', '1:1 Instrumental', 1, '2026-11-03 18:41:28.846562+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_categories VALUES ('c3822c4b-f5cd-4b7b-b972-0be3c86d201b', '1:1 Theory', 2, '2026-11-03 18:41:28.846562+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_categories VALUES ('6f1c1997-e745-4a62-b86e-cff81e94adf5', '1:1 Vocals', 3, '2026-11-03 18:41:28.846562+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_categories VALUES ('9ad55ce0-2d56-4a2b-a1e9-53e2dd620adf', 'IGCSE Music', 4, '2026-11-03 18:41:28.846562+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_categories VALUES ('00b72f6b-b691-4c37-8f50-5b36095385e2', 'Music Theory', 5, '2026-11-03 18:41:28.846562+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_categories VALUES ('31b34b2e-68f3-4f4f-9f49-d46fb13755b0', 'Group: Strings', 6, '2026-11-03 18:41:28.846562+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_categories VALUES ('87c83af7-a73f-420f-9127-55c2a87b0ea4', 'Group: Guitar', 7, '2026-11-03 18:41:28.846562+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_categories VALUES ('0dbc6c85-0ab0-42e9-ac1e-b8046ea37992', 'Group: Vocals', 8, '2026-11-03 18:41:28.846562+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_categories VALUES ('7997ffb3-4d12-4562-91fe-38bd0caaa279', 'Group: Theory', 9, '2026-11-03 18:41:28.846562+00') ON CONFLICT DO NOTHING;
INSERT INTO public.locations VALUES ('af60961f-6aec-4809-ab4d-2dfeb66cd7b4', 'Online', 'Online', '', '', '2026-11-03 18:41:29.106522+00') ON CONFLICT DO NOTHING;
INSERT INTO public.locations VALUES ('039c63da-ca26-4350-8ddb-991fdf5d3cae', 'Student''s Home', '', '', '', '2026-11-03 18:41:29.193999+00') ON CONFLICT DO NOTHING;
INSERT INTO public.locations VALUES ('a62fb639-c41b-437b-b78d-5e87339846ab', 'Links', '', '', '', '2026-11-03 18:41:29.193999+00') ON CONFLICT DO NOTHING;
INSERT INTO public.locations VALUES ('4bf46cea-20b1-4d0e-9943-31014c043375', 'Edvin', '', '', '', '2026-11-03 18:41:29.193999+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('bc542ae4-19fe-42ff-a8c5-2ddc95bc7964', NULL, NULL, 'demo', 1000.00, false, '2025', '2026-11-03 18:41:28.506417+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('9d5cae03-cd50-4175-979b-6460c45d7689', NULL, NULL, '1:1 Instrumental', 1500.00, false, '2025', '2026-11-03 18:41:28.506528+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('cf9e0468-61f5-4580-944e-0233dc156511', NULL, NULL, '1:1 Instrumental', 1350.00, true, '2025', '2026-11-03 18:41:28.506627+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('f697320d-8f99-4140-96a6-30e7b85a523b', NULL, NULL, '1:1 Theory', 1155.00, true, '2025', '2026-11-03 18:41:28.505854+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('93d56449-719e-4612-8a92-bffabceed519', NULL, NULL, '1:1 Theory', 1350.00, false, '2025', '2026-11-03 18:41:28.506044+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('847d1381-40fb-4e41-87b6-3a32094f341e', NULL, NULL, '1:1 Vocals', 1850.00, false, '2025', '2026-11-03 18:41:28.506193+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('06a31a3f-8276-42ba-97c9-3970ebe20917', NULL, NULL, '1:1 Vocals', 1650.00, true, '2025', '2026-11-03 18:41:28.506303+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('0081e1cc-f670-4ba6-ab6e-6f44edc2e01a', NULL, NULL, 'Group: Strings', 1200.00, false, '2025', '2026-11-03 18:41:28.504536+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('c42c0c67-86fc-4f92-9d8a-f09e464de49a', NULL, NULL, 'Group: Guitar', 1000.00, false, '2025', '2026-11-03 18:41:28.505195+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('d30753bc-c14f-4ff0-a86c-ce06429cd1c5', NULL, NULL, 'Group: Vocals', 1000.00, false, '2025', '2026-11-03 18:41:28.505427+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('d6792101-aafe-43ab-a7de-979c0c103aee', NULL, NULL, 'Group: Theory', 700.00, false, '2025', '2026-11-03 18:41:28.505591+00') ON CONFLICT DO NOTHING;
INSERT INTO public.lesson_rates VALUES ('006c8cb1-f40a-4638-bfe8-132860909bfc', NULL, NULL, 'Group: Theory', 750.00, true, '2025', '2026-11-03 18:41:28.505723+00') ON CONFLICT DO NOTHING;

-- ── Part 6: first coordinator ───────────────────────────────────────────────
-- 1. Supabase → Authentication → Users → Add user (email + strong password,
--    "Auto confirm"). The sign-up trigger creates their profile.
-- 2. Make that account the coordinator (replace the email):
--      UPDATE public.profiles SET role = 'coordinator', approved = true,
--             full_name = COALESCE(NULLIF(full_name, ''), 'Coordinator')
--      WHERE email = 'you@example.com';
-- 3. (Optional) Authentication → Hooks → Custom Access Token →
--    public.custom_access_token_hook. Not required.

NOTIFY pgrst, 'reload schema';
