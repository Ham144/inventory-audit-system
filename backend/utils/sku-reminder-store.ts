import { pool } from "../config/db.js";

export type OfficeDelegation = {
  delegatedTo: string | null;
  delegatedBy: string | null;
  delegatedAt: string | null;
};

export type SkuReminderRow = {
  id: string;
  sku: string;
  resolvedOffices: string[];
  officeDelegations: Record<string, OfficeDelegation>;
  startPeriod: Date | null;
  endPeriod: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function parseOfficeDelegations(value: unknown): Record<string, OfficeDelegation> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, OfficeDelegation>;
}

function mapSkuReminderRow(row: Record<string, unknown>): SkuReminderRow {
  return {
    id: String(row.id),
    sku: String(row.sku),
    resolvedOffices: Array.isArray(row.resolvedOffices)
      ? row.resolvedOffices.map(String)
      : [],
    officeDelegations: parseOfficeDelegations(row.officeDelegations),
    startPeriod: row.startPeriod instanceof Date ? row.startPeriod : row.startPeriod ? new Date(String(row.startPeriod)) : null,
    endPeriod: row.endPeriod instanceof Date ? row.endPeriod : row.endPeriod ? new Date(String(row.endPeriod)) : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt)),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt)),
  };
}

export type SkuReminderSummary = {
  totalCatalog: number;
  unresolved: number;
  resolved: number;
  progressPercent: number;
};

const SELECT_FIELDS = `id, sku, "resolvedOffices", COALESCE("officeDelegations", '{}'::jsonb) AS "officeDelegations", "startPeriod", "endPeriod", "createdAt", "updatedAt"`;

let schemaReady: Promise<void> | null = null;

export async function ensureSkuReminderSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool
      .query(
        `ALTER TABLE "SkuReminder"
         ADD COLUMN IF NOT EXISTS "officeDelegations" jsonb NOT NULL DEFAULT '{}'::jsonb`,
      )
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}

export async function syncSkuReminderCatalog(
  skus: string[],
  periodStart: Date,
  periodEnd: Date | null,
): Promise<void> {
  await syncSkuReminderCatalogForOffice(
    null,
    skus,
    periodStart,
    periodEnd,
  );
}

export async function syncSkuReminderCatalogForOffice(
  office: string | null,
  skus: string[],
  periodStart: Date,
  periodEnd: Date | null,
): Promise<void> {
  await ensureSkuReminderSchema();
  const cleanOffice = office?.trim() || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM "SkuReminder"
       WHERE sku <> ALL($1::text[])`,
      [skus],
    );

    if (cleanOffice) {
      await client.query(
        `INSERT INTO "SkuReminder" (
           id,
           sku,
           "resolvedOffices",
           "officeDelegations",
           "startPeriod",
           "endPeriod",
           "createdAt",
           "updatedAt"
         )
         SELECT gen_random_uuid(), x.sku, '{}', '{}'::jsonb, $2, $3, NOW(), NOW()
         FROM unnest($1::text[]) AS x(sku)
         ON CONFLICT (sku) DO UPDATE SET
           "resolvedOffices" = array_remove("SkuReminder"."resolvedOffices", $4),
           "officeDelegations" = COALESCE("SkuReminder"."officeDelegations", '{}'::jsonb) - $4,
           "startPeriod" = EXCLUDED."startPeriod",
           "endPeriod" = EXCLUDED."endPeriod",
           "updatedAt" = NOW()`,
        [skus, periodStart, periodEnd, cleanOffice],
      );
    } else {
      await client.query(
        `INSERT INTO "SkuReminder" (
           id,
           sku,
           "resolvedOffices",
           "officeDelegations",
           "startPeriod",
           "endPeriod",
           "createdAt",
           "updatedAt"
         )
         SELECT gen_random_uuid(), x.sku, '{}', '{}'::jsonb, $2, $3, NOW(), NOW()
         FROM unnest($1::text[]) AS x(sku)
         ON CONFLICT (sku) DO UPDATE SET
           "resolvedOffices" = '{}',
           "officeDelegations" = '{}'::jsonb,
           "startPeriod" = EXCLUDED."startPeriod",
           "endPeriod" = EXCLUDED."endPeriod",
           "updatedAt" = NOW()`,
        [skus, periodStart, periodEnd],
      );
    }

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
  await ensureSkuReminderSchema();
  if (!office || mode === "all") {
    const result = await pool.query(
      `SELECT ${SELECT_FIELDS}
       FROM "SkuReminder"
       ORDER BY sku ASC`,
    );
    return result.rows.map((row) => mapSkuReminderRow(row));
  }

  const result = await pool.query(
    `SELECT ${SELECT_FIELDS}
     FROM "SkuReminder"
     WHERE NOT ($1 = ANY("resolvedOffices"))
     ORDER BY sku ASC`,
    [office],
  );
  return result.rows.map((row) => mapSkuReminderRow(row));
}

export async function getSkuReminderById(
  id: string,
): Promise<SkuReminderRow | null> {
  await ensureSkuReminderSchema();
  const result = await pool.query(
    `SELECT ${SELECT_FIELDS}
     FROM "SkuReminder"
     WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapSkuReminderRow(row) : null;
}

export async function delegateSkuReminder(
  id: string,
  office: string,
  delegatedTo: string | null,
  delegatedBy: string | null,
): Promise<SkuReminderRow | null> {
  await ensureSkuReminderSchema();
  const cleanOffice = office.trim();
  const target = delegatedTo?.trim() || null;
  const approver = delegatedBy?.trim() || null;

  const result = await pool.query(
    `UPDATE "SkuReminder"
     SET "officeDelegations" = CASE
       WHEN $3 IS NULL THEN COALESCE("officeDelegations", '{}'::jsonb) - $2
       ELSE jsonb_set(
         COALESCE("officeDelegations", '{}'::jsonb),
         ARRAY[$2],
         jsonb_build_object(
           'delegatedTo', to_jsonb($3::text),
           'delegatedBy', to_jsonb($4::text),
           'delegatedAt', to_jsonb(NOW()::timestamptz::text)
         ),
         true
       )
     END,
     "updatedAt" = NOW()
     WHERE id = $1
     RETURNING ${SELECT_FIELDS}`,
    [id, cleanOffice, target, approver],
  );

  const row = result.rows[0];
  return row ? mapSkuReminderRow(row) : null;
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

/** Mark many SKUs resolved for one office (used to hide qty < 1). */
export async function markManySkuRemindersResolved(
  skus: string[],
  office: string,
): Promise<number> {
  const cleanOffice = office.trim();
  const cleanSkus = [
    ...new Set(skus.map((sku) => sku.trim()).filter(Boolean)),
  ];
  if (!cleanOffice || cleanSkus.length === 0) return 0;

  await ensureSkuReminderSchema();
  const result = await pool.query(
    `UPDATE "SkuReminder"
     SET "resolvedOffices" = CASE
       WHEN $2 = ANY("resolvedOffices") THEN "resolvedOffices"
       ELSE array_append("resolvedOffices", $2)
     END,
     "updatedAt" = NOW()
     WHERE sku = ANY($1::text[])`,
    [cleanSkus, cleanOffice],
  );
  return result.rowCount ?? 0;
}
