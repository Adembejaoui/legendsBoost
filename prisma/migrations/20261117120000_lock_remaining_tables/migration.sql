-- Production audit (2026-11-15): the last two tables without row-level
-- security were readable with the public Supabase key (PostgREST, role
-- "anon"). Enable RLS with no policy (as on every other table) and remove
-- the API roles' privileges. The app connects as the table owner, which RLS
-- does not restrict. No data change.

ALTER TABLE "verificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "verificationToken" FROM %I', r);
      IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON TABLE "_prisma_migrations" FROM %I', r);
      END IF;
    END IF;
  END LOOP;
END $$;
