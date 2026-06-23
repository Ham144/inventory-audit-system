import { randomUUID } from "crypto";
import { pool } from "../config/db.js";

export type ScanQtyApprovalRow = {
  id: string;
  sku: string;
  rak: number;
  office: string;
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
  office: string,
) {
  return `${sessionId}|${sku}|${rak}|${office}`;
}

export function navAggregateKey(
  sessionId: string,
  sku: string,
  office: string,
) {
  return `${sessionId}|${sku}|${office}`;
}

export type ScanGroup = {
  id: string;
  sessionId: string;
  sku: string;
  rak: number;
  office: string;
  qty: number;
  operator: string;
  createdAt: Date;
};

export type ScanLogLike = {
  id: string;
  sessionId: string;
  sku: string;
  rak: number;
  qty: number;
  operator: string;
  createdAt: Date;
  office?: string;
  locationCode?: string;
};

export function toScanGroup(scan: ScanLogLike): ScanGroup {
  const office = scan.office ?? scan.locationCode;
  if (!office) {
    throw new Error("Scan row missing office");
  }
  return {
    id: scan.id,
    sessionId: scan.sessionId,
    sku: scan.sku,
    rak: scan.rak,
    office,
    qty: scan.qty,
    operator: scan.operator,
    createdAt: scan.createdAt,
  };
}

export function toScanGroups(scans: ScanLogLike[]): ScanGroup[] {
  return scans.map(toScanGroup);
}

export function readOffice(row: {
  office?: string;
  locationCode?: string;
}): string {
  return row.office ?? row.locationCode ?? "01";
}

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
  const placeholders = ids
    .map((_: string, i: number) => `$${i + 1}`)
    .join(", ");
  return { sql: `${col} IN (${placeholders})`, params: ids };
}

export function aggregateQtyByOperator(groupScans: ScanGroup[]) {
  const map = new Map<string, { qty: number; latestScan: ScanGroup }>();
  for (const s of groupScans) {
    const existing = map.get(s.operator);
    if (!existing) {
      map.set(s.operator, { qty: s.qty, latestScan: s });
      continue;
    }
    existing.qty += s.qty;
    if (s.createdAt > existing.latestScan.createdAt) {
      existing.latestScan = s;
    }
  }
  return map;
}

export function groupHasOperatorQtyConflict(groupScans: ScanGroup[]) {
  const byOperator = aggregateQtyByOperator(groupScans);
  if (byOperator.size <= 1) return false;
  const qtyValues = [...byOperator.values()].map((v) => v.qty);
  return new Set(qtyValues).size > 1;
}

export function toOperatorScanEntries(groupScans: ScanGroup[]) {
  const byOperator = aggregateQtyByOperator(groupScans);
  return [...byOperator.entries()].map(([operator, { qty, latestScan }]) => ({
    id: latestScan.id,
    qty,
    operator,
    createdAt: latestScan.createdAt.toISOString(),
  }));
}

export async function findScanQtyApprovals(
  where: SessionScopeWhere,
): Promise<ScanQtyApprovalRow[]> {
  const { sql, params } = scopeClause(where);
  const result = await pool.query<ScanQtyApprovalRow>(
    `SELECT id, sku, rak, "office", "scanLogId", "approvedQty", "approvedBy", "approvedAt", "sessionId"
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
  office: string;
  scanLogId: string;
  approvedQty: number;
  approvedBy: string;
}): Promise<ScanQtyApprovalRow> {
  const id = randomUUID();
  const result = await pool.query<ScanQtyApprovalRow>(
    `INSERT INTO "ScanQtyApproval" (
      id, sku, rak, "office", "scanLogId", "approvedQty", "approvedBy", "sessionId"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT ("sessionId", sku, rak, "office")
    DO UPDATE SET
      "scanLogId" = EXCLUDED."scanLogId",
      "approvedQty" = EXCLUDED."approvedQty",
      "approvedBy" = EXCLUDED."approvedBy",
      "approvedAt" = CURRENT_TIMESTAMP
    RETURNING id, sku, rak, "office", "scanLogId", "approvedQty", "approvedBy", "approvedAt", "sessionId"`,
    [
      id,
      input.sku,
      input.rak,
      input.office,
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

export async function deleteGroupApproval(
  sessionId: string,
  sku: string,
  rak: number,
  office: string,
) {
  await pool.query(
    `DELETE FROM "ScanQtyApproval"
     WHERE "sessionId" = $1 AND sku = $2 AND rak = $3 AND "office" = $4`,
    [sessionId, sku, rak, office],
  );
}

/** Hapus auto-approval system jika operator sudah beda qty (approval stale). */
export async function clearStaleSystemApproval(
  sessionId: string,
  sku: string,
  rak: number,
  office: string,
) {
  await pool.query(
    `DELETE FROM "ScanQtyApproval"
     WHERE "sessionId" = $1 AND sku = $2 AND rak = $3 AND "office" = $4 AND "approvedBy" = 'system'`,
    [sessionId, sku, rak, office],
  );
}

export async function tryAutoApproveUnanimousGroup(
  groupScans: ScanGroup[],
  approvedBy = "system",
) {
  if (groupScans.length === 0) return null;
  if (groupHasOperatorQtyConflict(groupScans)) return null;

  const byOperator = aggregateQtyByOperator(groupScans);
  const unanimousQty = [...byOperator.values()][0].qty;

  const latest = [...groupScans].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];

  return upsertScanQtyApproval({
    sessionId: latest.sessionId,
    sku: latest.sku,
    rak: latest.rak,
    office: latest.office,
    scanLogId: latest.id,
    approvedQty: unanimousQty,
    approvedBy,
  });
}

export async function reconcileApprovalAfterGroupChange(
  groupScans: ScanGroup[],
) {
  if (groupScans.length === 0) return null;

  const first = groupScans[0];

  if (groupHasOperatorQtyConflict(groupScans)) {
    await deleteGroupApproval(
      first.sessionId,
      first.sku,
      first.rak,
      first.office,
    );
    return null;
  }

  return tryAutoApproveUnanimousGroup(groupScans);
}

export async function sumApprovedQtyForSkuLocation(
  sessionId: string,
  sku: string,
  office: string,
) {
  const result = await pool.query<{ total: string | null }>(
    `SELECT COALESCE(SUM("approvedQty"), 0)::text AS total
     FROM "ScanQtyApproval"
     WHERE "sessionId" = $1 AND sku = $2 AND "office" = $3`,
    [sessionId, sku, office],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function countRakStatsForSkuLocation(
  sessionId: string,
  sku: string,
  office: string,
) {
  const [scansResult, approvalsResult] = await Promise.all([
    pool.query<{ rak: number }>(
      `SELECT DISTINCT rak FROM "ScanLog"
       WHERE "sessionId" = $1 AND sku = $2 AND "office" = $3`,
      [sessionId, sku, office],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ScanQtyApproval"
       WHERE "sessionId" = $1 AND sku = $2 AND "office" = $3`,
      [sessionId, sku, office],
    ),
  ]);

  const raksWithScans = scansResult.rows.length;
  const resolvedRakCount = Number(approvalsResult.rows[0]?.count ?? 0);
  const pendingRakCount = Math.max(0, raksWithScans - resolvedRakCount);

  return { resolvedRakCount, pendingRakCount };
}
