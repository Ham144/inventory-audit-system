import "dotenv/config";
import { prisma } from "./config/db.js";

async function main() {
  const session = await prisma.opnameSession.findUnique({
    where: { id: "235df393-5040-4b3c-b1fc-bb8d62bbcde9" }
  });
  console.log("SESSION DETAIL:", JSON.stringify(session, null, 2));
}

main().catch(console.error);
