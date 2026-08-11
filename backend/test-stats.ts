import "dotenv/config";
import { pool } from "./config/db.js";

async function main() {
  const sessionId = "9b71d170-faca-493b-810e-d546abc29b7d";
  const sku = "SRCEZ18FGR";
  const office = "WL Mangga Dua";

  const scansResult = await pool.query(
    `SELECT DISTINCT rak FROM "ScanLog"
     WHERE "sessionId" = $1 AND sku = $2 AND "office" = $3`,
    [sessionId, sku, office]
  );
  console.log("Scans distinct raks:", scansResult.rows);

  const approvalsResult = await pool.query(
    `SELECT COUNT(*)::text AS count FROM "ScanQtyApproval"
     WHERE "sessionId" = $1 AND sku = $2 AND "office" = $3`,
    [sessionId, sku, office]
  );
  console.log("Approvals count:", approvalsResult.rows);

  const allApprovals = await pool.query(
    `SELECT * FROM "ScanQtyApproval"
     WHERE "sessionId" = $1 AND sku = $2 AND "office" = $3`,
    [sessionId, sku, office]
  );
  console.log("Raw approvals:", allApprovals.rows);
}

main().catch(console.error);
