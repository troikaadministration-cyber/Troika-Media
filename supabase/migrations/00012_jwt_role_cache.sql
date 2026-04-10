-- Migration 00012: Cache user role + approved in JWT to eliminate per-row DB lookups in RLS policies
--
-- HOW TO ACTIVATE (one-time manual step in Supabase Dashboard):
--   Authentication > Hooks > Custom Access Token Hook
--   Set function to: public.custom_access_token_hook
--
-- Until the hook is enabled, both functions fall back to the DB query so nothing breaks.

-- 1. Hook function: runs at login/token-refresh, embeds role + approved into JWT claims
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

-- Grant only to supabase_auth_admin (required for auth hooks)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- 2. Update get_user_role() — reads JWT first (free), falls back to DB on cache miss
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'user_role')::user_role,
    (SELECT role FROM profiles WHERE id = auth.uid())
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 3. Update is_approved_teacher() — same pattern
CREATE OR REPLACE FUNCTION is_approved_teacher()
RETURNS boolean AS $$
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
$$ LANGUAGE sql SECURITY DEFINER STABLE;
