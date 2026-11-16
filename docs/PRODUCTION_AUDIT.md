# Production readiness audit

Date: 2026-11-15. Scope: security, performance, optimization. Read-only audit: no code was changed.

## Verdict

**Not ready for production yet.** The application code is in good shape: access control, payments, encryption and rate limiting are solid. What blocks a launch is mostly setup and a few gaps, listed under "Must fix before launch".

| Area | State |
|---|---|
| Access control (91 API routes) | Good |
| Payments (Stripe) | Good, still in test mode |
| Database exposure (Supabase) | Good, 2 tables to lock |
| Secrets | Good |
| Account recovery / email | Missing |
| Riot API | Development key only |
| Performance | Good, except images |
| Code health | Production build succeeds, 1039 tests pass, typecheck clean, lint 0 errors (176 warnings) |

## Must fix before launch

1. **CODE DONE 2026-11-15, needs your Resend key** (set `RESEND_API_KEY` and `EMAIL_FROM`; password reset, optional email confirmation with a dashboard reminder, change password). Original finding: **No email provider.** There is no password reset (the "Forgot password" page is a placeholder), no email verification at sign-up, and no email notifications. A customer who forgets their password is locked out, and anyone can register with someone else's email address. Add a provider (Resend, Postmark...) with reset and verification flows.
2. **Riot key is a development key** (`RIOT_API_KEY_TIER=development`, `RIOT_ALLOW_DEV_KEY_LOCAL=true`). Development keys expire every 24 hours and are not allowed for a public product. Rank and match tracking, and the automatic completion check, stop working without a production key. Note that Riot's policies do not allow boosting services, so approval of a production key is uncertain: decide how the product works if tracking is unavailable (the manual admin completion path already exists).
3. **Stripe is in test mode** (`sk_test` / `pk_test`). For launch: live keys, `STRIPE_LIVE_MODE_ENABLED=true`, a live webhook endpoint with its own `STRIPE_WEBHOOK_SECRET`, and one real end-to-end payment and refund.
4. **`APP_URL` is `http://localhost:3000`.** It must be the real https domain in production (used for Stripe return links and other absolute links). Also add the production domain to the Google sign-in redirect URLs.
5. **FIXED 2026-11-15 (route and store deleted).** ~~Public anonymous endpoint keeps data in server memory without limits.** `POST /api/orders/draft` (`lib/orders/draft-store.ts`) needs no sign-in, has no rate limit and no size limit, and stores every request in a `Map` that never empties. Anyone can fill the server's memory. Nothing in the app calls it any more: delete the route and the store.~~
6. **FIXED 2026-11-15 (migration `20261117120000_lock_remaining_tables`, applied; RLS is now on for all 49 tables).** ~~Two tables readable with the public Supabase key.** Row-level security is on for 47 of 49 tables (good: the public key cannot read them). It is off for `verificationToken` and `_prisma_migrations`, and the `anon` role can read both. `verificationToken` will hold sign-in / reset tokens once email is added. Enable RLS on both.~~
7. **Cron needs a paid plan.** `vercel.json` runs `close-bidding` every minute and others every 5 minutes. Vercel's free plan only allows daily crons, so bidding would never close on time. Use the Pro plan or an external scheduler calling the same URLs with `CRON_SECRET`.

## Should fix soon

