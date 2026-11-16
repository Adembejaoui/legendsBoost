-- Supabase Realtime authorization for private Broadcast channels.
--
-- Not part of the Prisma data model: this only configures who may *receive*
-- events on private Realtime topics. Prisma remains the ORM for all data.
--
-- Model:
--   1. The browser asks POST /api/realtime/auth for a token for one topic,
--      e.g. "private-order:<orderId>".
--   2. The server validates the Auth.js session and authorizes the topic
--      against Prisma (order customer, active assigned booster, or admin; see
--      lib/realtime/authorization.ts), then signs a short-lived JWT whose
--      "channel" claim is exactly that topic.
--   3. This policy lets an authenticated client read Broadcast messages only
--      on the topic its token was minted for. Any other topic is denied.
--
-- There is intentionally no INSERT policy: browsers cannot publish on private
-- topics. Only the server (service role, which bypasses RLS) broadcasts, and
-- it does so only after the database write has committed.
--
-- Guarded so it is a no-op where the Supabase "realtime" schema does not exist
-- (e.g. Prisma's shadow database during `prisma migrate dev`).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'realtime' AND table_name = 'messages'
  ) THEN
    -- Supabase ships realtime.messages with RLS already enabled, and the table
    -- is owned by supabase_realtime_admin, so the migration role ("postgres")
    -- may not ALTER it (42501 "must be owner"). Only enable RLS where it is
    -- off (e.g. a non-Supabase database with a compatible schema).
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'realtime' AND c.relname = 'messages' AND c.relrowsecurity
    ) THEN
      EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
    END IF;

    EXECUTE 'DROP POLICY IF EXISTS "legendsboost_private_topic_read" ON realtime.messages';

    EXECUTE $policy$
      CREATE POLICY "legendsboost_private_topic_read"
      ON realtime.messages
      FOR SELECT
      TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND (SELECT realtime.topic()) LIKE 'private-%'
        AND (SELECT realtime.topic()) = (SELECT auth.jwt() ->> 'channel')
      )
    $policy$;
  END IF;
END
$$;
