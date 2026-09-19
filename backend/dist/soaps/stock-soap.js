import { promisify } from "node:util";
import httpntlm from "httpntlm";
const SOAP_ENV = {
    username: process.env.SOAP_USERNAME?.trim() || "",
    password: process.env.SOAP_PASSWORD?.trim() || "",
    url: process.env.SOAP_STOCK_CHECK_DUMP?.trim() || "",
    domain: process.env.SOAP_DOMAIN?.trim() || "",
    workstation: process.env.SOAP_WORKSTATION?.trim() || "",
};
/** How many SKUs to send in one GetInventoryByLocationMultiple call.
 * Default 1 — batch >1 di NAV sering mengisi Quantity saling-timpa (angka kembar/0).
 */
export function getSoapStockBatchSize() {
    const raw = Number(process.env.SOAP_STOCK_BATCH_SIZE || 1);
    if (!Number.isFinite(raw) || raw < 1)
        return 1;
    return Math.min(Math.floor(raw), 200);
}
function escapeXml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
function buildInventoryXml(skus, locationCode) {
    const loc = escapeXml(locationCode.trim().toUpperCase());
    const rows = skus
        .map((sku) => sku.trim())
        .filter(Boolean)
        .map((sku) => `                <InventoryPerLocation xmlns="urn:microsoft-dynamics-nav/xmlports/x50033">
                    <ItemNo>${escapeXml(sku)}</ItemNo>
                    <LocationCode>${loc}</LocationCode>
                    <Quantity>0</Quantity>
                </InventoryPerLocation>`)
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
function parseInventorySoapBody(body) {
    const rows = [];
    const blockRegex = /<InventoryPerLocation\b[^>]*>([\s\S]*?)<\/InventoryPerLocation>/gi;
    for (const match of body.matchAll(blockRegex)) {
        const block = match[1] ?? "";
        const sku = block.match(/<ItemNo>([^<]*)<\/ItemNo>/i)?.[1]?.trim() ?? "";
        const locationCode = block.match(/<LocationCode>([^<]*)<\/LocationCode>/i)?.[1]?.trim() ??
            "";
        const quantityRaw = block.match(/<Quantity>([^<]*)<\/Quantity>/i)?.[1]?.trim() ?? "0";
        const quantity = Number(quantityRaw);
        if (!sku)
            continue;
        rows.push({
            sku,
            locationCode,
            quantity: Number.isFinite(quantity) ? quantity : 0,
        });
    }
    return rows;
}
const ntlmPost = promisify(httpntlm.post.bind(httpntlm));
async function postInventorySoap(xml) {
    if (!SOAP_ENV.url) {
        throw new Error("SOAP_STOCK_CHECK_DUMP belum disetel di environment");
    }
    if (!SOAP_ENV.username || !SOAP_ENV.password) {
        throw new Error("SOAP_USERNAME / SOAP_PASSWORD belum disetel");
    }
    const response = await ntlmPost({
        url: SOAP_ENV.url,
        username: SOAP_ENV.username,
        password: SOAP_ENV.password,
        domain: SOAP_ENV.domain,
        workstation: SOAP_ENV.workstation,
        body: xml,
        headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: "urn:microsoft-dynamics-schemas/codeunit/WSNav:GetInventoryByLocationMultiple",
        },
    });
    if (response.statusCode >= 400) {
        throw new Error(`SOAP stock check gagal (HTTP ${response.statusCode}): ${String(response.body).slice(0, 300)}`);
    }
    return String(response.body ?? "");
}
function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
/**
 * Query NAV inventory for many SKUs at one location.
 * Batches requests (default 1) — override with SOAP_STOCK_BATCH_SIZE.
 */
export async function checkStockMulti(input) {
    const locationCode = input.locationCode.trim().toUpperCase();
    const skus = [
        ...new Set(input.skus.map((sku) => sku.trim()).filter(Boolean)),
    ];
    const qtyBySku = new Map();
    if (!locationCode || skus.length === 0)
        return qtyBySku;
    const batchSize = input.batchSize ?? getSoapStockBatchSize();
    for (const batch of chunkArray(skus, batchSize)) {
        const xml = buildInventoryXml(batch, locationCode);
        const body = await postInventorySoap(xml);
        const rows = parseInventorySoapBody(body);
        for (const sku of batch) {
            qtyBySku.set(sku.toUpperCase(), 0);
        }
        for (const row of rows) {
            qtyBySku.set(row.sku.toUpperCase(), row.quantity);
        }
    }
    return qtyBySku;
}
/** Satu SKU — untuk isi Initial SOT saat scan di mode OPNAME. */
export async function checkStockOne(sku, locationCode) {
    const map = await checkStockMulti({
        skus: [sku],
        locationCode,
        batchSize: 1,
    });
    return map.get(sku.trim().toUpperCase()) ?? 0;
}
export function isSoapStockConfigured() {
    return Boolean(SOAP_ENV.url && SOAP_ENV.username && SOAP_ENV.password);
}
