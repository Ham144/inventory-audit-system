import { prisma } from "../config/db.js";

// Load mappings from database
let mappingsCache: Array<{ officeName: string; locationCode: string }> = [];
let lastCacheTime = 0;

export async function getMappings() {
  const now = Date.now();
  if (mappingsCache.length > 0 && now - lastCacheTime < 10000) {
    return mappingsCache;
  }
  try {
    const list = await prisma.officeMapping.findMany();
    // Seed initial mappings if table is completely empty
    if (list.length === 0) {
      const initial = [
        { officeName: "WL Pluit", locationCode: "PLUIT_JUAL" },
        { officeName: "WL Pluit", locationCode: "PLUIT_MP" },
        { officeName: "WL Serang", locationCode: "SRNG_JUAL" },
        { officeName: "WL Bekasi", locationCode: "BKS_JUAL" },
        { officeName: "WL Mangga Dua", locationCode: "MNG2_JUAL" },
        { officeName: "WL Cikampek", locationCode: "CKP_JUAL" },
        { officeName: "WL Cipondoh", locationCode: "CPDH_JUAL" },
        { officeName: "WL Glodok", locationCode: "GLD_JUAL" },
        { officeName: "WL Glodok", locationCode: "GLD_F_JUAL" },
        { officeName: "WL Permata", locationCode: "PRMT_JUAL" },
        { officeName: "WL Permata", locationCode: "PRMT_OS" },
        { officeName: "WL Cijerah", locationCode: "CJRH_JUAL" },
        { officeName: "WL Sentul", locationCode: "SNTL_JUAL" },
        { officeName: "WL Pameran", locationCode: "PMRN_JUAL" },
        { officeName: "WL Obral", locationCode: "OBRAL" },
      ];
      await prisma.officeMapping.createMany({
        data: initial,
        skipDuplicates: true,
      });
      const seeded = await prisma.officeMapping.findMany();
      mappingsCache = seeded;
    } else {
      mappingsCache = list;
    }
    lastCacheTime = now;
  } catch (err) {
    console.error("Failed to load office mappings from database:", err);
  }
  return mappingsCache;
}

export function clearMappingsCache() {
  mappingsCache = [];
  lastCacheTime = 0;
}

// Prime mapping cache at server startup
getMappings().catch(() => {});

// Synchronous version for resolveOfficeFilter & assertScanAccess
export function mapLocationToOffice(locationCode: string): string {
  const code = locationCode.trim().toUpperCase();
  if (code === "SEMUA" || !code) return locationCode;
  
  const match = mappingsCache.find((m) => m.locationCode.toUpperCase() === code);
  return match ? match.officeName : locationCode;
}

// Asynchronous version for APIs to resolve locationCode cleanly
export async function mapLocationToOfficeAsync(locationCode: string): Promise<string> {
  const code = locationCode.trim().toUpperCase();
  if (code === "SEMUA" || !code) return locationCode;
  
  const mappings = await getMappings();
  const match = mappings.find((m) => m.locationCode.toUpperCase() === code);
  return match ? match.officeName : locationCode;
}

export async function mapOfficeToLocation(officeName: string): Promise<string> {
  const name = officeName.trim();
  if (!name || name === "Semua") return name;
  
  const mappings = await getMappings();
  const match = mappings.find((m) => m.officeName.toLowerCase() === name.toLowerCase());
  return match ? match.locationCode : officeName;
}

/**
 * Resolves any office string (officeName or locationCode) to a canonical officeName.
 * Returns null if the value is unrecognized (e.g. "IT", "01", random strings).
 */
export async function resolveOfficeName(raw: string): Promise<string | null> {
  const value = raw.trim();
  if (!value || value.toLowerCase() === "semua") return null;

  const mappings = await getMappings();

  // Already a valid officeName?
  const byName = mappings.find(
    (m) => m.officeName.toLowerCase() === value.toLowerCase(),
  );
  if (byName) return byName.officeName;

  // Maybe it's a locationCode?
  const byCode = mappings.find(
    (m) => m.locationCode.toUpperCase() === value.toUpperCase(),
  );
  if (byCode) return byCode.officeName;

  // Unknown value
  return null;
}

