import "dotenv/config";
import prisma from "./config/db.js";
import { pool } from "./config/db.js";

async function main() {
  const sessionId = "9b71d170-faca-493b-810e-d546abc29b7d";
  const sku = "SRCEZ18FGR";

  const scans = await prisma.scanLog.findMany({
    where: { sessionId, sku }
  });
  console.log("Scans in DB:", scans);

  const approvals = await prisma.scanQtyApproval.findMany({
    where: { sessionId, sku }
  });
  console.log("Approvals in DB:", approvals);
}

main().catch(console.error);
