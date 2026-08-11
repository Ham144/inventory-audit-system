import "dotenv/config";
import { prisma } from "./config/db.js";

async function main() {
  const mappings = await prisma.officeMapping.findMany();
  console.log("Mappings:", mappings);
}

main().catch(console.error);
