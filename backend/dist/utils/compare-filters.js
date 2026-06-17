export function parseCompareQueryFilters(query) {
    return {
        locationCode: query.locationCode || "Semua",
        rak: query.rak || "Semua",
        search: (query.search || "").trim(),
    };
}
export function filterScanCompareRows(rows, filters) {
    return rows.filter((item) => {
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
