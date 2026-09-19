import { promisify } from "node:util";
import httpntlm from "httpntlm";

export type StockQtyRow = {
  sku: string;
  locationCode: string;
  quantity: number;
};

const SOAP_ENV = {
  username: process.env.SOAP_USERNAME?.trim() || "",
  password: process.env.SOAP_PASSWORD?.trim() || "",
  url: process.env.SOAP_STOCK_CHECK_DUMP?.trim() || "",
  domain: process.env.SOAP_DOMAIN?.trim() || "",
  workstation: process.env.SOAP_WORKSTATION?.trim() || "",
};

/** How many SKUs to send in one GetInventoryByLocationMultiple call. */
export function getSoapStockBatchSize(): number {
  const raw = Number(process.env.SOAP_STOCK_BATCH_SIZE || 50);
  if (!Number.isFinite(raw) || raw < 1) return 50;
  return Math.min(Math.floor(raw), 200);
}

/** Parallel SOAP batch requests (default 4). */
export function getSoapStockConcurrency(): number {
  const raw = Number(process.env.SOAP_STOCK_CONCURRENCY || 4);
  if (!Number.isFinite(raw) || raw < 1) return 4;
  return Math.min(Math.floor(raw), 16);
}

function getSoapTimeoutMs(): number {
  const raw = Number(process.env.SOAP_STOCK_TIMEOUT_MS || 30_000);
  if (!Number.isFinite(raw) || raw < 5_000) return 30_000;
  return Math.min(Math.floor(raw), 120_000);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildInventoryXml(
  skus: string[],
  locationCode: string,
): string {
  const loc = escapeXml(locationCode.trim().toUpperCase());
  const rows = skus
    .map((sku) => sku.trim())
    .filter(Boolean)
    .map(
      (sku) => `                <InventoryPerLocation xmlns="urn:microsoft-dynamics-nav/xmlports/x50033">
                    <ItemNo>${escapeXml(sku)}</ItemNo>
                    <LocationCode>${loc}</LocationCode>
                    <Quantity>0</Quantity>
                </InventoryPerLocation>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
    <Body>
        <GetInventoryByLocationMultiple xmlns="urn:microsoft-dynamics-schemas/codeunit/WSNav">
            <xml_WSInventory>
${rows}
            </xml_WSInventory>
        </GetInventoryByLocationMultiple>
    </Body>
</Envelope>`;
}

function parseInventorySoapBody(body: string): StockQtyRow[] {
  const rows: StockQtyRow[] = [];
  const blockRegex =
    /<InventoryPerLocation\b[^>]*>([\s\S]*?)<\/InventoryPerLocation>/gi;

  for (const match of body.matchAll(blockRegex)) {
    const block = match[1] ?? "";
    const sku =
      block.match(/<ItemNo>([^<]*)<\/ItemNo>/i)?.[1]?.trim() ?? "";
    const locationCode =
      block.match(/<LocationCode>([^<]*)<\/LocationCode>/i)?.[1]?.trim() ??
      "";
    const quantityRaw =
      block.match(/<Quantity>([^<]*)<\/Quantity>/i)?.[1]?.trim() ?? "0";
    const quantity = Number(quantityRaw);

    if (!sku) continue;
    rows.push({
      sku,
      locationCode,
      quantity: Number.isFinite(quantity) ? quantity : 0,
    });
  }

  return rows;
}

const ntlmPost = promisify(httpntlm.post.bind(httpntlm)) as (
  options: Parameters<typeof httpntlm.post>[0],
) => Promise<{ statusCode: number; body: string }>;

async function postInventorySoap(xml: string): Promise<string> {
  if (!SOAP_ENV.url) {
    throw new Error("SOAP_STOCK_CHECK_DUMP belum disetel di environment");
  }
  if (!SOAP_ENV.username || !SOAP_ENV.password) {
    throw new Error("SOAP_USERNAME / SOAP_PASSWORD belum disetel");
  }

  const timeoutMs = getSoapTimeoutMs();
  const response = await Promise.race([
    ntlmPost({
      url: SOAP_ENV.url,
      username: SOAP_ENV.username,
      password: SOAP_ENV.password,
      domain: SOAP_ENV.domain,
      workstation: SOAP_ENV.workstation,
      body: xml,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction:
          "urn:microsoft-dynamics-schemas/codeunit/WSNav:GetInventoryByLocationMultiple",
      },
    }),
    new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`SOAP stock timeout setelah ${timeoutMs}ms`),
          ),
        timeoutMs,
      );
    }),
  ]);

  if (response.statusCode >= 400) {
    throw new Error(
      `SOAP stock check gagal (HTTP ${response.statusCode}): ${String(response.body).slice(0, 300)}`,
    );
  }

  return String(response.body ?? "");
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runOne() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => runOne(),
  );
  await Promise.all(runners);
  return results;
}

/**
 * Query NAV inventory for many SKUs at one location.
 * Batch + concurrency — jangan pakai batchSize 1 untuk katalog penuh.
 */
export async function checkStockMulti(input: {
  skus: string[];
  locationCode: string;
  batchSize?: number;
  concurrency?: number;
}): Promise<Map<string, number>> {
  const locationCode = input.locationCode.trim().toUpperCase();
  const skus = [
    ...new Set(
      input.skus.map((sku) => sku.trim()).filter(Boolean),
    ),
  ];
  const qtyBySku = new Map<string, number>();
  if (!locationCode || skus.length === 0) return qtyBySku;

  const batchSize = input.batchSize ?? getSoapStockBatchSize();
  const concurrency = input.concurrency ?? getSoapStockConcurrency();
  const batches = chunkArray(skus, batchSize);

  console.log(
    `[SOAP] checkStockMulti location=${locationCode} skus=${skus.length} batches=${batches.length} batchSize=${batchSize} concurrency=${concurrency}`,
  );

  await mapPool(batches, concurrency, async (batch, batchIndex) => {
    const xml = buildInventoryXml(batch, locationCode);
    const body = await postInventorySoap(xml);
    const rows = parseInventorySoapBody(body);

    for (const sku of batch) {
      qtyBySku.set(sku.toUpperCase(), 0);
    }
    for (const row of rows) {
      qtyBySku.set(row.sku.toUpperCase(), row.quantity);
    }

    if ((batchIndex + 1) % 10 === 0 || batchIndex + 1 === batches.length) {
      console.log(
        `[SOAP] progress ${batchIndex + 1}/${batches.length} batches`,
      );
    }
  });

  return qtyBySku;
}

/** Satu SKU — untuk isi Initial SOT saat scan di mode OPNAME. */
export async function checkStockOne(
  sku: string,
  locationCode: string,
): Promise<number> {
  const map = await checkStockMulti({
    skus: [sku],
    locationCode,
    batchSize: 1,
    concurrency: 1,
  });
  return map.get(sku.trim().toUpperCase()) ?? 0;
}

export function isSoapStockConfigured(): boolean {
  return Boolean(SOAP_ENV.url && SOAP_ENV.username && SOAP_ENV.password);
}
