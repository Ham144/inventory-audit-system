import { randomUUID } from "crypto";
import { pool } from "../config/db.js";

export type ScanQtyApprovalRow = {
  id: string;
  sku: string;
  rak: number;
  locationCode: string;
  scanLogId: string;
  approvedQty: number;
  approvedBy: string;
  approvedAt: Date;
  sessionId: string;
};

export function approvalGroupKey(
  sessionId: string,
  sku: string,
  rak: number,
  locationCode: string,
) {
  return `${sessionId}|${sku}|${rak}|${locationCode}`;
}

export function navAggregateKey(
  sessionId: string,
  sku: string,
  locationCode: string,
) {
  return `${sessionId}|${sku}|${locationCode}`;
}

type ScanGroup = {
  id: string;
  sessionId: string;
  sku: string;
  rak: number;
  locationCode: string;
  qty: number;
  createdAt: Date;
};

type SessionScopeWhere =
  | { sessionId: string }
  | { sessionId: { in: string[] } };

function scopeClause(
  where: SessionScopeWhere,
  alias = "",
): { sql: string; params: string[] } {
  const col = alias ? `${alias}."sessionId"` : `"sessionId"`;
  if ("sessionId" in where && typeof where.sessionId === "string") {
    return { sql: `${col} = $1`, params: [where.sessionId] };
  }
  const ids = (where as { sessionId: { in: string[] } }).sessionId.in;
  if (ids.length === 0) {
    return { sql: "1 = 0", params: [] };
  }
  const placeholders = ids.map((_: string, i: number) => `$${i + 1}`).join(", ");
  return { sql: `${col} IN (${placeholders})`, params: ids };
}

export async function findScanQtyApprovals(
  where: SessionScopeWhere,
): Promise<ScanQtyApprovalRow[]> {
  const { sql, params } = scopeClause(where);
  const result = await pool.query<ScanQtyApprovalRow>(
    `SELECT id, sku, rak, "locationCode", "scanLogId", "approvedQty", "approvedBy", "approvedAt", "sessionId"
     FROM "ScanQtyApproval"
     WHERE ${sql}`,
    params,
  );
  return result.rows;
}

export async function upsertScanQtyApproval(input: {
  sessionId: string;
  sku: string;
  rak: number;
  locationCode: string;
  scanLogId: string;
  approvedQty: number;
  approvedBy: string;
}): Promise<ScanQtyApprovalRow> {
  const id = randomUUID();
  const result = await pool.query<ScanQtyApprovalRow>(
    `INSERT INTO "ScanQtyApproval" (
      id, sku, rak, "locationCode", "scanLogId", "approvedQty", "approvedBy", "sessionId"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT ("sessionId", sku, rak, "locationCode")
    DO UPDATE SET
      "scanLogId" = EXCLUDED."scanLogId",
      "approvedQty" = EXCLUDED."approvedQty",
      "approvedBy" = EXCLUDED."approvedBy",
      "approvedAt" = CURRENT_TIMESTAMP
    RETURNING id, sku, rak, "locationCode", "scanLogId", "approvedQty", "approvedBy", "approvedAt", "sessionId"`,
    [
      id,
      input.sku,
      input.rak,
      input.locationCode,
      input.scanLogId,
      input.approvedQty,
      input.approvedBy,
      input.sessionId,
    ],
  );
  return result.rows[0];
}

export async function deleteScanQtyApprovals(where: SessionScopeWhere) {
  const { sql, params } = scopeClause(where);
  await pool.query(`DELETE FROM "ScanQtyApproval" WHERE ${sql}`, params);
}

export async function tryAutoApproveUnanimousGroup(
  groupScans: ScanGroup[],
  approvedBy = "system",
) {
  if (groupScans.length === 0) return null;

  const qtySet = new Set(groupScans.map((s) => s.qty));
  if (qtySet.size > 1) return null;

  const latest = [...groupScans].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];

  return upsertScanQtyApproval({
    sessionId: latest.sessionId,
    sku: latest.sku,
    rak: latest.rak,
    locationCode: latest.locationCode,
    scanLogId: latest.id,
    approvedQty: latest.qty,
    approvedBy,
  });
}

export async function sumApprovedQtyForSkuLocation(
  sessionId: string,
  sku: string,
  locationCode: string,
) {
  const result = await pool.query<{ total: string | null }>(
    `SELECT COALESCE(SUM("approvedQty"), 0)::text AS total
     FROM "ScanQtyApproval"
     WHERE "sessionId" = $1 AND sku = $2 AND "locationCode" = $3`,
    [sessionId, sku, locationCode],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function countRakStatsForSkuLocation(
  sessionId: string,
  sku: string,
  locationCode: string,
) {
  const [scansResult, approvalsResult] = await Promise.all([
    pool.query<{ rak: number }>(
      `SELECT DISTINCT rak FROM "ScanLog"
       WHERE "sessionId" = $1 AND sku = $2 AND "locationCode" = $3`,
      [sessionId, sku, locationCode],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ScanQtyApproval"
       WHERE "sessionId" = $1 AND sku = $2 AND "locationCode" = $3`,
      [sessionId, sku, locationCode],
    ),
  ]);

  const raksWithScans = scansResult.rows.length;
  const resolvedRakCount = Number(approvalsResult.rows[0]?.count ?? 0);
  const pendingRakCount = Math.max(0, raksWithScans - resolvedRakCount);

  return { resolvedRakCount, pendingRakCount };
}
