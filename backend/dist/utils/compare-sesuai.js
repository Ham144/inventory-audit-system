import { sumApprovedQtyForSkuLocation } from "./scan-approval.js";
import { prisma } from "../config/db.js";
import { getOfficePeriod } from "./office-period-store.js";
/**
 * Lock scan hanya jika:
 * 1. OfficePeriod mode OPNAME (sudah Buka / openedAt, belum Tutup / closedAt)
 * 2. Status SESUAI dari periode yang sama (updatedAt >= openedAt)
 * 3. Qty fisik (> 0) benar-benar cocok dengan Initial SOT (systemQty)
 *
 * Jangan kunci di mode FREE, atau SESUAI basi dari periode lama.
 */
export async function isSkuLockedAsSesuai(compareItem, office) {
    if (!compareItem)
        return false;
    if (compareItem.status.toUpperCase() !== "SESUAI")
        return false;
    const period = await getOfficePeriod(office);
    // Belum Buka / sudah Tutup → operator boleh input lagi
    if (!period || period.mode !== "OPNAME" || !period.openedAt)
        return false;
    if (period.closedAt && period.closedAt.getTime() >= period.openedAt.getTime()) {
        return false;
    }
    // SESUAI sebelum openedAt periode ini = sisa periode lama, jangan kunci
    if (compareItem.updatedAt) {
        const markedAt = new Date(compareItem.updatedAt);
        if (!Number.isNaN(markedAt.getTime()) &&
            markedAt.getTime() < period.openedAt.getTime()) {
            return false;
        }
    }
    const physical = compareItem.finalCorrectionQty !== null &&
        compareItem.finalCorrectionQty !== undefined
        ? compareItem.finalCorrectionQty
        : await sumApprovedQtyForSkuLocation(compareItem.sessionId, compareItem.sku, office);
    // 0===0 = belum pernah ada fisik, jangan kunci
    if (physical <= 0)
        return false;
    return physical === compareItem.systemQty;
}
export async function unlockStaleSesuaiStatus(compareItem, office) {
    if (compareItem.status.toUpperCase() !== "SESUAI")
        return;
    const locked = await isSkuLockedAsSesuai(compareItem, office);
    if (locked)
        return;
    const physical = compareItem.finalCorrectionQty !== null &&
        compareItem.finalCorrectionQty !== undefined
        ? compareItem.finalCorrectionQty
        : await sumApprovedQtyForSkuLocation(compareItem.sessionId, compareItem.sku, office);
    const nextStatus = physical <= 0
        ? "BELUM_COMPARE"
        : physical === compareItem.systemQty
            ? "SESUAI"
            : "SELISIH";
    await prisma.compareItem.update({
        where: { id: compareItem.id },
        data: {
            physicalQty: physical,
            status: nextStatus,
            updatedAt: new Date(),
        },
    });
}
