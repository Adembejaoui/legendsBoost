import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

async function addConstraint() {
  const sql = `ALTER TABLE "orderBoosterAssignment" ADD CONSTRAINT "orderBoosterAssignment_active_order_check" CHECK (("activeOrderId" IS NULL AND "status" IN ('COMPLETED', 'DECLINED', 'CANCELLED', 'RELEASED')) OR ("activeOrderId" IS NOT NULL AND "status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS') AND "activeOrderId" = "orderId"));`;
  
  try {
    await pool.query(sql);
    console.log("CHECK constraint added successfully");
  } catch (err: any) {
    if (err.code === "42501" || err.message?.includes("already exists")) {
      console.log("Constraint already exists");
    } else {
      console.error("Error adding constraint:", err.message);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

addConstraint();