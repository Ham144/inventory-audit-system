import dotenv from "dotenv";
dotenv.config();

const { pool } = await import("../config/db.js");
const { ensureSkuReminderSchema } = await import("../utils/sku-reminder-store.js");

await ensureSkuReminderSchema();
const cols = await pool.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'SkuReminder' ORDER BY 1`,
);
console.log("SkuReminder columns:", cols.rows.map((r) => r.column_name).join(", "));
await pool.end();
