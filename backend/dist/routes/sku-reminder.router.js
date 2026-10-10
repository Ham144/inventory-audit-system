import express from "express";
import axios from "axios";
import { prisma } from "../config/db.js";
import { canAccessAdmin, resolveAppUser } from "../utils/app-user.js";
import { mapOfficeToLocation, resolveLocationCode, resolveOfficeAliases, resolveOfficeName, } from "../utils/office-mapping.js";
import { findUserByUsername } from "../utils/user-store.js";
import { filterHiddenProducts, isHiddenProductSku, readProductSkuFromItem, } from "../utils/product-filter.js";
import { getReusableApiBase, getReusableApiHeaders, } from "../utils/reusable-api.js";
import { checkStockMulti, isSoapStockConfigured, } from "../soaps/stock-soap.js";
import { closeOfficePeriod, getOfficePeriod, openOfficePeriod, } from "../utils/office-period-store.js";
import { sumApprovedQtyForSkuLocation } from "../utils/scan-approval.js";
import { delegateSkuReminder, getSkuReminderById, getSkuReminderSummary, listSkuReminders, markManySkuRemindersResolved, markSkuReminderResolved as markSkuReminderResolvedInStore, syncSkuReminderCatalogForOffice, } from "../utils/sku-reminder-store.js";
const router = express.Router();
const zeroQtyFilterLocks = new Map();
async function hideZeroQtySkuReminders(input) {
    const office = input.office.trim();
    const locationCode = input.locationCode.trim().toUpperCase();
    if (!office || !locationCode)
        return 0;
    const sourceSkus = input.skus ??
        (await listSkuReminders(office, "unresolved")).map((row) => row.sku);
    if (!sourceSkus.length)
        return 0;
    let qtyBySku = input.qtyBySku;
    if (!qtyBySku) {
        if (!isSoapStockConfigured())
            return 0;
        const lockKey = `${office}::${locationCode}`;
        const existing = zeroQtyFilterLocks.get(lockKey);
        if (existing)
            return existing;
        const job = (async () => {
            const fetched = await checkStockMulti({
                skus: sourceSkus,
                locationCode,
            });
            const zeroSkus = sourceSkus.filter((sku) => {
                const qty = fetched.get(sku.trim().toUpperCase());
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
    const zeroSkus = sourceSkus.filter((sku) => {
        const qty = qtyBySku.get(sku.trim().toUpperCase());
        return qty === undefined || qty < 1;
    });
    if (!zeroSkus.length)
        return 0;
    return markManySkuRemindersResolved(zeroSkus, office);
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
// periode baru — daftar SKU aktif dari katalog produk (bukan stock qty)
async function startNewPeriod(limit = 5000) {
    const products = await fetchActiveCatalogProducts(limit);
    return products.map((p) => p.sku);
}
async function fetchActiveCatalogProducts(limit = 5000) {
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
    const bySku = new Map();
    for (const item of productList) {
        if (!item || typeof item !== "object" || Array.isArray(item))
            continue;
        if (!isActiveProduct(item))
            continue;
        const sku = readProductSkuFromItem(item);
        if (!sku)
            continue;
        const record = item;
        const name = (typeof record.Description === "string" && record.Description.trim()) ||
            (typeof record.Description_3 === "string" &&
                record.Description_3.trim()) ||
            "";
        if (!bySku.has(sku.toUpperCase())) {
            bySku.set(sku.toUpperCase(), { sku, name });
        }
    }
    return [...bySku.values()];
}
/** Pastikan semua SKU katalog punya baris CompareItem di sesi (systemQty masih 0 sampai SOAP). */
async function ensureSessionCompareCatalog(sessionId, limit = 5000) {
    const products = await fetchActiveCatalogProducts(limit);
    if (!products.length)
        return 0;
    const result = await prisma.compareItem.createMany({
        data: products.map((p) => ({
            sku: p.sku,
            name: p.name,
            physicalQty: 0,
            systemQty: 0,
            status: "BELUM_COMPARE",
            sessionId,
        })),
        skipDuplicates: true,
    });
    return result.count;
}
async function getOrCreateActiveSession(office) {
    const aliases = await resolveOfficeAliases(office);
    const officeKeys = aliases.length ? aliases : [office];
    let session = await prisma.opnameSession.findFirst({
        where: {
            office: { in: officeKeys },
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
async function loadSystemQtyBySku(skus, locationCode) {
    const uniqueSkus = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
    if (!uniqueSkus.length)
        return new Map();
    if (!isSoapStockConfigured()) {
        throw new Error("SOAP stock belum dikonfigurasi (SOAP_STOCK_CHECK_DUMP / credentials)");
    }
    // GetInventoryOnlyByLocation = 1 SKU/call; concurrency diatur di stock-soap
    return checkStockMulti({
        skus: uniqueSkus,
        locationCode,
    });
}
async function fillSystemQtyFromNav(office) {
    const emptyQty = new Map();
    const locationCode = (await resolveLocationCode(office)) ??
        (await mapOfficeToLocation(office));
    if (!locationCode) {
        return {
            locationCode: null,
            updatedCount: 0,
            failedCount: 0,
            seededCount: 0,
            positiveQtyCount: 0,
            qtyBySku: emptyQty,
        };
    }
    // Semua sesi ONGOING gudang ini (officeName ATAU locationCode di DB)
    const aliases = await resolveOfficeAliases(office);
    const officeKeys = aliases.length ? aliases : [office];
    const sessions = await prisma.opnameSession.findMany({
        where: {
            office: { in: officeKeys },
            status: "ONGOING",
        },
        orderBy: { createdAt: "desc" },
    });
    const session = sessions[0] ?? (await getOrCreateActiveSession(office));
    const sessionIds = sessions.length
        ? sessions.map((s) => s.id)
        : [session.id];
    // Seed katalog penuh ke sesi utama dulu — supaya SKU "belum dikerjakan"
    // juga punya CompareItem + systemQty dari SOAP, bukan menunggu scan.
    const primarySessionId = sessionIds[0] ?? session.id;
    const seededCount = await ensureSessionCompareCatalog(primarySessionId);
    const items = await prisma.compareItem.findMany({
        where: { sessionId: { in: sessionIds } },
    });
    const visibleItems = items.filter((item) => !isHiddenProductSku(item.sku));
    if (!visibleItems.length) {
        return {
            locationCode,
            updatedCount: 0,
            failedCount: 0,
            seededCount,
            positiveQtyCount: 0,
            qtyBySku: emptyQty,
        };
    }
    console.log(`[open-period] SOAP fill office=${office} location=${locationCode} items=${visibleItems.length}`);
    const qtyBySku = await loadSystemQtyBySku(visibleItems.map((item) => item.sku), locationCode);
    let positiveQtyCount = 0;
    for (const qty of qtyBySku.values()) {
        if (qty > 0)
            positiveQtyCount += 1;
    }
    // Jangan tulis systemQty / buka periode kalau SOAP semua 0 —
    // kemungkinan NAV belum siap atau locationCode/SOAP salah.
    if (positiveQtyCount === 0) {
        return {
            locationCode,
            updatedCount: 0,
            failedCount: visibleItems.length,
            seededCount,
            positiveQtyCount: 0,
            qtyBySku,
        };
    }
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
        // Jangan tandai SESUAI untuk 0===0 — itu mengunci scan "belum dikerjakan"
        const status = physicalQty <= 0
            ? "BELUM_COMPARE"
            : physicalQty === systemQty
                ? "SESUAI"
                : "SELISIH";
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
        seededCount,
        positiveQtyCount,
        qtyBySku,
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
    const period = await closeOfficePeriod(resolvedOffice);
    return {
        office: resolvedOffice,
        totalSku: skus.length,
        mode: period.mode,
        // Alias API lama: start/end = opened/closed
        startPeriod: period.openedAt?.toISOString() ?? null,
        endPeriod: period.closedAt?.toISOString() ?? null,
        openedAt: period.openedAt?.toISOString() ?? null,
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
        const existingPeriod = await getOfficePeriod(resolvedOffice);
        if (existingPeriod?.mode === "OPNAME") {
            return res.status(400).json({
                message: "Periode sudah dibuka. Tutup periode dulu jika ingin membuka ulang.",
            });
        }
        const filled = await fillSystemQtyFromNav(resolvedOffice);
        if (filled.positiveQtyCount === 0) {
            return res.status(400).json({
                message: "Gagal buka periode: semua qty SOAP = 0. Cek stok NAV sudah ter-update, atau locationCode/SOAP salah.",
                office: resolvedOffice,
                locationCode: filled.locationCode,
                updatedSystemQty: 0,
                failedSystemQty: filled.failedCount,
                positiveQtyCount: 0,
            });
        }
        if (filled.updatedCount === 0) {
            return res.status(400).json({
                message: "Gagal mengisi systemQty dari SOAP",
                locationCode: filled.locationCode,
            });
        }
        const period = await openOfficePeriod(resolvedOffice);
        let hiddenZeroQty = 0;
        if (filled.locationCode) {
            try {
                hiddenZeroQty = await hideZeroQtySkuReminders({
                    office: resolvedOffice,
                    locationCode: filled.locationCode,
                    qtyBySku: filled.qtyBySku,
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
            positiveQtyCount: filled.positiveQtyCount,
            seededCompareItems: filled.seededCount,
            hiddenZeroQty,
            openedAt: period.openedAt?.toISOString() ?? null,
            startPeriod: period.openedAt?.toISOString() ?? null,
            endPeriod: period.closedAt?.toISOString() ?? null,
            closedAt: period.closedAt?.toISOString() ?? null,
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
        const officePeriod = !isAllOffice && office ? await getOfficePeriod(office) : null;
        const periodMode = officePeriod?.mode ?? "FREE";
        return res.json({
            success: true,
            office: isAllOffice ? "Semua" : office,
            mode: periodMode,
            total: scopedRows.length,
            summary,
            period: {
                mode: periodMode,
                openedAt: officePeriod?.openedAt?.toISOString() ?? null,
                closedAt: officePeriod?.closedAt?.toISOString() ?? null,
                // Alias kompatibilitas frontend lama
                startPeriod: officePeriod?.openedAt?.toISOString() ?? null,
                endPeriod: officePeriod?.closedAt?.toISOString() ?? null,
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
