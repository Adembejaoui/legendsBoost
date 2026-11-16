# Order Chat Realtime Fix (2026-11-12)

## Root causes
1. `components/chat/OrderChat.tsx` never subscribed to Realtime. The client code was removed during the Socket.IO → Supabase migration and never replaced. The "Live" badge was hard-coded.
2. `lib/supabase/server.ts` read `SUPABASE_URL`, which is not set (only `NEXT_PUBLIC_SUPABASE_URL` is), so `getSupabaseAdmin()` returned `null` and every server broadcast was skipped.
3. The server broadcast to *public* topics (no `private: true`), so private subscribers could never receive events, and anyone with the anon key could listen on `private-order:<id>`.
4. `realtime.messages` had RLS enabled with **no policies**, so every private-channel join was denied.
5. `httpSend` rejects on failure, but `broadcast.ts` expected a result object. A broadcast failure after commit returned HTTP 500, the client retried, and the message was duplicated. The NEW_MESSAGE notification step had the same problem.

## Design
- **Prisma** handles all reads and writes. **Supabase Broadcast** is used only for delivery. Postgres Changes was not used: it would need the publication plus duplicating the order authorization rules in SQL RLS on the Prisma tables.
- Send: `POST /api/orders/:id/messages` → authorize (Prisma) → persist → REST broadcast `chat.message.created` to private topic `private-order:{id}` (service role, server-only). The broadcast is best-effort and never throws.
- Subscribe: the browser asks `/api/realtime/auth` for a token. The server checks the Auth.js session and order access (customer / active booster / admin), then signs a 15-minute JWT whose `channel` claim is that one topic. RLS policy `legendsboost_private_topic_read` allows reads only when `realtime.topic() = jwt.channel`. There is no INSERT policy, so browsers cannot publish.
- Sync (`lib/chat/realtime-sync.ts`): one socket and one channel per open chat. Every `SUBSCRIBED` (first join and every rejoin) runs a catch-up fetch `GET ?after=<newest shown>` (inclusive, deduped by id). This closes the gap between page load and subscribe and recovers messages missed while offline. The token is re-requested every ~4 min, so access is re-authorized against the DB. A 401/403 ends the subscription.
- Optimistic UI: each send carries a `clientMessageId`, which is echoed in the broadcast and the POST response (not persisted). Whichever arrives first replaces the pending bubble. Failed sends show Retry / Discard.

## Deployment checklist
1. Reconcile migration history, then deploy. Run these in this order against production (rehearsed on a production-shaped copy on 2026-11-12):
   1. `npx prisma migrate resolve --rolled-back 20261112000000_realtime_private_channel_policies`
      The first attempt failed on `ALTER TABLE realtime.messages` (42501, not owner) before changing anything. Production still had zero policies, so it really is rolled back.
   2. `npx prisma migrate resolve --applied 20261111000000_baseline_chat_support_notification_tables`
      This records the chat, support and notification tables that already exist in production. It does **not** run the file. Never `deploy` this migration to production unresolved: its `CREATE TYPE` would fail because the types already exist.
   3. `npx prisma migrate deploy`
      Applies the realtime policy and `20261112100000_message_sender_set_null_and_notification_order_fk`.
   4. `npx prisma migrate status` should print "Database schema is up to date!"

   Undo the policy: `DROP POLICY "legendsboost_private_topic_read" ON realtime.messages;`
   Never run `prisma migrate dev` with `DIRECT_URL` pointing at production. Use a separate development database.
2. Vercel env (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser, inlined at build time, so redeploy after changing them)
   - `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (server-only)
3. Supabase Dashboard → Realtime → Settings: turn off **"Allow public access"** so only private channels are allowed. The app uses no public channels.
4. Verify: `node scripts/verify-realtime-chat.mjs` should report 5/5.

## Manual two-browser verification
1. Browser A: customer. Browser B (another profile): the assigned booster. Both open `/dashboard/<orderId>` → Chat tab. The header shows **Live**.
2. A sends a message. It appears in A at once ("Sending…", then a timestamp) and in B without a refresh. Repeat from B to A.
3. Send 5 quick messages. Check that both sides show them once each, in the same order.
4. In B, turn on DevTools → Network → Offline. The header shows **Offline**. Send 2 messages from A. Go back online in B. The header returns to **Live** and both messages appear.
5. In A, go offline and send. The bubble shows **Not sent · Retry**. Go online and click Retry. The message is delivered once.
6. Scroll up in B and send from A. B keeps its scroll position and shows an "N new messages" pill.
7. Reassign or release the booster. Within ~4–5 min B's chat shows "You no longer have access". REST calls return 403 right away.
