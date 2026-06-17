import express, { type Request, type Response } from "express";
import axios from "axios";
import { prisma } from "../config/db.js";
import {
  filterNavCompareRows,
  filterScanCompareRows,
  parseCompareQueryFilters,
} from "../utils/compare-filters.js";
import {
  approvalGroupKey,
  countRakStatsForSkuLocation,
  findScanQtyApprovals,
  navAggregateKey,
  sumApprovedQtyForSkuLocation,
  tryAutoApproveUnanimousGroup,
  upsertScanQtyApproval,
  type ScanQtyApprovalRow,
} from "../utils/scan-approval.js";
import { resolveStockQty, type StockResponse } from "../types/catalog.js";

const databaseCenter = () =>
  process.env.DATABASE_CENTER ?? "http://192.168.169.12:7047";

type SessionScopeWhere =
  | { sessionId: string }
  | { sessionId: { in: string[] } };

async function getOrCreateActiveSession(locationCode: string) {
  let session = await prisma.opnameSession.findFirst({
    where: {
      locationCode,
      status: "ONGOING",
    },
  });

  if (!session) {
    session = await prisma.opnameSession.create({
      data: {
        name: `Sesi Opname - Lokasi ${locationCode}`,
        locationCode,
        status: "ONGOING",
      },
    });
  }

  return session;
}

async function sessionScopeWhere(
  locationCode: string,
): Promise<SessionScopeWhere> {
  if (locationCode === "Semua") {
    const activeSessions = await prisma.opnameSession.findMany({
      where: { status: "ONGOING" },
    });
    const sessionIds = activeSessions.map((s: { id: string }) => s.id);
    return { sessionId: { in: sessionIds } };
  }

  const session = await getOrCreateActiveSession(locationCode);
  return { sessionId: session.id };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function resolveApprover(req: Request): string {
  const user = (req as Request & {
    user?: { username?: string; usernameLdap?: string };
  }).user;
  return user?.username ?? user?.usernameLdap ?? "admin";
}

async function fetchNavStockQty(
  sku: string,
  locationCode: string,
  req: Request,
): Promise<number> {
  const response = await axios.get<StockResponse>(
    `${databaseCenter()}/api/v1/product/getStock`,
    {
      params: { No: sku, locationCode },
      headers: {
        cookie: req.headers.cookie ?? "",
      },
      validateStatus: () => true,
    },
  );

  if (response.status >= 400) {
    throw new Error(`getStock failed (${response.status})`);
  }

  return resolveStockQty(response.data);
}

async function buildNavRow(
  item: {
    id: string;
    sku: string;
    name: string;
    systemQty: number;
    status: string;
    updatedAt: Date;
    sessionId: string;
    session: { locationCode: string };
  },
  rakStats?: { resolvedRakCount: number; pendingRakCount: number },
  physicalQtyOverride?: number,
) {
  const locationCode = item.session.locationCode;
  const physicalQty =
    physicalQtyOverride ??
    (await sumApprovedQtyForSkuLocation(item.sessionId, item.sku, locationCode));
  const stats =
    rakStats ??
    (await countRakStatsForSkuLocation(
      item.sessionId,
      item.sku,
      locationCode,
    ));

  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    physicalQty,
    systemQty: item.systemQty,
    status: item.status.toLowerCase(),
    locationCode,
    updatedAt: item.updatedAt.toISOString(),
    resolvedRakCount: stats.resolvedRakCount,
    pendingRakCount: stats.pendingRakCount,
  };
}

