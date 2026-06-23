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
  deleteGroupApproval,
  findScanQtyApprovals,
  groupHasOperatorQtyConflict,
  navAggregateKey,
  sumApprovedQtyForSkuLocation,
  toOperatorScanEntries,
  toScanGroups,
  toScanGroup,
  readOffice,
  tryAutoApproveUnanimousGroup,
  upsertScanQtyApproval,
  type ScanQtyApprovalRow,
} from "../utils/scan-approval.js";
import { resolveStockQty, type StockResponse } from "../types/catalog.js";
import {
  canAccessAdmin,
  resolveAppUser,
  resolveOfficeFilter,
} from "../utils/app-user.js";

const databaseCenter = () => process.env.DATABASE_CENTER as string;

type SessionScopeWhere =
  | { sessionId: string }
  | { sessionId: { in: string[] } };

const SESSION_OFFICE_SELECT = { office: true };

async function getOrCreateActiveSession(office: string) {
  let session = await prisma.opnameSession.findFirst({
    where: {
      office,
      status: "ONGOING",
    } as never,
  });

  if (!session) {
    session = await prisma.opnameSession.create({
      data: {
        name: `Sesi Opname - Lokasi ${office}`,
        office,
        status: "ONGOING",
      } as never,
    });
  }

  return session;
}

async function sessionScopeWhere(office: string): Promise<SessionScopeWhere> {
  if (office === "Semua") {
    const activeSessions = await prisma.opnameSession.findMany({
      where: { status: "ONGOING" },
    });
    const sessionIds = activeSessions.map((s: { id: string }) => s.id);
    return { sessionId: { in: sessionIds } };
  }

  const session = await getOrCreateActiveSession(office);
  return { sessionId: session.id };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function resolveApprover(req: Request): string {
  const user = (
    req as Request & {
      user?: { username?: string; usernameLdap?: string };
    }
  ).user;
  return user?.username ?? user?.usernameLdap ?? "admin";
}

async function fetchNavStockQty(
  sku: string,
  office: string,
  req: Request,
): Promise<number> {
  const response = await axios.get<StockResponse>(
    `${databaseCenter()}/api/v1/product/getStock`,
    {
      params: { No: sku, locationCode: office },
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
    session?: { office?: string; locationCode?: string };
  },
  rakStats?: { resolvedRakCount: number; pendingRakCount: number },
  physicalQtyOverride?: number,
) {
  const office = readOffice(item.session ?? {});
  const physicalQty =
    physicalQtyOverride ??
    (await sumApprovedQtyForSkuLocation(item.sessionId, item.sku, office));
  const stats =
    rakStats ??
    (await countRakStatsForSkuLocation(item.sessionId, item.sku, office));

  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    physicalQty,
    systemQty: item.systemQty,
    status: item.status.toLowerCase(),
    office,
    updatedAt: item.updatedAt.toISOString(),
    resolvedRakCount: stats.resolvedRakCount,
    pendingRakCount: stats.pendingRakCount,
  };
}

async function reconcileStaleApprovals(whereClause: SessionScopeWhere) {
  const scans = await prisma.scanLog.findMany({ where: whereClause });
  const groups = new Map<string, typeof scans>();

  for (const scan of scans) {
    const normalized = toScanGroup(scan);
    const key = approvalGroupKey(
      normalized.sessionId,
      normalized.sku,
      normalized.rak,
      normalized.office,
    );
    const existing = groups.get(key);
    if (existing) {
      existing.push(scan);
    } else {
      groups.set(key, [scan]);
    }
  }

  for (const groupScans of groups.values()) {
    if (!groupHasOperatorQtyConflict(toScanGroups(groupScans))) continue;
    const first = toScanGroups(groupScans)[0];
    await deleteGroupApproval(
      first.sessionId,
      first.sku,
      first.rak,
      first.office,
    );
  }
}

async function buildScanCompareRows(whereClause: SessionScopeWhere) {
  await reconcileStaleApprovals(whereClause);
  const [scans, approvals] = await Promise.all([
    prisma.scanLog.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    }),
    findScanQtyApprovals(whereClause),
  ]);

  const approvalByKey = new Map<string, ScanQtyApprovalRow>(
    approvals.map((a: ScanQtyApprovalRow) => [
      approvalGroupKey(a.sessionId, a.sku, a.rak, a.office),
      a,
    ]),
  );

  const groups = new Map<string, typeof scans>();

  for (const scan of scans) {
    const normalized = toScanGroup(scan);
    const key = approvalGroupKey(
      normalized.sessionId,
      normalized.sku,
      normalized.rak,
      normalized.office,
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
    const normalized = toScanGroups(groupScans);
    const first = normalized[0];
    const key = approvalGroupKey(
      first.sessionId,
      first.sku,
      first.rak,
      first.office,
    );
    const match = !groupHasOperatorQtyConflict(normalized);

    let approval: ScanQtyApprovalRow | null | undefined =
      approvalByKey.get(key);

    if (!match && approval) {
      await deleteGroupApproval(
        first.sessionId,
        first.sku,
        first.rak,
        first.office,
      );
      approval = undefined;
    }

    if (match && !approval) {
      approval = await tryAutoApproveUnanimousGroup(normalized);
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
      name: groupScans[0].name,
      rak: first.rak,
      office: first.office,
      match,
      resolved,
      approvedQty,
      approvedScanId,
      approvedBy,
      scans: toOperatorScanEntries(normalized),
    });
  }

  return rows;
}

