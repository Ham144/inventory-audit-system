import "dotenv/config";
import { prisma } from "./config/db.js";

async function main() {
  const users = await prisma.user.findMany();
  console.log("DB USERS:", JSON.stringify(users, null, 2));
}

main().catch(console.error);
