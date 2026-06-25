import { isHiddenProductSku } from "./product-filter.js";
export function parseCompareQueryFilters(query) {
    const dateFrom = (query.dateFrom || "").trim() || undefined;
    const dateTo = (query.dateTo || "").trim() || undefined;
    return {
        office: query.office || "Semua",
        rak: query.rak || "Semua",
        search: (query.search || "").trim(),
        dateFrom,
        dateTo,
    };
}
export function validateDateRange(dateFrom, dateTo) {
    if (!dateFrom && !dateTo)
        return null;
    if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
        return "dateFrom dan dateTo keduanya wajib jika salah satu diisi";
    }
    if (dateFrom > dateTo) {
        return "dateFrom tidak boleh lebih besar dari dateTo";
    }
    return null;
}
export function filterScanCompareRows(rows, filters) {
    return rows.filter((item) => {
        if (isHiddenProductSku(item.sku)) {
            return false;
        }
        if (filters.rak !== "Semua" && String(item.rak) !== filters.rak) {
            return false;
        }
        if (filters.search) {
            const term = filters.search.toLowerCase();
            const matchesSku = item.sku.toLowerCase().includes(term);
            const matchesName = item.name.toLowerCase().includes(term);
            if (!matchesSku && !matchesName)
                return false;
        }
        return true;
    });
}
export function filterNavCompareRows(rows, filters, skusWithRak) {
    return rows.filter((item) => {
        if (isHiddenProductSku(item.sku)) {
            return false;
        }
        if (filters.rak !== "Semua" && !skusWithRak.has(item.sku)) {
            return false;
        }
        if (filters.search) {
            const term = filters.search.toLowerCase();
            const matchesSku = item.sku.toLowerCase().includes(term);
            const matchesName = item.name.toLowerCase().includes(term);
            if (!matchesSku && !matchesName)
                return false;
        }
        return true;
    });
}
