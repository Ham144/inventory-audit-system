import { PrismaClient } from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("⚠️ DATABASE_URL is not set in environment variables!");
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

export async function connectDB() {
  try {
    // Attempt a simple query to verify connection through the pool
    await pool.query("SELECT 1");
    console.log("🟢 PostgreSQL database connected successfully via Prisma (pg-adapter)!");
  } catch (error: unknown) {
    console.error("🔴 PostgreSQL connection failure:", error);
    // Keep running in development even if DB is not connected to let developers work
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  }
}

export { prisma };
export default prisma;
