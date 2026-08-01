export interface CatalogProduct {
  No?: string;
  Description?: string;
  Description_3?: string;
}

export interface InventoryResponse {
    inventoryResult?: number;
}

export function parseCatalogList(payload: unknown): CatalogProduct[] {
  if (Array.isArray(payload)) return payload as CatalogProduct[];
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data: unknown }).data)
  ) {
    return (payload as { data: CatalogProduct[] }).data;
  }
  return [];
}

export function resolveStockQty(payload: InventoryResponse): number {
  if (payload.inventoryResult !== undefined && payload.inventoryResult !== null) {
    return Number(payload.inventoryResult);
  }
  return 0;
}

export function toCompareItemSeed(
  product: CatalogProduct,
  sessionId: string,
): {
  sku: string;
  name: string;
  physicalQty: number;
  systemQty: number;
  status: string;
  sessionId: string;
} {
  return {
    sku: product.No ?? "",
    name: product.Description ?? product.Description_3 ?? "",
    physicalQty: 0,
    systemQty: 0,
    status: "BELUM_COMPARE",
    sessionId,
  };
}
