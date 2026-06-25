import express from "express";
import axios from "axios";
import { prisma } from "../config/db.js";
import { reconcileApprovalAfterGroupChange, deleteScanQtyApprovals, toScanGroups, readOffice, } from "../utils/scan-approval.js";
import { assertScanAccess, isOwner, readJwtUsername, resolveAppUser, resolveOfficeFilter, } from "../utils/app-user.js";
import { listUsers, syncUserProfile, updateUserRole, } from "../utils/user-store.js";
import { parseCatalogList, resolveStockQty, toCompareItemSeed, } from "../types/catalog.js";
import { filterHiddenProducts, isHiddenProductSku, } from "../utils/product-filter.js";
const router = express.Router();
router.get("/me", async (req, res) => {
    try {
        const user = await resolveAppUser(req);
        if (!user) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }
        return res.json(user);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
router.post("/me/sync", async (req, res) => {
    try {
        const username = readJwtUsername(req.user);
        if (!username) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const { office, description } = req.body;
        const user = await syncUserProfile({
            username,
            office: office?.trim() || null,
            description: description?.trim() || null,
        });
        return res.json(user);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
router.get("/users", async (req, res) => {
    try {
        const appUser = await resolveAppUser(req);
        if (!isOwner(appUser)) {
            return res.status(403).json({ message: "Akses ditolak" });
        }
        const users = await listUsers();
        return res.json(users);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
router.patch("/users/:username/role", async (req, res) => {
    try {
        const appUser = await resolveAppUser(req);
        if (!isOwner(appUser)) {
            return res.status(403).json({ message: "Akses ditolak" });
        }
        const targetUsername = req.params.username?.trim();
        if (!targetUsername) {
            return res.status(400).json({ message: "Username wajib diisi" });
        }
        if (targetUsername === appUser?.username) {
            return res
                .status(403)
                .json({ message: "Tidak dapat mengubah role sendiri" });
        }
        const { role } = req.body;
        if (!role?.trim()) {
            return res.status(400).json({ message: "Role wajib diisi" });
        }
        const updated = await updateUserRole(targetUsername, role);
        if (!updated) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }
        return res.json(updated);
    }
    catch (error) {
        const message = errorMessage(error);
        if (message === "Role tidak valid") {
            return res.status(400).json({ message });
        }
        return res.status(500).json({ error: message });
    }
});
const databaseCenter = () => process.env.DATABASE_CENTER ?? "http://192.168.169.12:7047";
function errorMessage(error) {
    return error instanceof Error ? error.message : "Unknown error";
}
async function fetchCatalogProducts() {
    const response = await axios.get(`${databaseCenter()}/api/v1/product/list?limit=50`);
    return filterHiddenProducts(parseCatalogList(response.data));
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
        await seedSessionCatalog(session.id);
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
// 1. GET active session
router.get("/session/active", async (req, res) => {
    try {
        const office = req.query.office || "01";
        const session = await getOrCreateActiveSession(office);
        return res.json(session);
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
// 2. POST create new session (closes ongoing one)
router.post("/session/create", async (req, res) => {
    try {
        const { name, office } = req.body;
        const loc = office || "01";
        await prisma.opnameSession.updateMany({
            where: {
                office: loc,
                status: "ONGOING",
            },
            data: {
                status: "COMPLETED",
            },
        });
        const session = await prisma.opnameSession.create({
            data: {
                name: name || `Opname Sesi - ${new Date().toLocaleDateString("id-ID")}`,
                office: loc,
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
        const appUser = await resolveAppUser(req);
        const { sku, name, rak, qty, office } = req.body;
        const access = assertScanAccess(appUser, office);
        if (!access.ok) {
            return res.status(access.status).json({ message: access.message });
        }
        if (isHiddenProductSku(sku)) {
            return res.status(400).json({ message: "SKU tidak tersedia untuk opname" });
        }
        const loc = access.office;
        const session = await getOrCreateActiveSession(loc);
        const operator = readJwtUsername(req.user);
        if (!operator) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const rakNum = Number(rak) || 1;
        const qtyNum = Number(qty) || 0;
        const existing = await prisma.scanLog.findFirst({
            where: {
                sessionId: session.id,
                sku,
                rak: rakNum,
                office: loc,
                operator,
            },
        });
        const previousQty = existing?.qty ?? 0;
        const scan = existing
            ? await prisma.scanLog.update({
                where: { id: existing.id },
                data: {
                    qty: existing.qty + qtyNum,
                    name: name ?? existing.name,
                },
            })
            : await prisma.scanLog.create({
                data: {
                    sku,
                    name: name ?? "",
                    rak: rakNum,
                    qty: qtyNum,
                    operator,
                    office: loc,
                    sessionId: session.id,
                },
            });
        await prisma.compareItem.upsert({
            where: {
                sessionId_sku: {
                    sessionId: session.id,
                    sku,
                },
            },
            update: {},
            create: {
                sku,
                name: name ?? "",
                physicalQty: 0,
                systemQty: 0,
                status: "BELUM_COMPARE",
                sessionId: session.id,
            },
        });
        const groupScans = await prisma.scanLog.findMany({
            where: {
                sessionId: session.id,
                sku,
                rak: scan.rak,
                office: loc,
            },
        });
        await reconcileApprovalAfterGroupChange(toScanGroups(groupScans));
        return res.json({
            scan,
            isUpdate: Boolean(existing),
            previousQty,
        });
    }
    catch (error) {
        console.error("Scan API Error:", errorMessage(error));
        return res.status(500).json({ error: errorMessage(error) });
    }
});
// 4. GET comparison items
router.get("/comparison", async (req, res) => {
    try {
        const office = req.query.office || "01";
        const whereClause = await sessionScopeWhere(office);
        const items = await prisma.compareItem.findMany({
            where: whereClause,
            orderBy: {
                updatedAt: "desc",
            },
        });
        return res.json(items.filter((item) => !isHiddenProductSku(item.sku)));
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
// 5. POST sync manual
router.post("/sync", async (req, res) => {
    try {
        const office = req.body.office || "01";
        const whereClause = await sessionScopeWhere(office);
        const items = await prisma.compareItem.findMany({
            where: whereClause,
        });
        const updatedItems = [];
        for (const item of items) {
            if (isHiddenProductSku(item.sku)) {
                continue;
            }
            try {
                let loc = office;
                if (office === "Semua") {
                    const itemSession = await prisma.opnameSession.findUnique({
                        where: { id: item.sessionId },
                    });
                    loc = readOffice(itemSession ?? {});
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
        const office = req.body.office || "01";
        if (office === "Semua") {
            const activeSessions = await prisma.opnameSession.findMany({
                where: { status: "ONGOING" },
            });
            for (const session of activeSessions) {
                await deleteScanQtyApprovals({ sessionId: session.id });
                await prisma.scanLog.deleteMany({
                    where: { sessionId: session.id },
                });
                await prisma.compareItem.deleteMany({
                    where: { sessionId: session.id },
                });
            }
            return res.json({
                success: true,
                message: "Semua scan, approval, dan compare dihapus.",
            });
        }
        const session = await getOrCreateActiveSession(office);
        await deleteScanQtyApprovals({ sessionId: session.id });
        await prisma.scanLog.deleteMany({
            where: { sessionId: session.id },
        });
        await prisma.compareItem.deleteMany({
            where: { sessionId: session.id },
        });
        return res.json({
            success: true,
            message: "Scan, approval, dan compare untuk wilayah ini dihapus.",
        });
    }
    catch (error) {
        return res.status(500).json({ error: errorMessage(error) });
    }
});
// 7. GET active scans
router.get("/scans", async (req, res) => {
    try {
        const appUser = await resolveAppUser(req);
        const office = resolveOfficeFilter(appUser, req.query.office || undefined);
        const rak = req.query.rak || "Semua";
        const whereClause = await sessionScopeWhere(office);
        const scans = await prisma.scanLog.findMany({
            where: {
                ...whereClause,
                ...(rak !== "Semua" ? { rak: Number(rak) } : {}),
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json(scans.filter((scan) => !isHiddenProductSku(scan.sku)));
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
                    if (isHiddenProductSku(item.sku)) {
                        continue;
                    }
                    try {
                        const response = await axios.get(`${databaseCenter()}/api/v1/product/getStock?No=${item.sku}&locationCode=${readOffice(session)}`);
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
