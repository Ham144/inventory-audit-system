import express from "express";
import axios from "axios";
import { prisma } from "../config/db.js";
import { filterNavCompareRows, filterScanCompareRows, parseCompareQueryFilters, } from "../utils/compare-filters.js";
import { resolveStockQty } from "../types/catalog.js";
const databaseCenter = () => process.env.DATABASE_CENTER ?? "http://192.168.169.12:7047";
async function getOrCreateActiveSession(locationCode) {
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
async function sessionScopeWhere(locationCode) {
    if (locationCode === "Semua") {
        const activeSessions = await prisma.opnameSession.findMany({
            where: { status: "ONGOING" },
        });
        const sessionIds = activeSessions.map((s) => s.id);
        return { sessionId: { in: sessionIds } };
    }
    const session = await getOrCreateActiveSession(locationCode);
    return { sessionId: session.id };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : "Unknown error";
}
function mapNavCompareItem(item) {
    return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        physicalQty: item.physicalQty,
        systemQty: item.systemQty,
        status: item.status.toLowerCase(),
        locationCode: item.session.locationCode,
        updatedAt: item.updatedAt.toISOString(),
    };
}
async function buildScanCompareRows(whereClause) {
    const scans = await prisma.scanLog.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
    });
    const groups = new Map();
    for (const scan of scans) {
        const key = `${scan.sku}|${scan.rak}|${scan.locationCode}`;
        const existing = groups.get(key);
        if (existing) {
            existing.push(scan);
        }
        else {
            groups.set(key, [scan]);
        }
    }
    return Array.from(groups.values()).map((groupScans) => {
        const qtySet = new Set(groupScans.map((s) => s.qty));
        const match = qtySet.size <= 1;
        return {
            sku: groupScans[0].sku,
            name: groupScans[0].name,
            rak: groupScans[0].rak,
            locationCode: groupScans[0].locationCode,
            match,
            scans: groupScans.map((s) => ({
                id: s.id,
                qty: s.qty,
                operator: s.operator,
                createdAt: s.createdAt.toISOString(),
            })),
        };
    });
}
async function fetchNavStockQty(sku, locationCode, req) {
    const response = await axios.get(`${databaseCenter()}/api/v1/product/getStock`, {
        params: { No: sku, locationCode },
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
async function enrichNavRowsWithStock(rows, req) {
    return Promise.all(rows.map(async (row) => {
        let systemQty = 0;
        try {
            systemQty = await fetchNavStockQty(row.sku, row.locationCode, req);
        }
        catch {
            systemQty = 0;
        }
        const status = row.physicalQty === systemQty ? "SESUAI" : "SELISIH";
        const updated = await prisma.compareItem.update({
            where: { id: row.id },
            data: {
                systemQty,
                status,
                updatedAt: new Date(),
            },
        });
        return {
            id: updated.id,
            sku: updated.sku,
            name: updated.name,
            physicalQty: updated.physicalQty,
            systemQty: updated.systemQty,
            status: updated.status.toLowerCase(),
            locationCode: row.locationCode,
            updatedAt: updated.updatedAt.toISOString(),
        };
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
const router = express.Router();
router.get("/scan", async (req, res) => {
    try {
        const filters = parseCompareQueryFilters(req.query);
        const whereClause = await sessionScopeWhere(filters.locationCode);
        const rows = await buildScanCompareRows(whereClause);
        return res.json(filterScanCompareRows(rows, filters));
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
router.get("/nav", async (req, res) => {
    try {
        const filters = parseCompareQueryFilters(req.query);
        const whereClause = await sessionScopeWhere(filters.locationCode);
        const items = await prisma.compareItem.findMany({
            where: whereClause,
            include: {
                session: { select: { locationCode: true } },
            },
            orderBy: { updatedAt: "desc" },
        });
        const mapped = items.map(mapNavCompareItem);
        const skusWithRak = await skusForRakFilter(whereClause, filters.rak);
        const filtered = filterNavCompareRows(mapped, filters, skusWithRak);
        const enriched = await enrichNavRowsWithStock(filtered, req);
        return res.json(enriched);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
export default router;
