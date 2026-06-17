export function parseCatalogList(payload) {
    if (Array.isArray(payload))
        return payload;
    if (payload &&
        typeof payload === "object" &&
        "data" in payload &&
        Array.isArray(payload.data)) {
        return payload.data;
    }
    return [];
}
export function resolveStockQty(payload) {
    if (payload.stockResult !== undefined && payload.stockResult !== null) {
        return Number(payload.stockResult);
    }
    if (payload.data?.stockResult !== undefined && payload.data.stockResult !== null) {
        return Number(payload.data.stockResult);
    }
    return payload.quantity ?? payload.stock ?? payload.data?.quantity ?? 0;
}
export function toCompareItemSeed(product, sessionId) {
    return {
        sku: product.No ?? "",
        name: product.Description ?? product.Description_3 ?? "",
        physicalQty: 0,
        systemQty: 0,
        status: "BELUM_COMPARE",
        sessionId,
    };
}
