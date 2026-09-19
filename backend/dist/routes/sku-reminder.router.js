import express from "express";
import axios from "axios";
import { prisma } from "../config/db.js";
import { canAccessAdmin, resolveAppUser } from "../utils/app-user.js";
import { mapOfficeToLocation, resolveLocationCode, resolveOfficeName, } from "../utils/office-mapping.js";
import { findUserByUsername } from "../utils/user-store.js";
import { filterHiddenProducts, isHiddenProductSku, readProductSkuFromItem, } from "../utils/product-filter.js";
import { getReusableApiBase, getReusableApiHeaders, } from "../utils/reusable-api.js";
import { checkStockMulti, isSoapStockConfigured, } from "../soaps/stock-soap.js";
import { resolveStockQty } from "../types/catalog.js";
import { closeOfficePeriod, getOfficePeriod, openOfficePeriod, } from "../utils/office-period-store.js";
import { sumApprovedQtyForSkuLocation } from "../utils/scan-approval.js";
import { delegateSkuReminder, getSkuReminderById, getSkuReminderSummary, listSkuReminders, markManySkuRemindersResolved, markSkuReminderResolved as markSkuReminderResolvedInStore, syncSkuReminderCatalogForOffice, } from "../utils/sku-reminder-store.js";
const router = express.Router();
const zeroQtyFilterLocks = new Map();
async function hideZeroQtySkuReminders(input) {
    if (!isSoapStockConfigured())
        return 0;
    const office = input.office.trim();
    const locationCode = input.locationCode.trim().toUpperCase();
    if (!office || !locationCode)
        return 0;
    const lockKey = `${office}::${locationCode}`;
    const existing = zeroQtyFilterLocks.get(lockKey);
    if (existing)
        return existing;
    const job = (async () => {
        const sourceSkus = input.skus ??
            (await listSkuReminders(office, "unresolved")).map((row) => row.sku);
        if (!sourceSkus.length)
            return 0;
        const qtyBySku = await checkStockMulti({
            skus: sourceSkus,
            locationCode,
        });
        const zeroSkus = sourceSkus.filter((sku) => {
            const qty = qtyBySku.get(sku.trim().toUpperCase());
            return qty === undefined || qty < 1;
        });
        if (!zeroSkus.length)
            return 0;
        return markManySkuRemindersResolved(zeroSkus, office);
    })().finally(() => {
        zeroQtyFilterLocks.delete(lockKey);
    });
    zeroQtyFilterLocks.set(lockKey, job);
    return job;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : "Unknown error";
}
function resolveApprover(req) {
    const user = req.user;
    return (user?.username?.trim() ||
        user?.usernameLdap?.trim() ||
        "unknown");
}
function attachOfficeDelegation(row, office) {
    const delegation = row.officeDelegations[office];
    return {
        ...row,
        delegatedTo: delegation?.delegatedTo ?? null,
        delegatedBy: delegation?.delegatedBy ?? null,
        delegatedAt: delegation?.delegatedAt ?? null,
    };
}
function parseBoolLike(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "true" || normalized === "1" || normalized === "yes";
    }
    return false;
}
function isActiveProduct(item) {
    return (!parseBoolLike(item.Blocked) &&
        !parseBoolLike(item.Blocked_MA) &&
        !parseBoolLike(item.Blocked_Services));
}
// periode baru
async function startNewPeriod(limit = 5000) {
    const response = await axios.get(`${getReusableApiBase()}/api/v1/product/list`, {
        params: { limit },
        headers: getReusableApiHeaders(),
        validateStatus: () => true,
    });
    if (response.status >= 400) {
        throw new Error(`Gagal mengambil katalog SKU (${response.status}): ${typeof response.data?.message === "string"
            ? response.data.message
            : "upstream error"}`);
    }
    const payload = response.data;
    const rawList = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
            ? payload.data
            : [];
    const productList = filterHiddenProducts(rawList);
    const skuSet = new Set();
    for (const item of productList) {
        if (!item || typeof item !== "object" || Array.isArray(item))
            continue;
        if (!isActiveProduct(item))
            continue;
        const sku = readProductSkuFromItem(item);
        if (sku)
            skuSet.add(sku);
    }
    return [...skuSet];
}
async function getOrCreateActiveSession(office) {
    let session = await prisma.opnameSession.findFirst({
        where: {
            office,
            status: "ONGOING",
        },
        orderBy: { createdAt: "desc" },
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
async function fetchSystemQtyForSku(sku, locationCode) {
    try {
        const response = await axios.get(`${getReusableApiBase()}/api/v1/inventory/count`, {
            params: { No: sku, locationCode },
            headers: getReusableApiHeaders(),
            validateStatus: () => true,
        });
        if (response.status >= 400)
            return null;
        // API sering kirim inventoryResult: null — jangan anggap 0 valid
        if (response.data?.inventoryResult === undefined ||
            response.data?.inventoryResult === null) {
            return null;
        }
        return resolveStockQty(response.data);
    }
    catch {
        return null;
    }
}
/**
 * Ambil SOT per SKU. Utama: SOAP batch (inventory/count REST sering null).
 * Fallback REST hanya jika SOAP gagal total.
 */
async function loadSystemQtyBySku(skus, locationCode) {
    const qtyBySku = new Map();
    const uniqueSkus = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
    if (!uniqueSkus.length)
        return qtyBySku;
    if (isSoapStockConfigured()) {
        try {
            const soapQtys = await checkStockMulti({
                skus: uniqueSkus,
                locationCode,
                batchSize: 1,
            });
            for (const [sku, qty] of soapQtys) {
                qtyBySku.set(sku.toUpperCase(), qty);
            }
            if (qtyBySku.size > 0)
                return qtyBySku;
        }
        catch (error) {
            console.error("[sku-reminder] open-period SOAP batch failed, falling back REST:", errorMessage(error));
        }
    }
    const concurrency = 8;
    for (let i = 0; i < uniqueSkus.length; i += concurrency) {
        const batch = uniqueSkus.slice(i, i + concurrency);
        const results = await Promise.all(batch.map(async (sku) => {
            const qty = await fetchSystemQtyForSku(sku, locationCode);
            return { sku, qty };
        }));
        for (const { sku, qty } of results) {
            if (qty === null)
                continue;
            qtyBySku.set(sku.toUpperCase(), qty);
        }
    }
    return qtyBySku;
}
async function fillSystemQtyFromNav(office) {
    const locationCode = (await resolveLocationCode(office)) ??
        (await mapOfficeToLocation(office));
    if (!locationCode) {
        return { locationCode: null, updatedCount: 0, failedCount: 0 };
    }
    // Semua sesi ONGOING gudang ini (hindari SOT hanya mengisi sesi kosong/salah)
    const sessions = await prisma.opnameSession.findMany({
        where: {
            office,
            status: "ONGOING",
        },
        orderBy: { createdAt: "desc" },
    });
    const session = sessions[0] ?? (await getOrCreateActiveSession(office));
    const sessionIds = sessions.length
        ? sessions.map((s) => s.id)
        : [session.id];
    const items = await prisma.compareItem.findMany({
        where: { sessionId: { in: sessionIds } },
    });
    const visibleItems = items.filter((item) => !isHiddenProductSku(item.sku));
    if (!visibleItems.length) {
        return { locationCode, updatedCount: 0, failedCount: 0 };
    }
    const qtyBySku = await loadSystemQtyBySku(visibleItems.map((item) => item.sku), locationCode);
    let updatedCount = 0;
    let failedCount = 0;
    for (const item of visibleItems) {
        const systemQty = qtyBySku.get(item.sku.trim().toUpperCase());
        if (systemQty === undefined) {
            failedCount += 1;
            continue;
        }
        const officeForItem = office;
        const approvedPhysical = await sumApprovedQtyForSkuLocation(item.sessionId, item.sku, officeForItem);
        const physicalQty = item.finalCorrectionQty !== null && item.finalCorrectionQty !== undefined
            ? item.finalCorrectionQty
            : approvedPhysical;
        const status = physicalQty === systemQty ? "SESUAI" : "SELISIH";
        await prisma.compareItem.update({
            where: { id: item.id },
            data: {
                physicalQty,
                systemQty,
                status,
                updatedAt: new Date(),
            },
        });
        updatedCount += 1;
    }
    return {
        locationCode,
        updatedCount,
        failedCount,
    };
}
async function runClosePeriod(input) {
    const officeInput = input.officeInput.trim();
    if (!officeInput || officeInput.toLowerCase() === "semua") {
        throw Object.assign(new Error("Pilih gudang spesifik. Tutup periode hanya berlaku untuk satu gudang."), { status: 400 });
    }
    const resolvedOffice = await resolveOfficeName(officeInput);
    if (!resolvedOffice) {
        throw Object.assign(new Error("Office tidak valid"), { status: 400 });
    }
    const now = new Date();
    const skus = await startNewPeriod(Number(input.limit) || 5000);
    if (!skus.length) {
        throw Object.assign(new Error("SKU sumber kosong"), { status: 400 });
    }
    // Katalog tugas periode berikutnya (tanpa input tanggal manual — riwayat pakai filter tanggal)
    await syncSkuReminderCatalogForOffice(resolvedOffice, skus, now, null);
    // Akhiri semua sesi kerja gudang ini — ScanLog/Compare lama tetap di sesi COMPLETED
    // (admin/my-logs default hanya lihat sesi ONGOING / setelah closedAt)
    await prisma.opnameSession.updateMany({
        where: {
            office: resolvedOffice,
            status: "ONGOING",
        },
        data: {
            status: "COMPLETED",
            updatedAt: now,
        },
    });
    const period = await closeOfficePeriod(resolvedOffice, {
        endPeriod: now,
    });
    return {
        office: resolvedOffice,
        totalSku: skus.length,
        mode: period.mode,
        startPeriod: period.startPeriod?.toISOString() ?? null,
        endPeriod: now.toISOString(),
        closedAt: period.closedAt?.toISOString() ?? null,
    };
}
/** @deprecated Gunakan POST /close-period — tetap ada untuk kompatibilitas lama. */
router.post("/collect-data", async (req, res) => {
    try {
        const appUser = await resolveAppUser(req);
        if (!appUser || !canAccessAdmin(appUser)) {
            return res.status(403).json({ message: "Akses ditolak" });
        }
        const { limit = 5000, office } = req.body;
        const officeInput = office?.trim() || appUser.office?.trim() || "";
        const result = await runClosePeriod({
            officeInput,
            limit,
        });
        return res.json({
            success: true,
            message: `Tutup periode gudang ${result.office} berhasil`,
            ...result,
        });
    }
    catch (error) {
        const status = typeof error?.status === "number"
            ? error.status
            : 500;
        return res.status(status).json({ message: errorMessage(error) });
    }
});
router.post("/open-period", async (req, res) => {
    try {
        const appUser = await resolveAppUser(req);
        if (!appUser || !canAccessAdmin(appUser)) {
            return res.status(403).json({ message: "Akses ditolak" });
        }
        const officeInput = req.body?.office?.trim() ||
            appUser.office?.trim() ||
            "";
        if (!officeInput || officeInput.toLowerCase() === "semua") {
            return res.status(400).json({
                message: "Pilih gudang spesifik. Buka periode hanya berlaku untuk satu gudang.",
            });
        }
        const resolvedOffice = await resolveOfficeName(officeInput);
        if (!resolvedOffice) {
            return res.status(400).json({ message: "Office tidak valid" });
        }
        const filled = await fillSystemQtyFromNav(resolvedOffice);
        const period = await openOfficePeriod(resolvedOffice);
        let hiddenZeroQty = 0;
        if (filled.locationCode) {
            try {
                hiddenZeroQty = await hideZeroQtySkuReminders({
                    office: resolvedOffice,
                    locationCode: filled.locationCode,
                });
            }
            catch (error) {
                console.error("[sku-reminder] filter zero qty after open-period failed:", errorMessage(error));
            }
        }
        return res.json({
            success: true,
            message: `Buka periode gudang ${resolvedOffice} berhasil`,
            office: resolvedOffice,
            mode: period.mode,
            locationCode: filled.locationCode,
            updatedSystemQty: filled.updatedCount,
            failedSystemQty: filled.failedCount,
            hiddenZeroQty,
            openedAt: period.openedAt?.toISOString() ?? null,
            startPeriod: period.startPeriod?.toISOString() ?? null,
            endPeriod: period.endPeriod?.toISOString() ?? null,
        });
    }
    catch (error) {
        return res.status(500).json({ message: errorMessage(error) });
    }
});
router.post("/close-period", async (req, res) => {
    try {
        const appUser = await resolveAppUser(req);
        if (!appUser || !canAccessAdmin(appUser)) {
            return res.status(403).json({ message: "Akses ditolak" });
        }
        const { limit = 5000, office } = req.body;
        const officeInput = office?.trim() || appUser.office?.trim() || "";
        const result = await runClosePeriod({
            officeInput,
            limit,
        });
        return res.json({
            success: true,
            message: `Tutup periode gudang ${result.office} berhasil`,
            ...result,
        });
    }
    catch (error) {
        const status = typeof error?.status === "number"
            ? error.status
            : 500;
        return res.status(status).json({ message: errorMessage(error) });
    }
});
router.get("/unresolved", async (req, res) => {
    try {
        const appUser = await resolveAppUser(req);
        if (!appUser?.username) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const officeInput = req.query.office?.trim() ||
            appUser.office?.trim() ||
            "";
        const isAllOffice = officeInput.toLowerCase() === "semua";
        const office = officeInput ? await resolveOfficeName(officeInput) : null;
        if (!isAllOffice && !office) {
            return res.status(400).json({
                message: "Office wajib diisi atau disetel pada akun.",
            });
        }
        const listMode = req.query.mode?.toLowerCase() === "all"
            ? "all"
            : "unresolved";
        const unresolved = await listSkuReminders(isAllOffice ? undefined : office, isAllOffice ? "all" : listMode);
        const isAdmin = canAccessAdmin(appUser);
        const scopedRows = isAllOffice || isAdmin
            ? unresolved
            : unresolved.filter((row) => {
                const delegation = row.officeDelegations[office];
                return delegation?.delegatedTo === appUser.username;
            });
        const summary = await getSkuReminderSummary(isAllOffice ? undefined : office);
        const periodRow = scopedRows[0] ?? unresolved[0] ?? null;
        const officePeriod = !isAllOffice && office ? await getOfficePeriod(office) : null;
        const periodMode = officePeriod?.mode ?? "FREE";
        return res.json({
            success: true,
            office: isAllOffice ? "Semua" : office,
            mode: periodMode,
            total: scopedRows.length,
            summary,
            period: {
                startPeriod: officePeriod?.startPeriod?.toISOString() ??
                    periodRow?.startPeriod ??
                    null,
                endPeriod: officePeriod?.endPeriod?.toISOString() ??
                    periodRow?.endPeriod ??
                    null,
                mode: periodMode,
                openedAt: officePeriod?.openedAt?.toISOString() ?? null,
                closedAt: officePeriod?.closedAt?.toISOString() ?? null,
            },
            data: isAllOffice
                ? scopedRows
                : scopedRows.map((row) => attachOfficeDelegation(row, office)),
        });
    }
    catch (error) {
        return res.status(500).json({ message: errorMessage(error) });
    }
});
router.post("/filter-zero-qty", async (req, res) => {
    try {
        const appUser = await resolveAppUser(req);
        if (!appUser || !canAccessAdmin(appUser)) {
            return res.status(403).json({ message: "Akses ditolak" });
        }
        if (!isSoapStockConfigured()) {
            return res.status(503).json({
                message: "SOAP stock check belum dikonfigurasi (SOAP_STOCK_CHECK_DUMP / SOAP_USERNAME / SOAP_PASSWORD)",
            });
        }
        const officeInput = req.body?.office?.trim() ||
            appUser.office?.trim() ||
            "";
        if (!officeInput || officeInput.toLowerCase() === "semua") {
            return res.status(400).json({
                message: "Pilih gudang spesifik untuk filter stok 0",
            });
        }
        const resolvedOffice = await resolveOfficeName(officeInput);
        if (!resolvedOffice) {
            return res.status(400).json({ message: "Office tidak valid" });
        }
        const locationCode = (await resolveLocationCode(officeInput)) ??
            (await resolveLocationCode(resolvedOffice));
        if (!locationCode) {
            return res.status(400).json({
                message: "LocationCode NAV tidak ditemukan untuk gudang ini",
            });
        }
        const hiddenZeroQty = await hideZeroQtySkuReminders({
            office: resolvedOffice,
            locationCode,
        });
        return res.json({
            success: true,
            office: resolvedOffice,
            locationCode,
            hiddenZeroQty,
            message: `${hiddenZeroQty} SKU dengan qty < 1 disembunyikan dari daftar belum dikerjakan`,
        });
    }
    catch (error) {
        return res.status(500).json({ message: errorMessage(error) });
    }
});
router.patch("/:skuReminderId/delegate", async (req, res) => {
    try {
        const appUser = await resolveAppUser(req);
        if (!canAccessAdmin(appUser)) {
            return res.status(403).json({
                message: "Hanya admin atau owner yang dapat mendelegasikan pengecekan",
            });
        }
        const skuReminderId = String(req.params.skuReminderId);
        const { office, delegatedTo } = req.body;
        const resolvedOffice = office?.trim()
            ? await resolveOfficeName(office.trim())
            : null;
        if (!resolvedOffice) {
            return res.status(400).json({ message: "Office wajib diisi" });
        }
        const item = await getSkuReminderById(skuReminderId);
        if (!item) {
            return res.status(404).json({ message: "SKU reminder tidak ditemukan" });
        }
        const targetUser = delegatedTo?.trim();
        if (targetUser) {
            const dbUser = await findUserByUsername(targetUser);
            if (!dbUser) {
                return res.status(400).json({ message: "User delegasi tidak ditemukan" });
            }
            const role = dbUser.role?.trim().toLowerCase();
            if (role !== "operator" && role !== "admin") {
                return res.status(400).json({
                    message: "Hanya user dengan role operator atau admin yang dapat didelegasikan",
                });
            }
            const userOffice = dbUser.office?.trim();
            if (userOffice &&
                userOffice.toUpperCase() !== "IT" &&
                userOffice !== resolvedOffice) {
                return res.status(400).json({
                    message: `User delegasi harus berada di kantor yang sama (${resolvedOffice})`,
                });
            }
        }
        const updated = await delegateSkuReminder(item.id, resolvedOffice, targetUser || null, targetUser ? resolveApprover(req) : null);
        if (!updated) {
            return res.status(404).json({ message: "SKU reminder tidak ditemukan" });
        }
        return res.json(attachOfficeDelegation(updated, resolvedOffice));
    }
    catch (error) {
        return res.status(500).json({ message: errorMessage(error) });
    }
});
export async function markSkuReminderResolved(sku, office) {
    await markSkuReminderResolvedInStore(sku, office);
}
export default router;
