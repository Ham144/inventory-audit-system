export type CompareQueryFilters = {
  locationCode: string;
  rak: string;
  search: string;
};

export function parseCompareQueryFilters(query: {
  locationCode?: string;
  rak?: string;
  search?: string;
}): CompareQueryFilters {
  return {
    locationCode: query.locationCode || "Semua",
    rak: query.rak || "Semua",
    search: (query.search || "").trim(),
  };
}

type ScanCompareRow = {
  sku: string;
  name: string;
  rak: number;
  locationCode: string;
  match: boolean;
  scans: unknown[];
};

export function filterScanCompareRows<T extends ScanCompareRow>(
  rows: T[],
  filters: CompareQueryFilters,
): T[] {
  return rows.filter((item) => {
    if (filters.rak !== "Semua" && String(item.rak) !== filters.rak) {
      return false;
    }
    if (filters.search) {
      const term = filters.search.toLowerCase();
      const matchesSku = item.sku.toLowerCase().includes(term);
      const matchesName = item.name.toLowerCase().includes(term);
      if (!matchesSku && !matchesName) return false;
    }
    return true;
  });
}

export function filterNavCompareRows<
  T extends { sku: string; name: string },
>(
  rows: T[],
  filters: CompareQueryFilters,
  skusWithRak: Set<string>,
): T[] {
  return rows.filter((item) => {
    if (filters.rak !== "Semua" && !skusWithRak.has(item.sku)) {
      return false;
    }
    if (filters.search) {
      const term = filters.search.toLowerCase();
      const matchesSku = item.sku.toLowerCase().includes(term);
      const matchesName = item.name.toLowerCase().includes(term);
      if (!matchesSku && !matchesName) return false;
    }
    return true;
  });
}
