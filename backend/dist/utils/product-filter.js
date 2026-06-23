const HIDDEN_SKU_PREFIX = "HD-";
const HIDDEN_POSTING_GROUP = "HADIAH";
export function readProductSku(value) {
    if (value === null || value === undefined)
        return "";
    return String(value).trim();
}
export function readProductSkuFromItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item))
        return "";
    const record = item;
    return readProductSku(record.No ?? record.no ?? record.sku ?? record.SKU ?? record.itemNo);
}
export function readInventoryPostingGroup(item) {
    if (!item || typeof item !== "object" || Array.isArray(item))
        return "";
    const record = item;
    return readProductSku(record.Inventory_Posting_Group ?? record.inventoryPostingGroup);
}
/** SKU hadiah / barang yang tidak boleh muncul di opname. */
export function isHiddenProductSku(sku) {
    const normalized = readProductSku(sku).toUpperCase();
    return normalized.startsWith(HIDDEN_SKU_PREFIX);
}
export function isHiddenProduct(item) {
    if (isHiddenProductSku(readProductSkuFromItem(item))) {
        return true;
    }
    return (readInventoryPostingGroup(item).toUpperCase() === HIDDEN_POSTING_GROUP);
}
export function filterHiddenProducts(items) {
    return items.filter((item) => !isHiddenProduct(item));
}
export function filterProductListPayload(payload) {
    if (Array.isArray(payload)) {
        return filterHiddenProducts(payload);
    }
    if (!payload || typeof payload !== "object") {
        return payload;
    }
    const root = { ...payload };
    if (Array.isArray(root.data)) {
        const before = root.data.length;
        const filtered = filterHiddenProducts(root.data);
        root.data = filtered;
        if (typeof root.total === "number" && filtered.length < before) {
            root.total = Math.max(0, root.total - (before - filtered.length));
        }
        return root;
    }
    if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
        const nested = {
            ...root.data,
        };
        if (Array.isArray(nested.data)) {
            nested.data = filterHiddenProducts(nested.data);
        }
        else if (Array.isArray(nested.items)) {
            nested.items = filterHiddenProducts(nested.items);
        }
        else if (Array.isArray(nested.results)) {
            nested.results = filterHiddenProducts(nested.results);
        }
        root.data = nested;
        return root;
    }
    return payload;
}
