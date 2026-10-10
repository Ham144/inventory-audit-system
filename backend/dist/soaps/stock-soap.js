import { promisify } from "node:util";
import httpntlm from "httpntlm";
const SOAP_ENV = {
    username: process.env.SOAP_USERNAME?.trim() || "",
    password: process.env.SOAP_PASSWORD?.trim() || "",
    url: process.env.SOAP_STOCK_CHECK_DUMP?.trim() || "",
    domain: process.env.SOAP_DOMAIN?.trim() || "",
    workstation: process.env.SOAP_WORKSTATION?.trim() || "",
};
/**
 * Legacy name — NAV baru hanya 1 SKU/call (GetInventoryOnlyByLocation).
 * Batch size diabaikan; tetap diekspos supaya env lama tidak error.
 */
export function getSoapStockBatchSize() {
    return 1;
}
/** Parallel SOAP single-SKU requests (default 8). */
export function getSoapStockConcurrency() {
    const raw = Number(process.env.SOAP_STOCK_CONCURRENCY || 8);
    if (!Number.isFinite(raw) || raw < 1)
        return 8;
    return Math.min(Math.floor(raw), 32);
}
function getSoapTimeoutMs() {
    const raw = Number(process.env.SOAP_STOCK_TIMEOUT_MS || 30_000);
    if (!Number.isFinite(raw) || raw < 5_000)
        return 30_000;
    return Math.min(Math.floor(raw), 120_000);
}
function escapeXml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
/** Request 1 SKU — GetInventoryOnlyByLocation (NAV baru, tidak support multiple). */
function buildInventoryXml(sku, locationCode) {
    const itemNo = escapeXml(sku.trim());
    const loc = escapeXml(locationCode.trim().toUpperCase());
    return `<?xml version="1.0" encoding="utf-8"?>
<Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
    <Body>
        <GetInventoryOnlyByLocation xmlns="urn:microsoft-dynamics-schemas/codeunit/WSNav">
            <itemNo>${itemNo}</itemNo>
            <locationCode>${loc}</locationCode>
            <inventory>0</inventory>
        </GetInventoryOnlyByLocation>
    </Body>
</Envelope>`;
}
/** Parse <inventory>N</inventory> dari GetInventoryOnlyByLocation_Result. */
function parseInventorySoapBody(body) {
    // Ambil nilai di Result dulu (lebih spesifik), fallback ke tag inventory mana pun
    const fromResult = body.match(/<GetInventoryOnlyByLocation_Result\b[^>]*>[\s\S]*?<inventory>([^<]*)<\/inventory>/i)?.[1] ??
        body.match(/<inventory>([^<]*)<\/inventory>/i)?.[1];
    const quantity = Number((fromResult ?? "0").trim());
    return Number.isFinite(quantity) ? quantity : 0;
}
const ntlmPost = promisify(httpntlm.post.bind(httpntlm));
async function postInventorySoap(xml) {
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
                SOAPAction: "urn:microsoft-dynamics-schemas/codeunit/WSNav:GetInventoryOnlyByLocation",
            },
        }),
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`SOAP stock timeout setelah ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
    if (response.statusCode >= 400) {
        throw new Error(`SOAP stock check gagal (HTTP ${response.statusCode}): ${String(response.body).slice(0, 300)}`);
    }
    return String(response.body ?? "");
}
async function mapPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function runOne() {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await worker(items[index], index);
        }
    }
    const runners = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => runOne());
    await Promise.all(runners);
    return results;
}
/**
 * Query NAV inventory untuk banyak SKU di satu location.
 * NAV hanya 1-1 → loop GetInventoryOnlyByLocation dengan concurrency.
 */
export async function checkStockMulti(input) {
    const locationCode = input.locationCode.trim().toUpperCase();
    const skus = [
        ...new Set(input.skus.map((sku) => sku.trim()).filter(Boolean)),
    ];
    const qtyBySku = new Map();
    if (!locationCode || skus.length === 0)
        return qtyBySku;
    const concurrency = input.concurrency ?? getSoapStockConcurrency();
    console.log(`[SOAP] checkStockMulti GetInventoryOnlyByLocation location=${locationCode} skus=${skus.length} concurrency=${concurrency}`);
    let done = 0;
    await mapPool(skus, concurrency, async (sku) => {
        try {
            const xml = buildInventoryXml(sku, locationCode);
            const body = await postInventorySoap(xml);
            const quantity = parseInventorySoapBody(body);
            qtyBySku.set(sku.toUpperCase(), quantity);
        }
        catch (err) {
            console.error(`[SOAP] gagal SKU=${sku} loc=${locationCode}:`, err instanceof Error ? err.message : err);
            qtyBySku.set(sku.toUpperCase(), 0);
        }
        done += 1;
        if (done % 50 === 0 || done === skus.length) {
            console.log(`[SOAP] progress ${done}/${skus.length} skus`);
        }
    });
    return qtyBySku;
}
/** Satu SKU — untuk isi Initial SOT saat scan di mode OPNAME. */
export async function checkStockOne(sku, locationCode) {
    const map = await checkStockMulti({
        skus: [sku],
        locationCode,
        concurrency: 1,
    });
    return map.get(sku.trim().toUpperCase()) ?? 0;
}
export function isSoapStockConfigured() {
    return Boolean(SOAP_ENV.url && SOAP_ENV.username && SOAP_ENV.password);
}
