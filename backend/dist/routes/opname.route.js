import express from "express";
import axios from "axios";
import { prisma } from "../config/db.js";
import { parseCatalogList, resolveStockQty, toCompareItemSeed, } from "../types/catalog.js";
const router = express.Router();
const databaseCenter = () => process.env.DATABASE_CENTER ?? "http://192.168.169.12:7047";
function errorMessage(error) {
    return error instanceof Error ? error.message : "Unknown error";
}
async function fetchSystemStockQty(sku, locationCode, req) {
    try {
        const response = await axios.get(`${databaseCenter()}/api/v1/product/getStock`, {
            params: { No: sku, locationCode },
            headers: { cookie: req.headers.cookie ?? "" },
            validateStatus: () => true,
        });
        if (response.status >= 400) {
            return null;
        }
        return resolveStockQty(response.data);
    }
    catch {
        return null;
    }
}
function resolvePhysicalQtyFromScans(scans, systemQty) {
    if (systemQty === null) {
        return { physicalQty: 0, status: "BELUM_COMPARE" };
    }
    const matchingScan = scans.find((s) => s.qty === systemQty);
    if (matchingScan) {
        return { physicalQty: matchingScan.qty, status: "SESUAI" };
    }
    return { physicalQty: 0, status: "SELISIH" };
}
async function fetchCatalogProducts() {
    const response = await axios.get(`${databaseCenter()}/api/v1/product/list?limit=50`);
    return parseCatalogList(response.data);
}
async function seedSessionCatalog(sessionId) {
    try {
        const dataList = await fetchCatalogProducts();
        if (dataList.length > 0) {
            await prisma.compareItem.createMany({
                data: dataList.map((p) => toCompareItemSeed(p, sessionId)),
                skipDuplicates: true,
            });
        }
    }
    catch (err) {
        console.error("Gagal melakukan populasi produk awal sesi:", errorMessage(err));
    }
}
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
        await seedSessionCatalog(session.id);
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
// 1. GET active session
router.get("/session/active", async (req, res) => {
    try {
        const locationCode = req.query.locationCode || "01";
        const session = await getOrCreateActiveSession(locationCode);
        return res.json(session);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
// 2. POST create new session (closes ongoing one)
router.post("/session/create", async (req, res) => {
    try {
        const { name, locationCode } = req.body;
        const loc = locationCode || "01";
        await prisma.opnameSession.updateMany({
            where: {
                locationCode: loc,
                status: "ONGOING",
            },
            data: {
                status: "COMPLETED",
            },
        });
        const session = await prisma.opnameSession.create({
            data: {
                name: name || `Opname Sesi - ${new Date().toLocaleDateString("id-ID")}`,
                locationCode: loc,
                status: "ONGOING",
            },
        });
        await seedSessionCatalog(session.id);
        return res.json(session);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
// 3. POST scan log (adds a scan)
router.post("/scan", async (req, res) => {
    try {
        const { sku, name, rak, qty, locationCode } = req.body;
        const loc = locationCode || "01";
        const session = await getOrCreateActiveSession(loc);
        const scan = await prisma.scanLog.create({
            data: {
                sku,
                name: name ?? "",
                rak: Number(rak) || 1,
                qty: Number(qty) || 0,
                operator: req.user.username,
                locationCode: loc,
                sessionId: session.id,
            },
        });
        const scans = await prisma.scanLog.findMany({
            where: {
                sessionId: session.id,
                sku,
            },
            orderBy: { createdAt: "desc" },
            select: { qty: true, createdAt: true },
        });
        const systemQty = await fetchSystemStockQty(sku, loc, req);
        const { physicalQty, status } = resolvePhysicalQtyFromScans(scans, systemQty);
        const compareItem = await prisma.compareItem.upsert({
            where: {
                sessionId_sku: {
                    sessionId: session.id,
                    sku,
                },
            },
            update: {
                physicalQty,
                systemQty: systemQty ?? 0,
                status,
                updatedAt: new Date(),
            },
            create: {
                sku,
                name: name ?? "",
                physicalQty,
                systemQty: systemQty ?? 0,
                status,
                sessionId: session.id,
            },
        });
        return res.json({ scan, compareItem });
    }
    catch (error) {
        console.error("Scan API Error:", errorMessage(error));
        return res.status(500).json({ error: errorMessage(error) });
    }
});
// 4. GET comparison items
router.get("/comparison", async (req, res) => {
    try {
        const locationCode = req.query.locationCode || "01";
        const whereClause = await sessionScopeWhere(locationCode);
        const items = await prisma.compareItem.findMany({
            where: whereClause,
            orderBy: {
                updatedAt: "desc",
            },
        });
        return res.json(items);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
// 5. POST sync manual
router.post("/sync", async (req, res) => {
    try {
        const locationCode = req.body.locationCode || "01";
        const whereClause = await sessionScopeWhere(locationCode);
        const items = await prisma.compareItem.findMany({
            where: whereClause,
        });
        const updatedItems = [];
        for (const item of items) {
            try {
                let loc = locationCode;
                if (locationCode === "Semua") {
                    const itemSession = await prisma.opnameSession.findUnique({
                        where: { id: item.sessionId },
                    });
                    loc = itemSession?.locationCode || "01";
                }
                const response = await axios.get(`${databaseCenter()}/api/v1/product/getStock?No=${item.sku}&locationCode=${loc}`);
                const realQty = resolveStockQty(response.data);
                const status = item.physicalQty === realQty ? "SESUAI" : "SELISIH";
                const updated = await prisma.compareItem.update({
                    where: { id: item.id },
                    data: {
                        systemQty: realQty,
                        status,
                        updatedAt: new Date(),
                    },
                });
                updatedItems.push(updated);
            }
            catch (err) {
                console.error(`Gagal sync SKU ${item.sku}:`, errorMessage(err));
                updatedItems.push(item);
            }
        }
        return res.json(updatedItems);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
// 6. POST reset active session
router.post("/reset", async (req, res) => {
    try {
        const locationCode = req.body.locationCode || "01";
        if (locationCode === "Semua") {
            const activeSessions = await prisma.opnameSession.findMany({
                where: { status: "ONGOING" },
            });
            for (const session of activeSessions) {
                await prisma.scanLog.deleteMany({
                    where: { sessionId: session.id },
                });
                await prisma.compareItem.deleteMany({
                    where: { sessionId: session.id },
                });
                await seedSessionCatalog(session.id);
            }
            return res.json({
                success: true,
                message: "Seluruh wilayah berhasil direset ke status awal.",
            });
        }
        const session = await getOrCreateActiveSession(locationCode);
        await prisma.scanLog.deleteMany({
            where: { sessionId: session.id },
        });
        await prisma.compareItem.deleteMany({
            where: { sessionId: session.id },
        });
        await seedSessionCatalog(session.id);
        return res.json({
            success: true,
            message: "State berhasil direset ke status awal. Scan lokal dibersihkan.",
        });
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
// 7. GET active scans
router.get("/scans", async (req, res) => {
    try {
        const locationCode = req.query.locationCode || "01";
        const rak = req.query.rak || "Semua";
        const whereClause = await sessionScopeWhere(locationCode);
        const scans = await prisma.scanLog.findMany({
            where: {
                ...whereClause,
                ...(rak !== "Semua" ? { rak: Number(rak) } : {}),
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json(scans);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
export default router;
export function startOpnameCron() {
    console.log("⏰ Opname Background Reconciler Cron initialized (Running every 3 hours)");
    setInterval(async () => {
        try {
            const activeSessions = await prisma.opnameSession.findMany({
                where: { status: "ONGOING" },
            });
            for (const session of activeSessions) {
                const items = await prisma.compareItem.findMany({
                    where: { sessionId: session.id },
                });
                for (const item of items) {
                    try {
                        const response = await axios.get(`${databaseCenter()}/api/v1/product/getStock?No=${item.sku}&locationCode=${session.locationCode}`);
                        const realQty = resolveStockQty(response.data);
                        const status = item.physicalQty === realQty ? "SESUAI" : "SELISIH";
                        await prisma.compareItem.update({
                            where: { id: item.id },
                            data: {
                                systemQty: realQty,
                                status,
                                updatedAt: new Date(),
                            },
                        });
                    }
                    catch {
                        // skip single product sync failure
                    }
                }
            }
            console.log(`⏰ Background opname status reconciliation finished at: ${new Date().toLocaleTimeString()}`);
        }
        catch (err) {
            console.error("Opname background cron error:", errorMessage(err));
        }
    }, 10800000);
}
