-- ============================================================================
-- Troika Music Lessons — RESET the app database (DESTRUCTIVE)
--
-- Permanently deletes EVERYTHING the app stored in this Supabase project:
-- all students, teachers' data, lessons, enrolments, payments, invoices
-- records, notifications… plus the app's tables, functions, types and
-- security rules. Use it only to start over, then immediately run
-- supabase/schema.sql to install the app fresh.
--
-- Take a backup first (Database → Backups) if there is anything you might
-- want later. Run in Supabase → SQL Editor. It runs in one transaction:
-- either everything is removed or nothing is.
--
-- It does NOT touch Supabase's own schemas (auth, storage, realtime,
-- extensions) except: the app's sign-up trigger on auth.users and the app's
-- storage access rules. User accounts are kept unless you un-comment the
-- last step. Stored files (invoice PDFs, lesson media) are not deleted by SQL
-- — empty the `invoices` and `lesson-media` buckets in Storage if you want
-- them gone (optional; the fresh install reuses the buckets).
-- ============================================================================

BEGIN;

-- 1. The app's sign-up trigger on auth.users.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 2. The app's storage access rules (all policies on storage.objects that
--    mention the app's buckets).
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (COALESCE(qual, '') || COALESCE(with_check, '')) ~ '(invoices|lesson-media|curriculum)'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p.policyname);
  END LOOP;
END $$;

-- 3. Everything the app created in the public schema (tables with their data,
--    views, sequences, functions, types). Objects that belong to extensions
--    are left alone. The public schema itself and Supabase's default
--    permissions on it are kept.
DO $$
DECLARE r RECORD;
BEGIN
  -- views
  FOR r IN SELECT c.oid::regclass AS obj FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS %s CASCADE', r.obj);
  END LOOP;
  -- tables (and their data, indexes, triggers, policies)
  FOR r IN SELECT c.oid::regclass AS obj FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %s CASCADE', r.obj);
  END LOOP;
  -- leftover sequences
  FOR r IN SELECT c.oid::regclass AS obj FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'S'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS %s CASCADE', r.obj);
  END LOOP;
  -- functions
  FOR r IN SELECT p.oid::regprocedure AS obj, p.prokind FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    IF r.prokind = 'p' THEN
      EXECUTE format('DROP PROCEDURE IF EXISTS %s CASCADE', r.obj);
    ELSE
      EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.obj);
    END IF;
  END LOOP;
  -- types (enums etc.)
  FOR r IN SELECT t.oid::regtype AS obj FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'c')
             AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid AND c.relkind <> 'c')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS %s CASCADE', r.obj);
  END LOOP;
END $$;

-- 4. OPTIONAL — also delete every user account (everyone signs up again).
--    Recommended for a true fresh start. Remove the two dashes to enable:
-- DELETE FROM auth.users;

COMMIT;

-- Next: run supabase/schema.sql.
