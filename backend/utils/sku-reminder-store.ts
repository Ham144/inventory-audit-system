import { pool } from "../config/db.js";

export type SkuReminderRow = {
  id: string;
  sku: string;
  resolvedOffices: string[];
  startPeriod: Date | null;
  endPeriod: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SkuReminderSummary = {
  totalCatalog: number;
  unresolved: number;
  resolved: number;
  progressPercent: number;
};

const SELECT_FIELDS = `id, sku, "resolvedOffices", "startPeriod", "endPeriod", "createdAt", "updatedAt"`;

export async function syncSkuReminderCatalog(
  skus: string[],
  periodStart: Date,
  periodEnd: Date | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM "SkuReminder"
       WHERE sku <> ALL($1::text[])`,
      [skus],
    );

    await client.query(
      `INSERT INTO "SkuReminder" (
         id,
         sku,
         "resolvedOffices",
         "startPeriod",
         "endPeriod",
         "createdAt",
         "updatedAt"
       )
       SELECT gen_random_uuid(), x.sku, '{}', $2, $3, NOW(), NOW()
       FROM unnest($1::text[]) AS x(sku)
       ON CONFLICT (sku) DO UPDATE SET
         "resolvedOffices" = '{}',
         "startPeriod" = EXCLUDED."startPeriod",
         "endPeriod" = EXCLUDED."endPeriod",
         "updatedAt" = NOW()`,
      [skus, periodStart, periodEnd],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getSkuReminderSummary(
  office?: string,
): Promise<SkuReminderSummary> {
  const totalResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "SkuReminder"`,
  );
  const totalCatalog = Number(totalResult.rows[0]?.count ?? 0);

  if (!office) {
    return {
      totalCatalog,
      unresolved: totalCatalog,
      resolved: 0,
      progressPercent: 0,
    };
  }

  const resolvedResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM "SkuReminder"
     WHERE $1 = ANY("resolvedOffices")`,
    [office],
  );
  const resolved = Number(resolvedResult.rows[0]?.count ?? 0);
  const unresolved = Math.max(0, totalCatalog - resolved);
  const progressPercent =
    totalCatalog > 0 ? Math.round((resolved / totalCatalog) * 1000) / 10 : 0;

  return { totalCatalog, unresolved, resolved, progressPercent };
}

export async function listSkuReminders(
  office?: string,
  mode: "unresolved" | "all" = "unresolved",
): Promise<SkuReminderRow[]> {
  if (!office || mode === "all") {
    const result = await pool.query<SkuReminderRow>(
      `SELECT ${SELECT_FIELDS}
       FROM "SkuReminder"
       ORDER BY sku ASC`,
    );
    return result.rows;
  }

  const result = await pool.query<SkuReminderRow>(
    `SELECT ${SELECT_FIELDS}
     FROM "SkuReminder"
     WHERE NOT ($1 = ANY("resolvedOffices"))
     ORDER BY sku ASC`,
    [office],
  );
  return result.rows;
}

/** @deprecated use listSkuReminders */
export async function listUnresolvedSkuReminders(
  office?: string,
): Promise<SkuReminderRow[]> {
  return listSkuReminders(office, "unresolved");
}

export async function markSkuReminderResolved(
  sku: string,
  office: string,
): Promise<void> {
  const cleanSku = sku.trim();
  const cleanOffice = office.trim();
  if (!cleanSku || !cleanOffice) return;

  await pool.query(
    `INSERT INTO "SkuReminder" (id, sku, "resolvedOffices", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, ARRAY[$2]::text[], NOW(), NOW())
     ON CONFLICT (sku) DO UPDATE SET
       "resolvedOffices" = CASE
         WHEN $2 = ANY("SkuReminder"."resolvedOffices") THEN "SkuReminder"."resolvedOffices"
         ELSE array_append("SkuReminder"."resolvedOffices", $2)
       END,
       "updatedAt" = NOW()`,
    [cleanSku, cleanOffice],
  );
}
