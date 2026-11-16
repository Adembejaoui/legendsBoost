# Customer flows: production-readiness review (2026-11-14)

Scope: everything a customer touches: sign-up / sign-in, storefront,
checkout and payment, customer dashboard, order page (workspace), support
tickets. Code phase only: nothing committed, no database change needed.

## Fixed in this pass

### Security
| # | Problem | Fix |
|---|---------|-----|
| 1 | **No brute-force protection on sign-in.** Unlimited password guesses. | Shared limiter: 8 tries per account and 30 per IP per 15 min, checked before bcrypt. Login form shows a clear "too many attempts" message. |
| 2 | **Rate limits did not work on Vercel.** They were in-memory, so each server instance had its own counters. | New `lib/security/shared-rate-limit.ts`: counters in Postgres (the existing `riotApiThrottle` table, `app:` prefix, so no migration). Identifiers are SHA-256 hashed and nothing personal is stored. Falls back to memory if the DB is unreachable. Used for login, registration, checkout, and saving/viewing the account login. |
| 3 | **Unlimited sign-ups** (spam accounts). | 5 accounts per IP per hour. |
| 4 | **Support ticket IDOR.** A customer could attach any order ID, including someone else's, and get that order's game, service and status back with the ticket. | `createSupportTicket` checks the order belongs to the customer (404 otherwise). |
| 5 | Order list API (`GET /api/orders`) returned raw database rows, including the idempotency hash and internal fields. | Returns the customer-facing `toPublicOrder` shape. `?page=abc` no longer produces NaN. |
| 6 | No security headers. | HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy; `X-Powered-By` removed; `no-store` on `/dashboard` and `/api`. |

### Correctness
| # | Problem | Fix |
|---|---------|-----|
| 7 | Chat and support text was HTML-stripped: "Rank < Gold" or "<3" lost text. | `sanitizeText` now only normalizes plain text (control chars, line endings, 10,000-char cap). React escapes on render, so it's safe. `sanitizeHtml` hardened (safe links, no styles or handlers). |
| 8 | Sign-up with a 73–128 character password → 500 error (bcrypt limit is 72 bytes). | Validation message "72 characters max". A duplicate-email race is now detected by Prisma code P2002 (the old string check never matched). |
| 9 | Support tickets and messages were rate-limited twice, which halved the stated limits. | Counted once. Ticket input validated (subject 3–200 characters, description 10–5000). |
| 10 | Order card showed a literal `&middot;`. | Fixed. |
| 11 | `<head>` pointed at 4 icon files that don't exist (404s) and said "generator: v0.app". | Removed; title template, Open Graph/Twitter cards and `metadataBase` added. |

### UX
| # | Problem | Fix |
|---|---------|-----|
| 12 | Unpaid orders showed up in the dashboard and could be paid days later. | **Orders exist only once paid** (see below). |
| 13 | Signed-out visitors opening an order link landed on `/login`, then on the dashboard, not on the order. | `proxy.ts` sends them to `/login?callbackUrl=<the page>`. Pages still enforce access. |
| 14 | No error page, no 404 page, no loading state. | `app/error.tsx`, `app/global-error.tsx` (with error code for support), `app/not-found.tsx`, `app/dashboard/loading.tsx`. |
| 15 | No way to open a ticket about a specific order. | "Get help" on the order page opens the support form linked to that order. |
| 16 | No `robots.txt` / sitemap. | `app/robots.ts` (private areas excluded) and `app/sitemap.ts` (games and services). |

### Tests
- New: shared limiter (4), ticket order ownership (4), ticket input (2), password hashing (4).
- Repaired: `sanitize.test.ts` and `rate-limit.test.ts` (failing since before this work, now passing), `password.test.ts` (was a script that vitest could not run).

## Paid-only orders (follow-up change)

The customer has an order only after Stripe confirms the payment.
- "Continue to Payment" creates a short-lived, invisible **checkout hold** (`AWAITING_PAYMENT`) and sends the customer straight to Stripe.
- The verified webhook turns the hold into a real order (`PENDING`, visible to the customer and to boosters).
- A hold that is not paid is closed (`CANCELLED` + `CHECKOUT_CLOSED` event):
  - the customer presses back/cancel on Stripe (`DELETE /api/orders/[id]/checkout`);
  - Stripe sends `checkout.session.expired` or `async_payment_failed`;
  - it is older than `CHECKOUT_HOLD_TTL_MS` (1 h): refused at checkout and swept when the customer starts a new one.
- Holds are never listed, counted or openable by the customer (`CUSTOMER_VISIBLE_ORDER_WHERE` / `isCheckoutHold` in `lib/orders/payment-gate.ts`). Legacy orders from before online payment stay visible.
- No "order created" notification for a hold; the customer is notified when payment succeeds.
- Removed: `/checkout/payment` (pay-later page), the "Complete payment" bar and banner, and "Try payment again" on the return page.
- Why holds are kept rather than deleted: a payment that somehow lands after the hold closed is still recorded and flagged for a refund instead of being lost.

## Still to do before launch (not done: needs a decision, a provider or legal text)

### Blockers
1. **Broken links: `/forgot-password`, `/terms`, `/privacy` do not exist.** The login page and the sign-up form link to them.
   - Password reset needs an email provider (Resend, Postmark, SES…), a reset-token table and an email template.
   - Terms and Privacy need your legal text, including how customer logins are handled.
2. **Riot account sharing.** Riot's terms forbid sharing account logins. Customers risk bans, and Riot will not approve a production API key for a product that does this. Decide the product position. The app works with the development key only on your local machine.
3. **Production secrets.** Set on Vercel: `ACCOUNT_CREDENTIALS_KEY` (new key, back it up), live Stripe keys plus `STRIPE_LIVE_MODE_ENABLED`, `APP_URL`, and `AUTH_SECRET` (not the dev one).

### High
4. **Transactional email.** Order paid, booster assigned, order completed, ticket reply. Today notifications are in-app only.
5. *(done: unpaid checkouts are closed automatically, see "Paid-only orders")*
6. **Error monitoring** (Sentry or similar). `error.tsx` shows an error code, but nothing collects it.
7. **Content-Security-Policy.** Only `frame-ancestors` is set. Build a full policy against Stripe, Supabase Realtime, Google sign-in, Data Dragon, then enforce.
8. **Google + password on the same email.** A customer who signed up with a password and then clicks Google gets `OAuthAccountNotLinked`. Show a clear message on `/login?error=OAuthAccountNotLinked`, or link accounts after email verification.
9. **Email verification at sign-up.** Currently none.

### Medium
10. **Riot data refresh without an open page.** It only updates while someone has the order page open; a cron job would keep it current.
11. **Remaining in-memory limiters.** Chat messages, Riot sync and quote still use them; move them to `sharedRateLimit` if abuse appears.
12. **Account self-service.** Change password, delete account and export data (GDPR).
13. **Lint backlog.** About 140 pre-existing ESLint errors, mostly `any`, so `npm run lint` fails.

### Repository hygiene (deletions, so left for you)
- `package/` (203 MB untracked copy of Next.js), the empty files `stripe` and `x.txt`, `components/checkout/CheckoutOptionsList.tsx.bak`, the empty `__tests/` directory, `__tests__/auth/password.test.js` (old compiled copy).
- Three tests (realtime JWT, broadcast, legacy-report script) time out only when the whole suite runs in parallel. They pass on their own.