async function buildNavCompareRows(whereClause: SessionScopeWhere) {
  await reconcileStaleApprovals(whereClause);

  const items = await prisma.compareItem.findMany({
    where: whereClause,
    include: {
      session: { select: SESSION_OFFICE_SELECT },
    },
    orderBy: { updatedAt: "desc" },
  });

  const [approvals, scans] = await Promise.all([
    findScanQtyApprovals(whereClause),
    prisma.scanLog.findMany({
      where: whereClause,
      select: {
        sessionId: true,
        sku: true,

        office: true,
        rak: true,
      } as never,
    }),
  ]);

  const physicalQtyByKey = new Map<string, number>();
  const resolvedRakByKey = new Map<string, number>();
  const raksWithScansByKey = new Map<string, Set<number>>();

  for (const scan of scans as Array<{
    sessionId: string;
    sku: string;
    rak: number;
    office?: string;
    locationCode?: string;
  }>) {
    const office = readOffice(scan);
    const key = navAggregateKey(scan.sessionId, scan.sku, office);
    if (!raksWithScansByKey.has(key)) {
      raksWithScansByKey.set(key, new Set());
    }
    raksWithScansByKey.get(key)!.add(scan.rak);
  }

  for (const approval of approvals) {
    const key = navAggregateKey(
      approval.sessionId,
      approval.sku,
      approval.office,
    );
    physicalQtyByKey.set(
      key,
      (physicalQtyByKey.get(key) ?? 0) + approval.approvedQty,
    );
    resolvedRakByKey.set(key, (resolvedRakByKey.get(key) ?? 0) + 1);
  }

  return Promise.all(
    items.map((item: (typeof items)[number]) => {
      const office = readOffice(item.session);
      const key = navAggregateKey(item.sessionId, item.sku, office);
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

async function scopedCompareFilters(req: Request) {
  const filters = parseCompareQueryFilters(req.query);
  const appUser = await resolveAppUser(
    req as Request & { user?: Record<string, unknown> },
  );
  const office = resolveOfficeFilter(appUser, filters.office);
  return { ...filters, office };
}

router.get("/scan", async (req: Request, res: Response) => {
  try {
    const filters = await scopedCompareFilters(req);
    const whereClause = await sessionScopeWhere(filters.office);
    const rows = await buildScanCompareRows(whereClause);

    return res.json(filterScanCompareRows(rows, filters));
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.post("/scan/approve", async (req: Request, res: Response) => {
  try {
    const appUser = await resolveAppUser(
      req as Request & { user?: Record<string, unknown> },
    );
    if (!canAccessAdmin(appUser)) {
      return res.status(403).json({
        error: "Hanya admin atau owner yang dapat menetapkan qty",
      });
    }

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

    const scanGroup = toScanGroup(scan);

    await upsertScanQtyApproval({
      sessionId: scanGroup.sessionId,
      sku: scanGroup.sku,
      rak: scanGroup.rak,
      office: scanGroup.office,
      scanLogId: scanGroup.id,
      approvedQty: scan.qty,
      approvedBy: resolveApprover(req),
    });

    const rows = await buildScanCompareRows({ sessionId: scan.sessionId });
    const row = rows.find(
      (r) =>
        r.sku === scanGroup.sku &&
        r.rak === scanGroup.rak &&
        r.office === scanGroup.office,
    );

    return res.json(row ?? null);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.get("/nav", async (req: Request, res: Response) => {
  try {
    const filters = await scopedCompareFilters(req);
    const whereClause = await sessionScopeWhere(filters.office);

    const rows = await buildNavCompareRows(whereClause);
    const skusWithRak = await skusForRakFilter(whereClause, filters.rak);
    const filtered = filterNavCompareRows(rows, filters, skusWithRak);

    return res.json(filtered);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.post(
  "/nav/:compareItemId/check",
  async (req: Request, res: Response) => {
    try {
      const compareItemId = String(req.params.compareItemId);

      const item = await prisma.compareItem.findUnique({
        where: { id: compareItemId },
        include: { session: { select: SESSION_OFFICE_SELECT } },
      });

      if (!item) {
        return res.status(404).json({ error: "Compare item tidak ditemukan" });
      }

      const office = readOffice(item.session);
      const physicalQty = await sumApprovedQtyForSkuLocation(
        item.sessionId,
        item.sku,
        office,
      );
      const systemQty = await fetchNavStockQty(item.sku, office, req);
      const status = physicalQty === systemQty ? "SESUAI" : "SELISIH";

      const updated = await prisma.compareItem.update({
        where: { id: item.id },
        data: {
          physicalQty,
          systemQty,
          status,
          updatedAt: new Date(),
        },
        include: { session: { select: SESSION_OFFICE_SELECT } },
      });

      const row = await buildNavRow(updated);
      return res.json(row);
    } catch (error: unknown) {
      return res.status(500).json({ error: errorMessage(error) });
    }
  },
);

export default router;
