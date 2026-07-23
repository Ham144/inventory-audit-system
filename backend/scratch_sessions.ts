import "dotenv/config";
import { prisma } from "./config/db.js";

async function main() {
  const sessions = await prisma.opnameSession.findMany({ where: { status: "ONGOING" } });
  console.log("Sessions:", sessions);
}

main().catch(console.error);
