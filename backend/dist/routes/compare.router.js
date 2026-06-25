import express from "express";
import axios from "axios";
import { prisma } from "../config/db.js";
import { filterNavCompareRows, filterScanCompareRows, parseCompareQueryFilters, validateDateRange, } from "../utils/compare-filters.js";
import { approvalGroupKey, countRakStatsForSkuLocation, deleteGroupApproval, findScanQtyApprovals, groupHasOperatorQtyConflict, navAggregateKey, sumApprovedQtyForSkuLocation, toOperatorScanEntries, toScanGroups, toScanGroup, readOffice, tryAutoApproveUnanimousGroup, upsertScanQtyApproval, } from "../utils/scan-approval.js";
import { resolveStockQty } from "../types/catalog.js";
import { canAccessAdmin, resolveAppUser, resolveOfficeFilter, } from "../utils/app-user.js";
const databaseCenter = () => process.env.DATABASE_CENTER;
const SESSION_OFFICE_SELECT = { office: true };
async function getOrCreateActiveSession(office) {
    let session = await prisma.opnameSession.findFirst({
        where: {
            office,
            status: "ONGOING",
        },
    });
    if (!session) {
        session = await prisma.opnameSession.create({
            data: {
                name: `Sesi Opname - Lokasi ${office}`,
                office,
                status: "ONGOING",
            },
        });
    }
    return session;
}
async function sessionScopeWhere(office) {
    if (office === "Semua") {
        const activeSessions = await prisma.opnameSession.findMany({
            where: { status: "ONGOING" },
        });
        const sessionIds = activeSessions.map((s) => s.id);
        return { sessionId: { in: sessionIds } };
    }
    const session = await getOrCreateActiveSession(office);
    return { sessionId: session.id };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : "Unknown error";
}
function resolveApprover(req) {
    const user = req.user;
    return user?.username ?? user?.usernameLdap ?? "admin";
}
async function fetchNavStockQty(sku, office, req) {
    const response = await axios.get(`${databaseCenter()}/api/v1/product/getStock`, {
        params: { No: sku, locationCode: office },
        headers: {
            cookie: req.headers.cookie ?? "",
        },
        validateStatus: () => true,
    });
    if (response.status >= 400) {
        throw new Error(`getStock failed (${response.status})`);
    }
    return resolveStockQty(response.data);
}
async function buildNavRow(item, rakStats, physicalQtyOverride) {
    const office = readOffice(item.session ?? {});
    const physicalQty = physicalQtyOverride ??
        (await sumApprovedQtyForSkuLocation(item.sessionId, item.sku, office));
    const stats = rakStats ??
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
    };
}
async function reconcileStaleApprovals(whereClause) {
    const scans = await prisma.scanLog.findMany({ where: whereClause });
    const groups = new Map();
    for (const scan of scans) {
        const normalized = toScanGroup(scan);
        const key = approvalGroupKey(normalized.sessionId, normalized.sku, normalized.rak, normalized.office);
        const existing = groups.get(key);
        if (existing) {
            existing.push(scan);
        }
        else {
            groups.set(key, [scan]);
        }
    }
    for (const groupScans of groups.values()) {
        if (!groupHasOperatorQtyConflict(toScanGroups(groupScans)))
            continue;
        const first = toScanGroups(groupScans)[0];
        await deleteGroupApproval(first.sessionId, first.sku, first.rak, first.office);
    }
}
async function buildScanCompareRows(whereClause) {
    await reconcileStaleApprovals(whereClause);
    const [scans, approvals] = await Promise.all([
        prisma.scanLog.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
        }),
        findScanQtyApprovals(whereClause),
    ]);
    const approvalByKey = new Map(approvals.map((a) => [
        approvalGroupKey(a.sessionId, a.sku, a.rak, a.office),
        a,
    ]));
    const groups = new Map();
    for (const scan of scans) {
        const normalized = toScanGroup(scan);
        const key = approvalGroupKey(normalized.sessionId, normalized.sku, normalized.rak, normalized.office);
        const existing = groups.get(key);
        if (existing) {
            existing.push(scan);
        }
        else {
            groups.set(key, [scan]);
        }
    }
    const rows = [];
    for (const groupScans of groups.values()) {
        const normalized = toScanGroups(groupScans);
        const first = normalized[0];
        const key = approvalGroupKey(first.sessionId, first.sku, first.rak, first.office);
        const match = !groupHasOperatorQtyConflict(normalized);
        let approval = approvalByKey.get(key);
        if (!match && approval) {
            await deleteGroupApproval(first.sessionId, first.sku, first.rak, first.office);
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
async function buildNavCompareRows(whereClause) {
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
    const physicalQtyByKey = new Map();
    const resolvedRakByKey = new Map();
    const raksWithScansByKey = new Map();
    for (const scan of scans) {
        const office = readOffice(scan);
        const key = navAggregateKey(scan.sessionId, scan.sku, office);
        if (!raksWithScansByKey.has(key)) {
            raksWithScansByKey.set(key, new Set());
        }
        raksWithScansByKey.get(key).add(scan.rak);
    }
    for (const approval of approvals) {
        const key = navAggregateKey(approval.sessionId, approval.sku, approval.office);
        physicalQtyByKey.set(key, (physicalQtyByKey.get(key) ?? 0) + approval.approvedQty);
        resolvedRakByKey.set(key, (resolvedRakByKey.get(key) ?? 0) + 1);
    }
    return Promise.all(items.map((item) => {
        const office = readOffice(item.session);
        const key = navAggregateKey(item.sessionId, item.sku, office);
        const raksWithScans = raksWithScansByKey.get(key)?.size ?? 0;
        const resolvedRakCount = resolvedRakByKey.get(key) ?? 0;
        const pendingRakCount = Math.max(0, raksWithScans - resolvedRakCount);
        const physicalQty = physicalQtyByKey.get(key) ?? 0;
        return buildNavRow(item, { resolvedRakCount, pendingRakCount }, physicalQty);
    }));
}
async function skusForRakFilter(whereClause, rak) {
    if (rak === "Semua") {
        return new Set();
    }
    const scans = await prisma.scanLog.findMany({
        where: {
            ...whereClause,
            rak: Number(rak),
        },
        select: { sku: true },
        distinct: ["sku"],
    });
    return new Set(scans.map((s) => s.sku));
}
async function navKeysWithScansInDateRange(whereClause, dateFrom, dateTo) {
    const from = new Date(`${dateFrom}T00:00:00`);
    const to = new Date(`${dateTo}T23:59:59`);
    const scans = await prisma.scanLog.findMany({
        where: {
            ...whereClause,
            createdAt: { gte: from, lte: to },
        },
        select: { sessionId: true, sku: true, office: true },
    });
    const keys = new Set();
    for (const s of scans) {
        const office = readOffice(s);
        keys.add(navAggregateKey(s.sessionId, s.sku, office));
    }
    return keys;
}
const router = express.Router();
async function scopedCompareFilters(req) {
    const filters = parseCompareQueryFilters(req.query);
    const appUser = await resolveAppUser(req);
    const office = resolveOfficeFilter(appUser, filters.office);
    return { ...filters, office };
}
router.get("/scan", async (req, res) => {
    try {
        const filters = await scopedCompareFilters(req);
        const whereClause = await sessionScopeWhere(filters.office);
        const rows = await buildScanCompareRows(whereClause);
        return res.json(filterScanCompareRows(rows, filters));
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
router.post("/scan/approve", async (req, res) => {
    try {
        const appUser = await resolveAppUser(req);
        if (!canAccessAdmin(appUser)) {
            return res.status(403).json({
                error: "Hanya admin atau owner yang dapat menetapkan qty",
            });
        }
        const { scanLogId } = req.body;
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
        const row = rows.find((r) => r.sku === scanGroup.sku &&
            r.rak === scanGroup.rak &&
            r.office === scanGroup.office);
        return res.json(row ?? null);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
router.get("/nav", async (req, res) => {
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
            const dateKeys = await navKeysWithScansInDateRange(whereClause, filters.dateFrom, filters.dateTo);
            filtered = filtered.filter((r) => dateKeys.has(navAggregateKey(r.sessionId, r.sku, r.office)));
        }
        return res.json(filtered);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
router.post("/nav/:compareItemId/check", async (req, res) => {
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
        const physicalQty = await sumApprovedQtyForSkuLocation(item.sessionId, item.sku, office);
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
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
export default router;
