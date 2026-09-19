import { sumApprovedQtyForSkuLocation } from "./scan-approval.js";
/**
 * Lock scan hanya jika benar-benar sesuai: status SESUAI DAN
 * qty fisik (approval/koreksi) === Initial SOT (systemQty).
 * Status SESUAI basi (mis. 0===0 padahal approval sudah 35) tidak mengunci.
 */
export async function isSkuLockedAsSesuai(compareItem, office) {
    if (!compareItem)
        return false;
    if (compareItem.status.toUpperCase() !== "SESUAI")
        return false;
    const physical = compareItem.finalCorrectionQty !== null &&
        compareItem.finalCorrectionQty !== undefined
        ? compareItem.finalCorrectionQty
        : await sumApprovedQtyForSkuLocation(compareItem.sessionId, compareItem.sku, office);
    return physical === compareItem.systemQty;
}
export async function unlockStaleSesuaiStatus(compareItem, office) {
    if (compareItem.status.toUpperCase() !== "SESUAI")
        return;
    const locked = await isSkuLockedAsSesuai(compareItem, office);
    if (locked)
        return;
    const { prisma } = await import("../config/db.js");
    const physical = compareItem.finalCorrectionQty !== null &&
        compareItem.finalCorrectionQty !== undefined
        ? compareItem.finalCorrectionQty
        : await sumApprovedQtyForSkuLocation(compareItem.sessionId, compareItem.sku, office);
    await prisma.compareItem.update({
        where: { id: compareItem.id },
        data: {
            physicalQty: physical,
            status: physical === compareItem.systemQty ? "SESUAI" : "SELISIH",
            updatedAt: new Date(),
        },
    });
}
