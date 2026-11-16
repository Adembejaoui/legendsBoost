# Deploying to Vercel (hoodiz.net)

Decisions (2026-11-16): Vercel **Hobby** while testing, **Pro** before taking
real money; scheduled jobs on **cron-job.org** while on Hobby; Stripe in
**test mode** first; domain `hoodiz.net`.

> Vercel Hobby is for non-commercial use only. Switch to Pro before the first
> real (live-mode) payment. See "Going live" at the end.

Do the steps in order. Each one says where to click and what to paste.

---

## 1. Vercel project

1. vercel.com → **Add New… → Project** → import the GitHub repo `legendsBoost`.
2. Framework: **Next.js** (detected). Leave the build command and output as they are
   (`npm run build` runs `prisma generate && next build`).
3. Node.js version: **24.x** (read from `package.json`).
4. Before clicking **Deploy**, open **Environment Variables** and add the
   variables from step 2. (If it already deployed, add them, then
   **Deployments → ⋯ → Redeploy**.)

The function region is set in `vercel.json` to `dub1` (Dublin), next to the
Supabase database (eu-west-1). Do not change it: a far region makes every page slower.

## 2. Environment variables

Add them in **Settings → Environment Variables**, scope **Production** (and
**Preview** if you want preview deployments to work too).
"Copy from .env" means: the same value as in your local `.env` file.

