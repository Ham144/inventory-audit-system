import "dotenv/config";
import { prisma } from "./config/db.js";
import { upsertScanQtyApproval } from "./utils/scan-approval.js";

async function main() {
  const session = await prisma.opnameSession.findFirst();
  if (!session) return;
  
  const scan = await prisma.scanLog.findFirst({
    where: { sessionId: session.id }
  });
  if (!scan) return;

  console.log("Original scan:", scan.id);
  
  // Fake a new scan on the same rack
  const scan2 = await prisma.scanLog.create({
    data: {
      sessionId: scan.sessionId,
      sku: scan.sku,
      name: scan.name,
      rak: scan.rak,
      qty: scan.qty + 5,
      operator: "test_operator_2",
      office: scan.office,
    }
  });
  console.log("Created second scan:", scan2.id);

  console.log("Testing upsert for second scan...");
  try {
    const res = await upsertScanQtyApproval({
      sessionId: scan2.sessionId,
      sku: scan2.sku,
      rak: scan2.rak,
      office: scan2.office ?? "",
      scanLogId: scan2.id,
      approvedQty: scan2.qty,
      approvedBy: "test_admin",
    });
    console.log("SUCCESS:", res);
  } catch (err: any) {
    console.error("FAILED:", err.message || err);
  }

  // Cleanup
  await prisma.scanLog.delete({ where: { id: scan2.id } });
}

main().catch(console.error);
