import { randomUUID } from "crypto";
import { pool } from "../config/db.js";
const SELECT_FIELDS = `id, office, mode, "openedAt", "closedAt", "updatedAt"`;
let schemaReady = null;
function asDate(value) {
    if (value instanceof Date)
        return value;
    if (value == null)
        return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
}
function mapRow(row) {
    const modeRaw = String(row.mode ?? "FREE").toUpperCase();
    return {
        id: String(row.id),
        office: String(row.office),
        mode: modeRaw === "OPNAME" ? "OPNAME" : "FREE",
        openedAt: asDate(row.openedAt),
        closedAt: asDate(row.closedAt),
        updatedAt: asDate(row.updatedAt) ?? new Date(),
    };
}
export async function ensureOfficePeriodSchema() {
    if (!schemaReady) {
        schemaReady = pool
            .query(`CREATE TABLE IF NOT EXISTS "OfficePeriod" (
          id text PRIMARY KEY,
          office text NOT NULL UNIQUE,
          mode text NOT NULL DEFAULT 'FREE',
          "openedAt" timestamp(3),
          "closedAt" timestamp(3),
          "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`)
            .then(async () => {
            // Kolom lama startPeriod/endPeriod boleh tetap ada di DB lama; abaikan.
            await pool.query(`ALTER TABLE "OfficePeriod" ADD COLUMN IF NOT EXISTS "openedAt" timestamp(3)`);
            await pool.query(`ALTER TABLE "OfficePeriod" ADD COLUMN IF NOT EXISTS "closedAt" timestamp(3)`);
            // Backfill sekali: data lama di startPeriod/endPeriod → openedAt/closedAt
            await pool.query(`
          UPDATE "OfficePeriod"
          SET "openedAt" = "startPeriod"
          WHERE "openedAt" IS NULL
            AND "startPeriod" IS NOT NULL
        `).catch(() => undefined);
            await pool.query(`
          UPDATE "OfficePeriod"
          SET "closedAt" = "endPeriod"
          WHERE "closedAt" IS NULL
            AND "endPeriod" IS NOT NULL
        `).catch(() => undefined);
        })
            .then(() => undefined)
            .catch((error) => {
            schemaReady = null;
            throw error;
        });
    }
    await schemaReady;
}
export async function getOfficePeriod(office) {
    await ensureOfficePeriodSchema();
    const result = await pool.query(`SELECT ${SELECT_FIELDS} FROM "OfficePeriod" WHERE office = $1 LIMIT 1`, [office]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
}
export async function getOfficePeriodMode(office) {
    const row = await getOfficePeriod(office);
    return row?.mode ?? "FREE";
}
export async function openOfficePeriod(office) {
    await ensureOfficePeriodSchema();
    const now = new Date();
    const existing = await getOfficePeriod(office);
    if (existing) {
        const result = await pool.query(`UPDATE "OfficePeriod"
       SET mode = 'OPNAME',
           "openedAt" = $2,
           "closedAt" = NULL,
           "updatedAt" = $2
       WHERE office = $1
       RETURNING ${SELECT_FIELDS}`, [office, now]);
        return mapRow(result.rows[0]);
    }
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO "OfficePeriod"
       (id, office, mode, "openedAt", "closedAt", "updatedAt")
     VALUES ($1, $2, 'OPNAME', $3, NULL, $3)
     RETURNING ${SELECT_FIELDS}`, [id, office, now]);
    return mapRow(result.rows[0]);
}
export async function closeOfficePeriod(office) {
    await ensureOfficePeriodSchema();
    const now = new Date();
    const existing = await getOfficePeriod(office);
    if (existing) {
        const result = await pool.query(`UPDATE "OfficePeriod"
       SET mode = 'FREE',
           "closedAt" = $2,
           "updatedAt" = $2
       WHERE office = $1
       RETURNING ${SELECT_FIELDS}`, [office, now]);
        return mapRow(result.rows[0]);
    }
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO "OfficePeriod"
       (id, office, mode, "openedAt", "closedAt", "updatedAt")
     VALUES ($1, $2, 'FREE', NULL, $3, $3)
     RETURNING ${SELECT_FIELDS}`, [id, office, now]);
    return mapRow(result.rows[0]);
}
