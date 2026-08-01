import express, { type Request, type Response } from "express";
import axios from "axios";
import { prisma } from "../config/db.js";
import {
  mapOfficeToLocation,
  mapLocationToOfficeAsync,
} from "../utils/office-mapping.js";
import {
  filterNavCompareRows,
  filterScanCompareRows,
  parseCompareQueryFilters,
  validateDateRange,
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
  reconcileApprovalAfterGroupChange,
  toScanGroup,
  readOffice,
  tryAutoApproveUnanimousGroup,
  upsertScanQtyApproval,
  clearStaleSystemApproval,
  type ScanQtyApprovalRow,
} from "../utils/scan-approval.js";
import { resolveStockQty, type InventoryResponse } from "../types/catalog.js";
import {
  canAccessAdmin,
  resolveAppUser,
  resolveOfficeFilter,
} from "../utils/app-user.js";
import { findUserByUsername } from "../utils/user-store.js";

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

async function sessionScopeWhere(
  officeCode: string,
): Promise<SessionScopeWhere> {
  const office =
    officeCode === "Semua"
      ? "Semua"
      : await mapLocationToOfficeAsync(officeCode);

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
  const locationCode = await mapOfficeToLocation(office);
  const url = `${databaseCenter()}/api/v1/inventory/count`;
  console.log(`[DEBUG fetchNavStockQty] Requesting: ${url} with params:`, { No: sku, locationCode });

  const response = await axios.get<InventoryResponse>(
    url,
    {
      params: { No: sku, locationCode },
      headers: {
        cookie: req.headers.cookie ?? "",
      },
      validateStatus: () => true,
    },
  );

  console.log(`[DEBUG fetchNavStockQty] Response Status: ${response.status}`);
  console.log(`[DEBUG fetchNavStockQty] Response Data Type: ${typeof response.data}`);
  console.log(`[DEBUG fetchNavStockQty] Response Data:`, response.data);

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
    note?: string | null;
    updatedAt: Date;
    sessionId: string;
    session?: { office?: string; locationCode?: string };
    finalCorrectionQty?: number | null;
    finalCorrectionBy?: string | null;
    finalCorrectionAt?: Date | null;
    finalCorrectionRak?: number | null;
    delegatedTo?: string | null;
    delegatedBy?: string | null;
    delegatedAt?: Date | null;
  },
  rakStats?: { resolvedRakCount: number; pendingRakCount: number },
  physicalQtyOverride?: number,
) {
  const office = readOffice(item.session ?? {});
  const physicalQty =
    item.finalCorrectionQty !== null && item.finalCorrectionQty !== undefined
      ? item.finalCorrectionQty
      : (physicalQtyOverride ??
         (await sumApprovedQtyForSkuLocation(item.sessionId, item.sku, office)));

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
    sessionId: item.sessionId,
    note: item.note ?? null,
    finalCorrectionQty: item.finalCorrectionQty ?? null,
    finalCorrectionBy: item.finalCorrectionBy ?? null,
    finalCorrectionAt: item.finalCorrectionAt
      ? item.finalCorrectionAt.toISOString()
      : null,
    finalCorrectionRak: item.finalCorrectionRak ?? null,
    delegatedTo: item.delegatedTo ?? null,
    delegatedBy: item.delegatedBy ?? null,
    delegatedAt: item.delegatedAt ? item.delegatedAt.toISOString() : null,
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
    await clearStaleSystemApproval(
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

    if (!match && approval && approval.approvedBy === "system") {
      await clearStaleSystemApproval(
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
      },
    }),
  ]);

  const physicalQtyByKey = new Map<string, number>();
  const raksWithScansByKey = new Map<string, Set<number>>();
  const resolvedRaksByKey = new Map<string, Set<number>>();

  for (const scan of scans) {
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

    if (!resolvedRaksByKey.has(key)) {
      resolvedRaksByKey.set(key, new Set());
    }
    resolvedRaksByKey.get(key)!.add(approval.rak);
  }

  return Promise.all(
    items.map((item: (typeof items)[number]) => {
      const office = readOffice(item.session);
      const key = navAggregateKey(item.sessionId, item.sku, office);

      const allRaks = raksWithScansByKey.get(key) ?? new Set<number>();
      const resolvedRaks = resolvedRaksByKey.get(key) ?? new Set<number>();

      const resolvedRakCount = resolvedRaks.size;
      const pendingRakCount = Math.max(0, allRaks.size - resolvedRakCount);
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

async function navKeysWithScansInDateRange(
  whereClause: SessionScopeWhere,
  dateFrom: string,
  dateTo: string,
): Promise<Set<string>> {
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T23:59:59`);

  const scans = (await prisma.scanLog.findMany({
    where: {
      ...whereClause,
      createdAt: { gte: from, lte: to },
    },
    select: { sessionId: true, sku: true, office: true } as never,
  })) as Array<{
    sessionId: string;
    sku: string;
    office?: string;
    locationCode?: string;
  }>;

  const keys = new Set<string>();
  for (const s of scans) {
    const office = readOffice(s);
    keys.add(navAggregateKey(s.sessionId, s.sku, office));
  }
  return keys;
}

const router = express.Router();

async function scopedCompareFilters(req: Request) {
  const filters = parseCompareQueryFilters(req.query);
  return { ...filters };
}

router.get("/scan", async (req: Request, res: Response) => {
  try {
    const filters = await scopedCompareFilters(req);
    const whereClause = await sessionScopeWhere(filters.office);
    const rows = await buildScanCompareRows(whereClause);
    const filtered = filterScanCompareRows(rows, filters);
    console.log(`[DEBUG SCANS] Returning ${filtered.length} scans for office=${filters.office}, rak=${filters.rak}, search=${filters.search}`);
    return res.json(filtered);
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

async function findScanCompareRowForScan(scan: {
  sessionId: string;
  sku: string;
  rak: number;
  office: string;
}) {
  const rows = await buildScanCompareRows({ sessionId: scan.sessionId });
  return (
    rows.find(
      (r) =>
        r.sku === scan.sku && r.rak === scan.rak && r.office === scan.office,
    ) ?? null
  );
}

async function assertAdminScanMutation(req: Request, scanLogId: string) {
  const appUser = await resolveAppUser(
    req as Request & { user?: Record<string, unknown> },
  );
  if (!canAccessAdmin(appUser)) {
    return {
      ok: false as const,
      status: 403,
      error: "Hanya admin atau owner yang dapat mengubah scan",
    };
  }

  const scan = await prisma.scanLog.findUnique({
    where: { id: scanLogId },
  });
  if (!scan) {
    return { ok: false as const, status: 404, error: "Scan tidak ditemukan" };
  }

  const session = await prisma.opnameSession.findUnique({
    where: { id: scan.sessionId },
  });
  if (!session || session.status !== "ONGOING") {
    return {
      ok: false as const,
      status: 400,
      error: "Sesi opname tidak aktif",
    };
  }

  return { ok: true as const, scan, scanGroup: toScanGroup(scan) };
}

router.patch("/scan/:scanLogId", async (req: Request, res: Response) => {
  try {
    const scanLogId = String(req.params.scanLogId);
    const access = await assertAdminScanMutation(req, scanLogId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const { qty } = req.body as { qty?: number | string };
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum < 0 || !Number.isInteger(qtyNum)) {
      return res
        .status(400)
        .json({ error: "qty harus bilangan bulat non-negatif" });
    }

    const updated = await prisma.scanLog.update({
      where: { id: scanLogId },
      data: { qty: qtyNum },
    });

    const groupScans = await prisma.scanLog.findMany({
      where: {
        sessionId: updated.sessionId,
        sku: updated.sku,
        rak: updated.rak,
        office: access.scanGroup.office,
      },
    });

    await reconcileApprovalAfterGroupChange(toScanGroups(groupScans));

    const row = await findScanCompareRowForScan({
      sessionId: updated.sessionId,
      sku: updated.sku,
      rak: updated.rak,
      office: access.scanGroup.office,
    });

    return res.json(row);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.delete("/scan/:scanLogId", async (req: Request, res: Response) => {
  try {
    const scanLogId = String(req.params.scanLogId);
    const access = await assertAdminScanMutation(req, scanLogId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const { scan, scanGroup } = access;

    await prisma.scanLog.delete({ where: { id: scanLogId } });

    const groupScans = await prisma.scanLog.findMany({
      where: {
        sessionId: scan.sessionId,
        sku: scan.sku,
        rak: scan.rak,
        office: scanGroup.office,
      },
    });

    if (groupScans.length === 0) {
      await deleteGroupApproval(
        scan.sessionId,
        scan.sku,
        scan.rak,
        scanGroup.office,
      );
      return res.json(null);
    }

    await reconcileApprovalAfterGroupChange(toScanGroups(groupScans));

    const row = await findScanCompareRowForScan({
      sessionId: scan.sessionId,
      sku: scan.sku,
      rak: scan.rak,
      office: scanGroup.office,
    });

    return res.json(row);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.get("/nav", async (req: Request, res: Response) => {
  try {
    const filters = await scopedCompareFilters(req);

    const dateErr = validateDateRange(filters.dateFrom, filters.dateTo);
    if (dateErr) {
      return res.status(400).json({ error: dateErr });
    }

    const whereClause = await sessionScopeWhere(filters.office);

    const rows = await buildNavCompareRows(whereClause);
    const skusWithRak = await skusForRakFilter(whereClause, filters.rak);
    let filtered = filterNavCompareRows(rows, filters, skusWithRak);

    if (filters.dateFrom && filters.dateTo) {
      const dateKeys = await navKeysWithScansInDateRange(
        whereClause,
        filters.dateFrom,
        filters.dateTo,
      );
      filtered = filtered.filter((r) =>
        dateKeys.has(
          navAggregateKey(
            (r as typeof r & { sessionId: string }).sessionId,
            r.sku,
            r.office,
          ),
        ),
      );
    }

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

router.patch(
  "/nav/:compareItemId/note",
  async (req: Request, res: Response) => {
    try {
      const appUser = await resolveAppUser(
        req as Request & { user?: Record<string, unknown> },
      );
      if (!canAccessAdmin(appUser)) {
        return res.status(403).json({
          error: "Hanya admin atau owner yang dapat mengubah catatan",
        });
      }

      const compareItemId = String(req.params.compareItemId);
      const { note } = req.body as { note?: string | null };

      const item = await prisma.compareItem.findUnique({
        where: { id: compareItemId },
        include: { session: { select: SESSION_OFFICE_SELECT } },
      });

      if (!item) {
        return res.status(404).json({ error: "Compare item tidak ditemukan" });
      }

      const trimmed =
        typeof note === "string" ? note.trim() : note === null ? "" : undefined;
      if (trimmed === undefined) {
        return res.status(400).json({ error: "note wajib berupa string" });
      }

      const updated = await prisma.compareItem.update({
        where: { id: item.id },
        data: { note: trimmed || null } as never,
        include: { session: { select: SESSION_OFFICE_SELECT } },
      });

      const row = await buildNavRow(updated);
      return res.json(row);
    } catch (error: unknown) {
      return res.status(500).json({ error: errorMessage(error) });
    }
  },
);

// Final Correction: admin directly sets the physicalQty, bypassing rak-level approval logic
router.post(
  "/nav/:compareItemId/final-correction",
  async (req: Request, res: Response) => {
    try {
      const appUser = await resolveAppUser(
        req as Request & { user?: Record<string, unknown> },
      );
      if (!canAccessAdmin(appUser)) {
        return res.status(403).json({
          error: "Hanya admin atau owner yang dapat melakukan koreksi akhir",
        });
      }

      const compareItemId = String(req.params.compareItemId);
      const { physicalQty, rak } = req.body as { physicalQty?: number | string; rak?: number };

      const qtyNum = Number(physicalQty);
      if (!Number.isFinite(qtyNum) || qtyNum < 0 || !Number.isInteger(qtyNum)) {
        return res
          .status(400)
          .json({ error: "physicalQty harus bilangan bulat non-negatif" });
      }

      const item = await prisma.compareItem.findUnique({
        where: { id: compareItemId },
        include: { session: { select: SESSION_OFFICE_SELECT } },
      });

      if (!item) {
        return res.status(404).json({ error: "Compare item tidak ditemukan" });
      }

      const approver = resolveApprover(req);
      const now = new Date();

      // Determine status based on systemQty comparison
      const status = item.status === "BELUM_COMPARE"
        ? "BELUM_COMPARE"
        : qtyNum === item.systemQty
          ? "SESUAI"
          : "SELISIH";

      const updated = await prisma.compareItem.update({
        where: { id: item.id },
        data: {
          physicalQty: qtyNum,
          finalCorrectionQty: qtyNum,
          finalCorrectionBy: approver,
          finalCorrectionAt: now,
          finalCorrectionRak: rak !== undefined && rak !== null ? Number(rak) : null,
          status,
          updatedAt: now,
        } as never,
        include: { session: { select: SESSION_OFFICE_SELECT } },
      });

      const row = await buildNavRow(updated);
      return res.json(row);
    } catch (error: unknown) {
      return res.status(500).json({ error: errorMessage(error) });
    }
  },
);

router.delete(
  "/nav/:compareItemId/final-correction",
  async (req: Request, res: Response) => {
    try {
      const appUser = await resolveAppUser(
        req as Request & { user?: Record<string, unknown> },
      );
      if (!canAccessAdmin(appUser)) {
        return res.status(403).json({
          error: "Hanya admin atau owner yang dapat membatalkan koreksi akhir",
        });
      }

      const compareItemId = String(req.params.compareItemId);
      const item = await prisma.compareItem.findUnique({
        where: { id: compareItemId },
        include: { session: { select: SESSION_OFFICE_SELECT } },
      });

      if (!item) {
        return res.status(404).json({ error: "Compare item tidak ditemukan" });
      }

      const office = readOffice(item.session);
      const originalPhysicalQty = await sumApprovedQtyForSkuLocation(
        item.sessionId,
        item.sku,
        office,
      );

      const status = item.status === "BELUM_COMPARE"
        ? "BELUM_COMPARE"
        : originalPhysicalQty === item.systemQty
          ? "SESUAI"
          : "SELISIH";

      const updated = await prisma.compareItem.update({
        where: { id: item.id },
        data: {
          physicalQty: originalPhysicalQty,
          finalCorrectionQty: null,
          finalCorrectionBy: null,
          finalCorrectionAt: null,
          finalCorrectionRak: null,
          status,
          updatedAt: new Date(),
        } as never,
        include: { session: { select: SESSION_OFFICE_SELECT } },
      });

      const row = await buildNavRow(updated);
      return res.json(row);
    } catch (error: unknown) {
      return res.status(500).json({ error: errorMessage(error) });
    }
  },
);

// Delegation: admin assigns a user to re-check a specific SKU on the selisih page
router.patch(
  "/nav/:compareItemId/delegate",
  async (req: Request, res: Response) => {
    try {
      const appUser = await resolveAppUser(
        req as Request & { user?: Record<string, unknown> },
      );
      if (!canAccessAdmin(appUser)) {
        return res.status(403).json({
          error: "Hanya admin atau owner yang dapat mendelegasikan pengecekan",
        });
      }

      const compareItemId = String(req.params.compareItemId);
      const { delegatedTo } = req.body as { delegatedTo?: string | null };

      const item = await prisma.compareItem.findUnique({
        where: { id: compareItemId },
        include: { session: { select: SESSION_OFFICE_SELECT } },
      });

      if (!item) {
        return res.status(404).json({ error: "Compare item tidak ditemukan" });
      }

      const targetUser = delegatedTo?.trim();
      if (targetUser) {
        const dbUser = await findUserByUsername(targetUser);
        if (!dbUser) {
          return res.status(400).json({ error: "User delegasi tidak ditemukan" });
        }

        const role = dbUser.role?.trim().toLowerCase();
        if (role !== "operator" && role !== "admin") {
          return res.status(400).json({
            error: "Hanya user dengan role operator atau admin yang dapat didelegasikan",
          });
        }

        const office = readOffice(item.session);
        const userOffice = dbUser.office?.trim();
        if (
          userOffice &&
          userOffice.toUpperCase() !== "IT" &&
          userOffice !== office
        ) {
          return res.status(400).json({
            error: `User delegasi harus berada di kantor yang sama (${office})`,
          });
        }
      }

      const approver = resolveApprover(req);

      const updated = await prisma.compareItem.update({
        where: { id: item.id },
        data: {
          delegatedTo: delegatedTo?.trim() || null,
          delegatedBy: delegatedTo?.trim() ? approver : null,
          delegatedAt: delegatedTo?.trim() ? new Date() : null,
        } as never,
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

