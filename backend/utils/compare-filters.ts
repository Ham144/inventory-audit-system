import { isHiddenProductSku } from "./product-filter.js";

export type CompareQueryFilters = {
  office: string;
  rak: string;
  search: string;
};

export function parseCompareQueryFilters(query: {
  office?: string;
  rak?: string;
  search?: string;
}): CompareQueryFilters {
  return {
    office: query.office || "Semua",
    rak: query.rak || "Semua",
    search: (query.search || "").trim(),
  };
}

type ScanCompareRow = {
  sku: string;
  name: string;
  rak: number;
  office: string;
  match: boolean;
  resolved: boolean;
  approvedQty: number | null;
  approvedScanId: string | null;
  approvedBy: string | null;
  scans: unknown[];
};

export function filterScanCompareRows<T extends ScanCompareRow>(
  rows: T[],
  filters: CompareQueryFilters,
): T[] {
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
      if (!matchesSku && !matchesName) return false;
    }
    return true;
  });
}

export function filterNavCompareRows<T extends { sku: string; name: string }>(
  rows: T[],
  filters: CompareQueryFilters,
  skusWithRak: Set<string>,
): T[] {
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
      if (!matchesSku && !matchesName) return false;
    }
    return true;
  });
}