8. **FIXED 2026-11-15 (all 21 images converted to WebP: 10.7 MB to 0.7 MB; social preview is a 109 KB JPEG).** ~~Images are very heavy.~~ Original finding: `hero-esports.png` and the three game images are 1.8 to 2.0 MB each and are served as plain `<img>`. The home page downloads about 7.5 MB of images; the order page header (new design) loads one of them too. Rank emblems are about 250 KB each. Convert to WebP/AVIF at display size, or use `next/image` (25 `<img>` tags today). Expected: around 90% less image weight.
9. **FIXED 2026-11-15** (CSP added in `next.config.ts`; `CSP_REPORT_ONLY=true` switches it to log-only). Original finding: **No full Content-Security-Policy.** Good headers are set (HSTS, no framing, nosniff, referrer policy), but there is no `script-src` policy, so an injected script would not be blocked. No `dangerouslySetInnerHTML` is used anywhere, which keeps the risk low. Add a CSP that allows Stripe, Supabase, Google and Data Dragon.
10. **FIXED 2026-11-15** (six routes moved to the shared limiter; the chat typing indicator stays in memory on purpose, it is harmless and very frequent). Original finding: **Some rate limits only work per server instance.** Seven routes use the in-memory limiter (`lib/rate-limit.ts`): quote, typing, realtime auth, game account, Riot check and sync, Riot test. On serverless hosting each instance counts separately, so the limits are weak. Login, registration, bids, claims, payouts and credential reveal already use the shared database limiter: move these seven to it.
11. **FIXED 2026-11-15** (kept at 30 days by decision; a password change or reset now signs out every device; migration `20261117180000_session_version`). Original finding: **Sessions last 30 days and cannot be ended early.** Sign-in uses a signed cookie (JWT) with the default lifetime. Roles and deleted accounts are re-checked in the database on every request (good), but there is no "sign out everywhere" and a password change does not end other sessions.
12. **FIXED 2026-11-15** (`shadcn` moved to devDependencies). Original finding: **Dependency warnings.** `npm audit`: 6 issues (2 low, 4 moderate), all through the `shadcn` command-line tool, which is listed as a runtime dependency. Move it to `devDependencies`; nothing in the running app is affected.
13. **Monitoring.** Sentry is installed, but `SENTRY_DSN` is not set in `.env`. Set it in production, otherwise errors are invisible.
14. **Diagnostic route.** `/api/dev/riot-test` and `/dashboard/riot-test` are admin-only in production (fine), but consider removing them from the production build.

## What is already good

- **Access control.** All 91 API routes check the session. Admin routes check the ADMIN role, booster routes the BOOSTER role, order routes check that the caller belongs to the order. Roles are read from the database on each request, not trusted from the cookie.
- **Payments.** The Stripe webhook verifies the signature on the raw body, processing is idempotent, prices are computed on the server, live mode needs an explicit switch, and the ledger is append-only (database triggers).
- **Secrets.** `.env` is git-ignored, no keys in the git history, no secret is exposed through `NEXT_PUBLIC_` variables.
- **Sensitive data.** Game logins and payout details are encrypted (AES-256-GCM, key only in the environment), reveals are logged and rate limited. Passwords use bcrypt with 12 rounds.
- **Abuse protection.** Login is limited per email and per IP, registration per IP, and money actions per user, using a shared database limiter.
- **Database.** No unsafe raw SQL. Connection goes through the Supabase pooler. Indexes cover the busiest queries. Lists are paged or capped.
- **Cron.** Protected by `CRON_SECRET` with a constant-time comparison; refuses to run when the secret is missing.
- **Other.** Open-redirect protection on the login return link, no HTML injection points, error pages exist, caching disabled for private pages and API answers.

## Performance notes (no action needed now)

- Database pool is 2 connections per server instance: right for serverless with the pooler; raise it if you host on a long-running server.
- Each open order page asks the server for its status every 15 seconds, plus a 20-second fallback when realtime is down. Fine for hundreds of users; revisit at thousands.
- A few background jobs query inside loops (outbox, SLA warnings, earnings release). They run in small batches, so the cost is low.
- 176 lint warnings (unused variables, `<img>` usage, effect patterns): no errors, clean up over time.

## Suggested order of work

1. Delete the draft endpoint, enable RLS on the two tables (small, quick).
2. Compress images.
3. Email provider with password reset and verification.
4. Production environment: domain, `APP_URL`, Stripe live keys and webhook, Sentry DSN, cron plan, Google redirect URL.
5. Decide the Riot API path.
6. CSP, shared rate limits, session lifetime.