| Variable | Value |
|---|---|
| `DATABASE_URL` | Copy from .env (Supabase pooler, port **6543**) |
| `DIRECT_URL` | Copy from .env (port 5432). Only used by migrations; harmless here |
| `AUTH_SECRET` | **New** value: run `openssl rand -base64 32` (or any 32+ random characters). Everyone signs in again once |
| `NEXTAUTH_URL` | `https://hoodiz.net` (**Production only**) |
| `APP_URL` | `https://hoodiz.net` (used in emails and Stripe return links) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Copy from .env (see step 4) |
| `NEXT_PUBLIC_SUPABASE_URL` | Copy from .env |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Copy from .env |
| `SUPABASE_JWT_SECRET` | Copy from .env |
| `SUPABASE_SERVICE_ROLE_KEY` | Copy from .env |
| `ACCOUNT_CREDENTIALS_KEY` | **Copy from .env, exactly.** It decrypts the game logins and payout details already stored in the database. A different value makes them unreadable |
| `STRIPE_SECRET_KEY` | Copy from .env (`sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | **New** `whsec_…` from step 5 (not the local one) |
| `STRIPE_LIVE_MODE_ENABLED` | Do not set (test mode) |
| `CRON_SECRET` | **New** random value (`openssl rand -hex 32`). Also used in step 6 |
| `RESEND_API_KEY` | Copy from .env |
| `EMAIL_FROM` | Copy from .env (`LegendsBoost <no-reply@hoodiz.net>`) |
| `RIOT_API_KEY` | Optional. With a development key, automatic Riot tracking stays **off** in production (Riot does not allow public products on a dev key); admins confirm completions by hand |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Optional, from sentry.io (free). Without it, production errors are only in Vercel logs |

Do **not** set `RIOT_ALLOW_DEV_KEY_LOCAL` or `DATABASE_POOL_MAX` on Vercel.

Variables starting with `NEXT_PUBLIC_` are built into the page: after
changing one, **redeploy**.

> **Same database as your computer.** Local development and hoodiz.net now
> share one Supabase database. Anything you do locally (test orders, wiping
> data) also changes the live site. Create a second Supabase project for
> local work when you can.

## 3. Domain

1. Vercel → project → **Settings → Domains** → add `hoodiz.net`, then add
   `www.hoodiz.net` and choose **Redirect to hoodiz.net**.
2. Vercel shows the DNS records to create. At your domain registrar (where
   you bought hoodiz.net), add exactly what Vercel shows. Usually:
   - `A` record, name `@`, value `76.76.21.21`
   - `CNAME` record, name `www`, value `cname.vercel-dns.com`
3. **Keep the Resend records** (TXT/MX, often on `send` or `resend._domainkey`).
   Do not switch the domain's nameservers to Vercel unless you re-add them,
   or emails stop working.
4. Wait until Vercel shows **Valid Configuration** (minutes to a few hours).
   HTTPS is automatic.

## 4. Google sign-in

console.cloud.google.com → **APIs & Services → Credentials** → your OAuth client:
- **Authorized JavaScript origins:** add `https://hoodiz.net`
- **Authorized redirect URIs:** add `https://hoodiz.net/api/auth/callback/google`

Keep the `localhost` entries for local development.

## 5. Stripe webhook (test mode)

dashboard.stripe.com → make sure **Test mode** is on → **Developers → Webhooks → Add endpoint**:
- URL: `https://hoodiz.net/api/webhooks/stripe`
- Events (select these 12):
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`,
  `payment_intent.payment_failed`, `charge.refunded`, `refund.created`,
  `refund.updated`, `refund.failed`, `charge.dispute.created`,
  `charge.dispute.updated`, `charge.dispute.closed`
- Copy the **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` on Vercel, then redeploy.

## 6. Scheduled jobs (cron-job.org, while on Hobby)

Vercel Hobby only runs crons once a day, so the jobs run from cron-job.org (free).
Create an account, then **Create cronjob** five times:

| Title | URL | Schedule |
|---|---|---|
| close-bidding | `https://hoodiz.net/api/cron/close-bidding` | every 1 minute |
| outbox-dispatch | `https://hoodiz.net/api/cron/outbox-dispatch` | every 5 minutes |
| sla-warnings | `https://hoodiz.net/api/cron/sla-warnings` | every 5 minutes |
| close-stale-holds | `https://hoodiz.net/api/cron/close-stale-holds` | every 15 minutes |
| tracker-retention | `https://hoodiz.net/api/cron/tracker-retention` | daily 03:30 |

For each one, open **Advanced**:
- Request method: **GET**
- Headers: add `Authorization` with value `Bearer <your CRON_SECRET>`
- Timeout: the maximum offered
- Turn on failure notifications to your email.

Check: **Test run** should answer `200`. `401` means the header does not
match `CRON_SECRET`; `503` means `CRON_SECRET` is not set on Vercel.

Without `close-bidding`, bids never close and orders are never assigned.

## 7. Check the deployment

On `https://hoodiz.net`:
1. Home page loads, images appear, no errors in the browser console.
2. Register with email: the confirmation email arrives (from `no-reply@hoodiz.net`).
3. Sign out, **Forgot password**: the reset email arrives and the link works.
4. Sign in with Google.
5. Order something and pay with test card `4242 4242 4242 4242`, any future
   date, any CVC. The success page shows "Order confirmed" within a few seconds, and the
   "Order confirmed" email arrives. If it stays on "Checking your payment",
   the webhook is wrong: Stripe → Webhooks → your endpoint shows the failed attempts.
6. As a booster: the order appears in available orders with the sound; bid
   and wait for bidding to close (cron), then chat in the order page.
7. Admin: refund a test order.
8. Vercel → **Logs**: no errors.

## 8. Going live (later)

1. Vercel → **Upgrade to Pro** ($20/month).
2. Move the jobs back to Vercel: put this in `vercel.json`, commit, push,
   then pause the cron-job.org jobs:
   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "regions": ["dub1"],
     "crons": [
       { "path": "/api/cron/outbox-dispatch", "schedule": "*/5 * * * *" },
       { "path": "/api/cron/close-stale-holds", "schedule": "*/15 * * * *" },
       { "path": "/api/cron/close-bidding", "schedule": "* * * * *" },
       { "path": "/api/cron/sla-warnings", "schedule": "*/5 * * * *" },
       { "path": "/api/cron/tracker-retention", "schedule": "30 3 * * *" }
     ]
   }
   ```
   Vercel sends `CRON_SECRET` automatically.
3. Stripe: activate the account, switch to **live mode**, create the same
   webhook in live mode, then on Vercel set `STRIPE_SECRET_KEY=sk_live_…`, the live
   `STRIPE_WEBHOOK_SECRET`, `STRIPE_LIVE_MODE_ENABLED=true`, and redeploy.
4. Make one real small payment and refund it.
5. Database backups: Supabase Pro has daily backups; on Free, schedule a
   `pg_dump`.

## Database changes (migrations)

Vercel does **not** run migrations. When a new migration is added, apply it
from your computer before (or right after) deploying the code that needs it:

```bash
npx prisma migrate deploy
```
