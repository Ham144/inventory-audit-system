import prisma from "./config/db.js";

async function run() {
  const scans = await prisma.scanLog.findMany();
  console.log("Total Scans:", scans.length);
  if (scans.length > 0) {
    console.log("Sample Scan:", scans[0]);
  }
}

run();
