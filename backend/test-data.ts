import prisma from "./config/db.js";

async function run() {
  const sessions = await prisma.opnameSession.findMany({ take: 1 });
  console.log("Active Sessions:", sessions.map(s => s.id));
  
  if (sessions.length > 0) {
    const scans = await prisma.scanLog.findMany({
      where: { sessionId: sessions[0].id },
      take: 2
    });
    console.log("Scans in Session:", scans);

    const compares = await prisma.compareItem.findMany({
      where: { sessionId: sessions[0].id },
      take: 2,
      include: { session: true }
    });
    console.log("Compare in Session:", compares.map(c => ({ sku: c.sku, office: c.session?.office })));
  }
}
run();
