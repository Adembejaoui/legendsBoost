import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

async function verify() {
  // Check unique index
  const indexResult = await pool.query(`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'orderBoosterAssignment'
  `);
  console.log("=== Indexes ===");
  console.table(indexResult.rows);

  // Check constraints using direct table oid lookup
  const constraintResult = await pool.query(`
    SELECT conname, pg_get_constraintdef(con.oid) as definition
    FROM pg_constraint con
    JOIN pg_class pc ON pc.oid = con.conrelid
    WHERE pc.relname = 'orderBoosterAssignment' AND contype = 'c'
  `);
  console.log("\n=== CHECK Constraints ===");
  console.table(constraintResult.rows);

  // Check foreign keys
  const fkResult = await pool.query(`
    SELECT conname, pg_get_constraintdef(con.oid) as definition
    FROM pg_constraint con
    JOIN pg_class pc ON pc.oid = con.conrelid
    WHERE pc.relname = 'orderBoosterAssignment' AND contype = 'f'
  `);
  console.log("\n=== Foreign Keys ===");
  console.table(fkResult.rows);

  await pool.end();
}

verify();