import express from "express";
import axios from "axios";
import { prisma } from "../config/db.js";
const router = express.Router();
// Helper to get or create active session
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
        // Optionally populate initial catalog products as CompareItems (limit 50 to match first page)
        try {
            const response = await axios.get(`${process.env.DATABASE_CENTER || "http://192.168.169.12:7047"}/api/v1/product/list?limit=50`);
            const dataList = Array.isArray(response.data)
                ? response.data
                : Array.isArray(response.data?.data)
                    ? response.data.data
                    : [];
            if (dataList.length > 0) {
                await prisma.compareItem.createMany({
                    data: dataList.map((p) => ({
                        sku: p.No || "",
                        name: p.Description || p.Description_3 || "",
                        physicalQty: 0,
                        systemQty: 0,
                        status: "BELUM_COMPARE",
                        sessionId: session.id,
                    })),
                    skipDuplicates: true,
                });
            }
        }
        catch (err) {
            console.error("Gagal melakukan populasi produk awal sesi:", err.message);
        }
    }
    return session;
}
// 1. GET active session
router.get("/session/active", async (req, res) => {
    try {
        const locationCode = req.query.locationCode || "01";
        const session = await getOrCreateActiveSession(locationCode);
        return res.json(session);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// 2. POST create new session (closes ongoing one)
router.post("/session/create", async (req, res) => {
    try {
        const { name, locationCode } = req.body;
        const loc = locationCode || "01";
        // Close all ongoing sessions in this location
        await prisma.opnameSession.updateMany({
            where: {
                locationCode: loc,
                status: "ONGOING",
            },
            data: {
                status: "COMPLETED",
            },
        });
        // Create new session
        const session = await prisma.opnameSession.create({
            data: {
                name: name || `Opname Sesi - ${new Date().toLocaleDateString("id-ID")}`,
                locationCode: loc,
                status: "ONGOING",
            },
        });
        // Populate catalog products
        try {
            const response = await axios.get(`${process.env.DATABASE_CENTER || "http://192.168.169.12:7047"}/api/v1/product/list?limit=50`);
            const dataList = Array.isArray(response.data)
                ? response.data
                : Array.isArray(response.data?.data)
                    ? response.data.data
                    : [];
            if (dataList.length > 0) {
                await prisma.compareItem.createMany({
                    data: dataList.map((p) => ({
                        sku: p.No || "",
                        name: p.Description || p.Description_3 || "",
                        physicalQty: 0,
                        systemQty: 0,
                        status: "BELUM_COMPARE",
                        sessionId: session.id,
                    })),
                    skipDuplicates: true,
                });
            }
        }
        catch (err) {
            console.error("Gagal populasi awal:", err.message);
        }
        return res.json(session);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// 3. POST scan log (adds a scan)
router.post("/scan", async (req, res) => {
    try {
        const { sku, name, rak, qty, operator, locationCode } = req.body;
        const loc = locationCode || "01";
        const session = await getOrCreateActiveSession(loc);
        // Save scan log
        const scan = await prisma.scanLog.create({
            data: {
                sku,
                name,
                rak: Number(rak) || 1,
                qty: Number(qty) || 0,
                operator: operator || "Admin Lapangan",
                locationCode: loc,
                sessionId: session.id,
            },
        });
        // Re-sum physical quantities for this SKU in the active session
        const totalPhysical = await prisma.scanLog.aggregate({
            where: {
                sessionId: session.id,
                sku: sku,
            },
            _sum: {
                qty: true,
            },
        });
        const sumQty = totalPhysical._sum.qty || 0;
        // Find and update or create CompareItem
        const compareItem = await prisma.compareItem.upsert({
            where: {
                sessionId_sku: {
                    sessionId: session.id,
                    sku: sku,
                },
            },
            update: {
                physicalQty: sumQty,
                status: "BELUM_COMPARE", // mark as dirty so user knows to sync
            },
            create: {
                sku,
                name,
                physicalQty: sumQty,
                systemQty: 0,
                status: "BELUM_COMPARE",
                sessionId: session.id,
            },
        });
        return res.json({ scan, compareItem });
    }
    catch (error) {
        console.error("Scan API Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
});
// 4. GET comparison items
router.get("/comparison", async (req, res) => {
    try {
        const locationCode = req.query.locationCode || "01";
        let whereClause = {};
        if (locationCode !== "Semua") {
            const session = await getOrCreateActiveSession(locationCode);
            whereClause = { sessionId: session.id };
        }
        else {
            // Find all ongoing sessions
            const activeSessions = await prisma.opnameSession.findMany({
                where: { status: "ONGOING" },
            });
            const sessionIds = activeSessions.map(s => s.id);
            whereClause = { sessionId: { in: sessionIds } };
        }
        const items = await prisma.compareItem.findMany({
            where: whereClause,
            orderBy: {
                updatedAt: "desc",
            },
        });
        return res.json(items);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// 5. POST sync manual
router.post("/sync", async (req, res) => {
    try {
        const locationCode = req.body.locationCode || "01";
        let whereClause = {};
        if (locationCode !== "Semua") {
            const session = await getOrCreateActiveSession(locationCode);
            whereClause = { sessionId: session.id };
        }
        else {
            const activeSessions = await prisma.opnameSession.findMany({
                where: { status: "ONGOING" },
            });
            const sessionIds = activeSessions.map(s => s.id);
            whereClause = { sessionId: { in: sessionIds } };
        }
        const items = await prisma.compareItem.findMany({
            where: whereClause,
        });
        const updatedItems = [];
        for (const item of items) {
            try {
                // Resolve dynamic location code per item
                let loc = locationCode;
                if (locationCode === "Semua") {
                    const itemSession = await prisma.opnameSession.findUnique({
                        where: { id: item.sessionId },
                    });
                    loc = itemSession?.locationCode || "01";
                }
                const response = await axios.get(`${process.env.DATABASE_CENTER || "http://192.168.169.12:7047"}/api/v1/product/getStock?No=${item.sku}&locationCode=${loc}`);
                const realQty = response.data?.quantity ??
                    response.data?.stock ??
                    response.data?.data?.quantity ??
                    0;
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
                console.error(`Gagal sync SKU ${item.sku}:`, err.message);
                updatedItems.push(item);
            }
        }
        return res.json(updatedItems);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
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
                // Delete scans
                await prisma.scanLog.deleteMany({
                    where: { sessionId: session.id },
                });
                // Delete comparison items
                await prisma.compareItem.deleteMany({
                    where: { sessionId: session.id },
                });
                // Re-populate default catalog
                try {
                    const response = await axios.get(`${process.env.DATABASE_CENTER || "http://192.168.169.12:7047"}/api/v1/product/list?limit=50`);
                    const dataList = Array.isArray(response.data)
                        ? response.data
                        : Array.isArray(response.data?.data)
                            ? response.data.data
                            : [];
                    if (dataList.length > 0) {
                        await prisma.compareItem.createMany({
                            data: dataList.map((p) => ({
                                sku: p.No || "",
                                name: p.Description || p.Description_3 || "",
                                physicalQty: 0,
                                systemQty: 0,
                                status: "BELUM_COMPARE",
                                sessionId: session.id,
                            })),
                            skipDuplicates: true,
                        });
                    }
                }
                catch (err) {
                    console.error("Gagal populasi ulang reset:", err.message);
                }
            }
            return res.json({ success: true, message: "Seluruh wilayah berhasil direset ke status awal." });
        }
        const session = await getOrCreateActiveSession(locationCode);
        // Delete scans
        await prisma.scanLog.deleteMany({
            where: { sessionId: session.id },
        });
        // Delete comparison items
        await prisma.compareItem.deleteMany({
            where: { sessionId: session.id },
        });
        // Re-populate default catalog
        try {
            const response = await axios.get(`${process.env.DATABASE_CENTER || "http://192.168.169.12:7047"}/api/v1/product/list?limit=50`);
            const dataList = Array.isArray(response.data)
                ? response.data
                : Array.isArray(response.data?.data)
                    ? response.data.data
                    : [];
            if (dataList.length > 0) {
                await prisma.compareItem.createMany({
                    data: dataList.map((p) => ({
                        sku: p.No || "",
                        name: p.Description || p.Description_3 || "",
                        physicalQty: 0,
                        systemQty: 0,
                        status: "BELUM_COMPARE",
                        sessionId: session.id,
                    })),
                    skipDuplicates: true,
                });
            }
        }
        catch (err) {
            console.error("Gagal populasi ulang reset:", err.message);
        }
        return res.json({ success: true, message: "State berhasil direset ke status awal. Scan lokal dibersihkan." });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// 7. GET active scans
router.get("/scans", async (req, res) => {
    try {
        const locationCode = req.query.locationCode || "01";
        let whereClause = {};
        if (locationCode !== "Semua") {
            const session = await getOrCreateActiveSession(locationCode);
            whereClause = { sessionId: session.id };
        }
        else {
            const activeSessions = await prisma.opnameSession.findMany({
                where: { status: "ONGOING" },
            });
            const sessionIds = activeSessions.map(s => s.id);
            whereClause = { sessionId: { in: sessionIds } };
        }
        const scans = await prisma.scanLog.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
        });
        return res.json(scans);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
// Cron implementation inside standard setInterval running every 3 hours
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
                        const response = await axios.get(`${process.env.DATABASE_CENTER || "http://192.168.169.12:7047"}/api/v1/product/getStock?No=${item.sku}&locationCode=${session.locationCode}`);
                        const realQty = response.data?.quantity ??
                            response.data?.stock ??
                            response.data?.data?.quantity ??
                            0;
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
                    catch (e) {
                        // Log silent error for single product sync
                    }
                }
            }
            console.log(`⏰ Background opname status reconciliation finished at: ${new Date().toLocaleTimeString()}`);
        }
        catch (err) {
            console.error("Opname background cron error:", err.message);
        }
    }, 10800000); // 3 hours
}
