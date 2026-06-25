import { isHiddenProductSku } from "./product-filter.js";

export type CompareQueryFilters = {
  office: string;
  rak: string;
  search: string;
  dateFrom?: string;
  dateTo?: string;
};

export function parseCompareQueryFilters(query: {
  office?: string;
  rak?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}): CompareQueryFilters {
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

export function validateDateRange(
  dateFrom?: string,
  dateTo?: string,
): string | null {
  if (!dateFrom && !dateTo) return null;
  if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
    return "dateFrom dan dateTo keduanya wajib jika salah satu diisi";
  }
  if (dateFrom! > dateTo!) {
    return "dateFrom tidak boleh lebih besar dari dateTo";
  }
  return null;
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
