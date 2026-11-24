-- Customer cashback (2026-11-24).
--
-- A customer earns a share of what they paid when an order is completed and
-- can spend it on later orders (platform-funded, like a discount code: it
-- never lowers the booster share). History is append-only; the balance is
-- the sum of the entries, never a stored number.

CREATE TYPE "CashbackEntryKind" AS ENUM ('EARN', 'SPEND', 'RELEASE', 'EXPIRE', 'REVERSE', 'RETURN', 'ADJUST');

-- Ledger: cashback owed to customers, and the postings that move it.
ALTER TYPE "LedgerAccount" ADD VALUE 'CUSTOMER_CREDIT';
ALTER TYPE "FinancialTransactionType" ADD VALUE 'CASHBACK_EARNED';
ALTER TYPE "FinancialTransactionType" ADD VALUE 'CASHBACK_SPENT';
ALTER TYPE "FinancialTransactionType" ADD VALUE 'CASHBACK_EXPIRED';
ALTER TYPE "FinancialTransactionType" ADD VALUE 'CASHBACK_REVERSED';
ALTER TYPE "FinancialTransactionType" ADD VALUE 'CASHBACK_RETURNED';
ALTER TYPE "FinancialTransactionType" ADD VALUE 'CASHBACK_ADJUSTED';

-- Snapshot: the part of the discount paid with cashback (adding a column
-- with a default fires no row trigger, so the append-only rule stays).
ALTER TABLE "orderPricingSnapshot" ADD COLUMN "cashbackAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orderPricingSnapshot"
  ADD CONSTRAINT "orderPricingSnapshot_cashback_check" CHECK ("cashbackAmount" >= 0 AND "cashbackAmount" <= "discountAmount");

CREATE TABLE "cashbackEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "kind" "CashbackEntryKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lotId" TEXT,
    "orderId" TEXT,
    "refundId" TEXT,
    "rateBps" INTEGER,
    "note" TEXT,
    "createdById" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashbackEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cashbackEntry_idempotencyKey_key" ON "cashbackEntry"("idempotencyKey");
CREATE INDEX "cashbackEntry_userId_currency_createdAt_idx" ON "cashbackEntry"("userId", "currency", "createdAt");
CREATE INDEX "cashbackEntry_orderId_idx" ON "cashbackEntry"("orderId");
CREATE INDEX "cashbackEntry_expiresAt_idx" ON "cashbackEntry"("expiresAt");

ALTER TABLE "cashbackEntry" ADD CONSTRAINT "cashbackEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cashbackEntry" ADD CONSTRAINT "cashbackEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cashbackEntry" ADD CONSTRAINT "cashbackEntry_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "cashbackEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity, enforced by the database whatever the application does.
ALTER TABLE "cashbackEntry"
  ADD CONSTRAINT "cashbackEntry_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "cashbackEntry_amount_bounds" CHECK ("amount" <> 0 AND "amount" BETWEEN -1000000000 AND 1000000000),
  ADD CONSTRAINT "cashbackEntry_sign_check" CHECK (
    ("kind" IN ('EARN', 'RELEASE', 'RETURN') AND "amount" > 0)
    OR ("kind" IN ('SPEND', 'EXPIRE', 'REVERSE') AND "amount" < 0)
    OR "kind" = 'ADJUST'
  ),
  -- Only credit lots expire. A SPEND keeps the latest expiry of the credit it
  -- used, so a cancelled checkout gives it back with that same expiry.
  ADD CONSTRAINT "cashbackEntry_expiry_check" CHECK ("expiresAt" IS NULL OR "amount" > 0 OR "kind" = 'SPEND'),
  -- An expiry always names its lot.
  ADD CONSTRAINT "cashbackEntry_lot_check" CHECK (("kind" = 'EXPIRE') = ("lotId" IS NOT NULL)),
  -- Admin changes always say why.
  ADD CONSTRAINT "cashbackEntry_adjust_note" CHECK ("kind" <> 'ADJUST' OR ("note" IS NOT NULL AND length("note") > 0));

-- Append-only, like the ledger: no update, delete or truncate, ever.
CREATE TRIGGER "cashbackEntry_append_only"
  BEFORE UPDATE OR DELETE ON "cashbackEntry"
  FOR EACH ROW EXECUTE FUNCTION "legendsboost_reject_mutation"();
CREATE TRIGGER "cashbackEntry_no_truncate"
  BEFORE TRUNCATE ON "cashbackEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION "legendsboost_reject_mutation"();

-- Server-only table (no Supabase anon/authenticated access).
ALTER TABLE "cashbackEntry" ENABLE ROW LEVEL SECURITY;
