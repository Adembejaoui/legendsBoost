// @vitest-environment node
/**
 * The payments migration applied to an in-memory PostgreSQL built from the
 * pre-migration schema: it must apply cleanly, seed the 45/55 policy, and
 * enforce the database-level money rules on its own.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { closeTestDb, getTestDb, PAYMENTS_MIGRATION } from "../support/pg-test-db";

// Building the in-memory database takes a few seconds under parallel load.
beforeAll(() => getTestDb(), 60_000);
afterAll(closeTestDb);

async function sql(query: string, params: unknown[] = []) {
  return (await getTestDb()).pglite.query(query, params);
}

async function seedOrder(id: string) {
  await sql(`INSERT INTO "user" (id, email, "updatedAt") VALUES ($1, $1 || '@t.test', now()) ON CONFLICT DO NOTHING`, [`u-${id}`]);
  await sql(
    `INSERT INTO "order" (id, "userId", "gameSlug", "serviceSlug", configuration, status, "updatedAt")
     VALUES ($1, $2, 'g', 's', '{}', 'AWAITING_PAYMENT', now())`,
    [id, `u-${id}`]
  );
}

describe("payments migration", () => {
  it("applies on top of the previous schema", async () => {
    const tables = await sql(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const names = tables.rows.map((r) => (r as { table_name: string }).table_name);
    for (const t of [
      "servicePrice", "commissionPolicy", "orderPricingSnapshot", "payment", "paymentEvent",
      "financialTransaction", "boosterEarning", "boosterPayout", "refund", "dispute",
      "outboxEvent", "financialAuditLog",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("is purely additive (no DROP, no UPDATE/DELETE of existing rows)", () => {
    const body = readFileSync(PAYMENTS_MIGRATION, "utf8").replace(/--.*$/gm, "");
    expect(body).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT)\b/i);
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(body).not.toMatch(/^\s*UPDATE\s+"/im);
  });

  it("seeds the 45/55 commission policy", async () => {
    const r = await sql(`SELECT "platformFeeBps", "boosterShareBps" FROM "commissionPolicy"`);
    expect(r.rows).toEqual([{ platformFeeBps: 4500, boosterShareBps: 5500 }]);
  });

  it("rejects a commission policy that does not sum to 100%", async () => {
    await expect(
      sql(`INSERT INTO "commissionPolicy" (id, "platformFeeBps", "boosterShareBps") VALUES ('bad', 4000, 5000)`)
    ).rejects.toThrow(/commissionPolicy_bps_check/);
  });

  it("ledger rows cannot be updated, deleted or truncated", async () => {
    await sql(
      `INSERT INTO "financialTransaction" (id, type, account, amount, currency, "idempotencyKey")
       VALUES ('ft-1', 'CUSTOMER_PAYMENT', 'CUSTOMER_PAYMENTS', 100, 'EUR', 'k-1')`
    );
    await expect(sql(`UPDATE "financialTransaction" SET amount = 1 WHERE id = 'ft-1'`)).rejects.toThrow(/append-only/);
    await expect(sql(`DELETE FROM "financialTransaction" WHERE id = 'ft-1'`)).rejects.toThrow(/append-only/);
    await expect(sql(`TRUNCATE "financialTransaction"`)).rejects.toThrow(/append-only/);
  });

  it("ledger rejects zero amounts, bad currencies and payable entries without a booster", async () => {
    const insert = (id: string, amount: number, currency: string, account = "PLATFORM_REVENUE") =>
      sql(
        `INSERT INTO "financialTransaction" (id, type, account, amount, currency, "idempotencyKey") VALUES ($1, 'PLATFORM_COMMISSION', $4, $2, $3, $1)`,
        [id, amount, currency, account]
      );
    await expect(insert("ft-z", 0, "EUR")).rejects.toThrow(/nonzero/);
    await expect(insert("ft-c", 5, "eur")).rejects.toThrow(/currency/);
    await expect(insert("ft-b", 5, "EUR", "BOOSTER_PAYABLE")).rejects.toThrow(/booster_check/);
  });

  it("ledger idempotency keys are unique", async () => {
    await expect(
      sql(
        `INSERT INTO "financialTransaction" (id, type, account, amount, currency, "idempotencyKey")
         VALUES ('ft-dup', 'CUSTOMER_PAYMENT', 'CUSTOMER_PAYMENTS', 100, 'EUR', 'k-1')`
      )
    ).rejects.toThrow(/idempotencyKey/);
  });

  it("price snapshots must split the commission base exactly and are immutable", async () => {
    await seedOrder("o-snap");
    await sql(
      `INSERT INTO "servicePrice" (id, "gameSlug", "serviceSlug", version, currency, "pricingModel", "baseAmount", "optionPricing", "modePricing", "createdById")
       VALUES ('sp-1', 'g', 's', 1, 'EUR', 'FIXED', 10000, '{}', '{}', 'admin')`
    );
    const insert = (id: string, fee: number, share: number) =>
      sql(
        `INSERT INTO "orderPricingSnapshot" (id, "orderId", currency, "subtotalAmount", "totalAmount", "commissionBaseAmount",
           "platformFeeBps", "boosterShareBps", "platformFeeAmount", "boosterShareAmount", "commissionPolicyId",
           "servicePriceId", "servicePriceVersion", breakdown)
         VALUES ($1, 'o-snap', 'EUR', 10000, 10000, 10000, 4500, 5500, $2, $3, 'commission_policy_initial_45_55', 'sp-1', 1, '{}')`,
        [id, fee, share]
      );
    await expect(insert("snap-bad", 4500, 5400)).rejects.toThrow(/orderPricingSnapshot_amounts_check/);
    await insert("snap-ok", 4500, 5500);
    await expect(sql(`UPDATE "orderPricingSnapshot" SET "totalAmount" = 1 WHERE id = 'snap-ok'`)).rejects.toThrow(/append-only/);
  });

  it("a payout cannot be PAID without method, reference and evidence", async () => {
    await sql(`INSERT INTO "user" (id, email, "updatedAt") VALUES ('b-1', 'b1@t.test', now())`);
    await sql(`INSERT INTO "boosterPayout" (id, "boosterId", amount, currency, "updatedAt") VALUES ('po-1', 'b-1', 100, 'EUR', now())`);
    await expect(
      sql(`UPDATE "boosterPayout" SET status = 'PAID', "paidAt" = now(), "paidRecordedById" = 'a', method = 'bank' WHERE id = 'po-1'`)
    ).rejects.toThrow(/paid_evidence/);
    await sql(
      `UPDATE "boosterPayout" SET status = 'PAID', "paidAt" = now(), "paidRecordedById" = 'a', method = 'bank',
         "externalReference" = 'TX-1', evidence = 'statement line 4', "openKey" = NULL WHERE id = 'po-1'`
    );
  });

  it("one order can only be paid by one payment, and financial rows block order deletion", async () => {
    await seedOrder("o-pay");
    const pay = (id: string, n: number) =>
      sql(
        `INSERT INTO payment (id, "orderId", "customerId", "attemptNumber", amount, currency, "idempotencyKey", "updatedAt")
         VALUES ($1, 'o-pay', 'u-o-pay', $2, 1000, 'EUR', $1, now())`,
        [id, n]
      );
    await pay("p-1", 1);
    await pay("p-2", 2);
    await sql(`UPDATE "order" SET "paidPaymentId" = 'p-1' WHERE id = 'o-pay'`);
    await seedOrder("o-other");
    await expect(sql(`UPDATE "order" SET "paidPaymentId" = 'p-1' WHERE id = 'o-other'`)).rejects.toThrow(/paidPaymentId/);
    await expect(sql(`DELETE FROM "order" WHERE id = 'o-pay'`)).rejects.toThrow();
  });

  it("only one open payment attempt per order", async () => {
    await seedOrder("o-slot");
    const open = (id: string, n: number) =>
      sql(
        `INSERT INTO payment (id, "orderId", "customerId", "attemptNumber", amount, currency, "idempotencyKey", "openSlotOrderId", status, "updatedAt")
         VALUES ($1, 'o-slot', 'u-o-slot', $2, 1000, 'EUR', $1, 'o-slot', 'OPEN', now())`,
        [id, n]
      );
    await open("ps-1", 1);
    await expect(open("ps-2", 2)).rejects.toThrow(/openSlotOrderId/);
    // A finished attempt may not keep the slot.
    await expect(sql(`UPDATE payment SET status = 'FAILED' WHERE id = 'ps-1'`)).rejects.toThrow(/payment_open_slot_check/);
  });
});
