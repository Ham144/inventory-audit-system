const HIDDEN_SKU_PREFIX = "HD-";
const HIDDEN_POSTING_GROUP = "HADIAH";

function readSku(item: Record<string, unknown>): string {
  return String(item.No ?? item.no ?? item.sku ?? item.SKU ?? "").trim();
}

export function isHiddenProductItem(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const record = item as Record<string, unknown>;
  const sku = readSku(record).toUpperCase();
  if (sku.startsWith(HIDDEN_SKU_PREFIX)) return true;

  const postingGroup = String(
    record.Inventory_Posting_Group ?? record.inventoryPostingGroup ?? "",
  )
    .trim()
    .toUpperCase();

  return postingGroup === HIDDEN_POSTING_GROUP;
}

export function filterHiddenProductItems<T>(items: T[]): T[] {
  return items.filter((item) => !isHiddenProductItem(item));
}

export function filterProductListResponse<T extends { data?: unknown }>(
  payload: T,
): T {
  if (!payload || typeof payload !== "object") return payload;

  if (Array.isArray(payload.data)) {
    const filtered = filterHiddenProductItems(payload.data);
    const removed = payload.data.length - filtered.length;
    const next = { ...payload, data: filtered } as T & { total?: number };

    if (removed > 0 && typeof next.total === "number") {
      next.total = Math.max(0, next.total - removed);
    }

    return next;
  }

  return payload;
}
