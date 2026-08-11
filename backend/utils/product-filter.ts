const HIDDEN_SKU_PREFIX = "HD-";
const HIDDEN_POSTING_GROUP = "HADIAH";

export function readProductSku(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function readProductSkuFromItem(item: unknown): string {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const record = item as Record<string, unknown>;
  return readProductSku(
    record.No ?? record.no ?? record.sku ?? record.SKU ?? record.itemNo,
  );
}

export function readInventoryPostingGroup(item: unknown): string {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const record = item as Record<string, unknown>;
  return readProductSku(
    record.Inventory_Posting_Group ?? record.inventoryPostingGroup,
  );
}

/** SKU hadiah / barang yang tidak boleh muncul di opname. */
export function isHiddenProductSku(sku: string): boolean {
  const normalized = readProductSku(sku).toUpperCase();
  return normalized.startsWith(HIDDEN_SKU_PREFIX);
}

export function isHiddenProduct(item: unknown): boolean {
  if (isHiddenProductSku(readProductSkuFromItem(item))) {
    return true;
  }

  return (
    readInventoryPostingGroup(item).toUpperCase() === HIDDEN_POSTING_GROUP
  );
}

export function filterHiddenProducts<T>(items: T[]): T[] {
  return items.filter((item) => !isHiddenProduct(item));
}

export function filterProductListPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return filterHiddenProducts(payload);
  }

  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const root = { ...(payload as Record<string, unknown>) };

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
      ...(root.data as Record<string, unknown>),
    };

    if (Array.isArray(nested.data)) {
      nested.data = filterHiddenProducts(nested.data);
    } else if (Array.isArray(nested.items)) {
      nested.items = filterHiddenProducts(nested.items);
    } else if (Array.isArray(nested.results)) {
      nested.results = filterHiddenProducts(nested.results);
    }

    root.data = nested;
    return root;
  }

  return payload;
}