async function buildScanCompareRows(whereClause: SessionScopeWhere) {
  const [scans, approvals] = await Promise.all([
    prisma.scanLog.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    }),
    findScanQtyApprovals(whereClause),
  ]);

  const approvalByKey = new Map<string, ScanQtyApprovalRow>(
    approvals.map((a: ScanQtyApprovalRow) => [
      approvalGroupKey(a.sessionId, a.sku, a.rak, a.locationCode),
      a,
    ]),
  );

  const groups = new Map<string, typeof scans>();

  for (const scan of scans) {
    const key = approvalGroupKey(
      scan.sessionId,
      scan.sku,
      scan.rak,
      scan.locationCode,
    );
    const existing = groups.get(key);
    if (existing) {
      existing.push(scan);
    } else {
      groups.set(key, [scan]);
    }
  }

  const rows = [];

  for (const groupScans of groups.values()) {
    const first = groupScans[0];
    const key = approvalGroupKey(
      first.sessionId,
      first.sku,
      first.rak,
      first.locationCode,
    );
    const qtySet = new Set(groupScans.map((s: (typeof groupScans)[number]) => s.qty));
    const match = qtySet.size <= 1;

    let approval: ScanQtyApprovalRow | null | undefined =
      approvalByKey.get(key);

    if (match && !approval) {
      approval = await tryAutoApproveUnanimousGroup(groupScans);
      if (approval) {
        approvalByKey.set(key, approval);
      }
    }

    const resolved = Boolean(approval);
    const approvedQty = approval?.approvedQty ?? null;
    const approvedScanId = approval?.scanLogId ?? null;
    const approvedBy = approval?.approvedBy ?? null;

    rows.push({
      sku: first.sku,
      name: first.name,
      rak: first.rak,
      locationCode: first.locationCode,
      match,
      resolved,
      approvedQty,
      approvedScanId,
      approvedBy,
      scans: groupScans.map((s: (typeof groupScans)[number]) => ({
        id: s.id,
        qty: s.qty,
        operator: s.operator,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  }

  return rows;
}

async function buildNavCompareRows(whereClause: SessionScopeWhere) {
  const items = await prisma.compareItem.findMany({
    where: whereClause,
    include: {
      session: { select: { locationCode: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const [approvals, scans] = await Promise.all([
    findScanQtyApprovals(whereClause),
    prisma.scanLog.findMany({
      where: whereClause,
      select: { sessionId: true, sku: true, locationCode: true, rak: true },
    }),
  ]);

  const physicalQtyByKey = new Map<string, number>();
  const resolvedRakByKey = new Map<string, number>();
  const raksWithScansByKey = new Map<string, Set<number>>();

  for (const scan of scans) {
    const key = navAggregateKey(scan.sessionId, scan.sku, scan.locationCode);
    if (!raksWithScansByKey.has(key)) {
      raksWithScansByKey.set(key, new Set());
    }
    raksWithScansByKey.get(key)!.add(scan.rak);
  }

  for (const approval of approvals) {
    const key = navAggregateKey(
      approval.sessionId,
      approval.sku,
      approval.locationCode,
    );
    physicalQtyByKey.set(
      key,
      (physicalQtyByKey.get(key) ?? 0) + approval.approvedQty,
    );
    resolvedRakByKey.set(key, (resolvedRakByKey.get(key) ?? 0) + 1);
  }

  return Promise.all(
    items.map((item: (typeof items)[number]) => {
      const key = navAggregateKey(
        item.sessionId,
        item.sku,
        item.session.locationCode,
      );
      const raksWithScans = raksWithScansByKey.get(key)?.size ?? 0;
      const resolvedRakCount = resolvedRakByKey.get(key) ?? 0;
      const pendingRakCount = Math.max(0, raksWithScans - resolvedRakCount);
      const physicalQty = physicalQtyByKey.get(key) ?? 0;

      return buildNavRow(
        item,
        { resolvedRakCount, pendingRakCount },
        physicalQty,
      );
    }),
  );
}

async function skusForRakFilter(
  whereClause: SessionScopeWhere,
  rak: string,
): Promise<Set<string>> {
  if (rak === "Semua") {
    return new Set();
  }

  const scans: { sku: string }[] = await prisma.scanLog.findMany({
    where: {
      ...whereClause,
      rak: Number(rak),
    },
    select: { sku: true },
    distinct: ["sku"],
  });

  return new Set(scans.map((s) => s.sku));
}

const router = express.Router();

router.get("/scan", async (req: Request, res: Response) => {
  try {
    const filters = parseCompareQueryFilters(req.query);
    const whereClause = await sessionScopeWhere(filters.locationCode);
    const rows = await buildScanCompareRows(whereClause);

    return res.json(filterScanCompareRows(rows, filters));
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.post("/scan/approve", async (req: Request, res: Response) => {
  try {
    const { scanLogId } = req.body as { scanLogId?: string };
    if (!scanLogId) {
      return res.status(400).json({ error: "scanLogId wajib diisi" });
    }

    const scan = await prisma.scanLog.findUnique({
      where: { id: scanLogId },
    });

    if (!scan) {
      return res.status(404).json({ error: "Scan tidak ditemukan" });
    }

    const session = await prisma.opnameSession.findUnique({
      where: { id: scan.sessionId },
    });

    if (!session || session.status !== "ONGOING") {
      return res.status(400).json({ error: "Sesi opname tidak aktif" });
    }

    await upsertScanQtyApproval({
      sessionId: scan.sessionId,
      sku: scan.sku,
      rak: scan.rak,
      locationCode: scan.locationCode,
      scanLogId: scan.id,
      approvedQty: scan.qty,
      approvedBy: resolveApprover(req),
    });

    const rows = await buildScanCompareRows({ sessionId: scan.sessionId });
    const row = rows.find(
      (r) =>
        r.sku === scan.sku &&
        r.rak === scan.rak &&
        r.locationCode === scan.locationCode,
    );

    return res.json(row ?? null);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.get("/nav", async (req: Request, res: Response) => {
  try {
    const filters = parseCompareQueryFilters(req.query);
    const whereClause = await sessionScopeWhere(filters.locationCode);

    const rows = await buildNavCompareRows(whereClause);
    const skusWithRak = await skusForRakFilter(whereClause, filters.rak);
    const filtered = filterNavCompareRows(rows, filters, skusWithRak);

    return res.json(filtered);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.post("/nav/:compareItemId/check", async (req: Request, res: Response) => {
  try {
    const compareItemId = String(req.params.compareItemId);

    const item = await prisma.compareItem.findUnique({
      where: { id: compareItemId },
      include: { session: { select: { locationCode: true } } },
    });

    if (!item) {
      return res.status(404).json({ error: "Compare item tidak ditemukan" });
    }

    const locationCode = item.session.locationCode;
    const physicalQty = await sumApprovedQtyForSkuLocation(
      item.sessionId,
      item.sku,
      locationCode,
    );
    const systemQty = await fetchNavStockQty(item.sku, locationCode, req);
    const status = physicalQty === systemQty ? "SESUAI" : "SELISIH";

    const updated = await prisma.compareItem.update({
      where: { id: item.id },
      data: {
        physicalQty,
        systemQty,
        status,
        updatedAt: new Date(),
      },
      include: { session: { select: { locationCode: true } } },
    });

    const row = await buildNavRow(updated);
    return res.json(row);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

export default router;
