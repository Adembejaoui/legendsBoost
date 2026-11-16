#!/usr/bin/env node
/**
 * End-to-end check of the Supabase Realtime path used by order chat, against
 * the project configured in .env. Uses a random throwaway topic
 * (private-order:verify-<random>) and touches no application data.
 *
 *   node scripts/verify-realtime-chat.mjs
 *
 * Checks:
 *   1. A token minted for topic T joins private channel T            (expect SUBSCRIBED)
 *   2. A server REST broadcast (service role, private) reaches it     (expect delivered)
 *   3. A token minted for another topic cannot join T                 (expect denied)
 *   4. The bare anon key (no user token) cannot join T                (expect denied)
 *   5. A *public* channel with the same name does not receive it      (expect nothing)
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY, and the
 * 20261112000000_realtime_private_channel_policies migration applied.
 */
import "dotenv/config";
import { RealtimeClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_JWT_SECRET;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SUPABASE_JWT_SECRET: secret, SUPABASE_SERVICE_ROLE_KEY: service })) {
  if (!v) {
    console.error(`Missing ${k}`);
    process.exit(2);
  }
}

const wsEndpoint = `${url.replace(/^http/, "ws")}/realtime/v1`;
const topic = `private-order:verify-${Math.random().toString(36).slice(2, 10)}`;
const results = [];
const record = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function mint(channel) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: "authenticated", aud: "authenticated", channel })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setSubject("verify-script-user")
    .sign(new TextEncoder().encode(secret));
}

function join({ token, isPrivate = true, onEvent }) {
  return new Promise((resolve) => {
    const client = new RealtimeClient(wsEndpoint, { params: { apikey: anon } });
    const ready = token ? client.setAuth(token) : Promise.resolve();
    ready.then(() => {
      const ch = client.channel(topic, { config: { private: isPrivate } });
      ch.on("broadcast", { event: "chat.message.created" }, (m) => onEvent?.(m.payload));
      let settled = false;
      const done = (status, err) => {
        if (settled) return;
        settled = true;
        resolve({ client, status, err: err?.message ?? "" });
      };
      ch.subscribe((status, err) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") done(status, err);
      });
      setTimeout(() => done("TIMEOUT"), 10_000);
    });
  });
}

async function serverBroadcast(payload) {
  const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: service, Authorization: `Bearer ${service}` },
    body: JSON.stringify({ messages: [{ topic, event: "chat.message.created", payload, private: true }] }),
  });
  return res.status;
}

const clients = [];
try {
  console.log(`Topic: ${topic}\n`);

  const received = [];
  const publicReceived = [];

  const good = await join({ token: await mint(topic), onEvent: (p) => received.push(p) });
  clients.push(good.client);
  record("1. authorized token joins private channel", good.status === "SUBSCRIBED", good.err || good.status);

  const pub = await join({ isPrivate: false, onEvent: (p) => publicReceived.push(p) });
  clients.push(pub.client);

  const status = await serverBroadcast({ messageId: "verify", orderId: topic.split(":")[1], content: "hello" });
  await new Promise((r) => setTimeout(r, 2_000));
  record(
    "2. server REST broadcast reaches the authorized subscriber",
    status === 202 && received.length === 1,
    `http=${status}, received=${received.length}`
  );

  const wrong = await join({ token: await mint("private-order:some-other-order") });
  clients.push(wrong.client);
  record("3. token for another order is denied", wrong.status !== "SUBSCRIBED", wrong.err || wrong.status);

  const anonOnly = await join({});
  clients.push(anonOnly.client);
  record("4. anon key without user token is denied", anonOnly.status !== "SUBSCRIBED", anonOnly.err || anonOnly.status);

  record(
    "5. public channel with the same name receives nothing",
    publicReceived.length === 0,
    `public join=${pub.status}, received=${publicReceived.length}`
  );
} finally {
  for (const c of clients) {
    try {
      await c.removeAllChannels();
      await c.disconnect();
    } catch {}
  }
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
