import axiosInstance from "../api/axios-instance";

export type LocationItem = {
  _id?: string;
  name: string;
};

function readString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readFieldCI(
  record: Record<string, unknown>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(record)) {
      if (key.toLowerCase() !== target) continue;
      const parsed = readString(value);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function normalizeLocationItem(raw: unknown): LocationItem | null {
  if (typeof raw === "string" || typeof raw === "number") {
    const name = readString(raw);
    return name ? { name } : null;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const name =
    readFieldCI(record, "name") ??
    readFieldCI(
      record,
      "code",
      "locationCode",
      "location",
      "office",
      "wilayah",
      "No",
    ) ??
    "";
  if (!name) return null;

  const id = readFieldCI(record, "_id", "id");
  return id ? { _id: id, name } : { name };
}

function unwrapLocationArray(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];

  const root = response as Record<string, unknown>;
  const candidates = [
    root.data,
    root.items,
    root.locations,
    root.results,
    root.record,
    root.records,
    root.rows,
    root.list,
    root.content,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      const nested = candidate as Record<string, unknown>;
      const nestedCandidates = [
        nested.data,
        nested.items,
        nested.locations,
        nested.results,
        nested.record,
        nested.records,
        nested.rows,
        nested.list,
        nested.content,
      ];
      for (const nestedValue of nestedCandidates) {
        if (Array.isArray(nestedValue)) return nestedValue;
      }
    }
  }

  return [];
}

export function normalizeLocationList(response: unknown): LocationItem[] {
  const items = unwrapLocationArray(response);
  const seen = new Set<string>();
  const result: LocationItem[] = [];

  for (const item of items) {
    const normalized = normalizeLocationItem(item);
    if (!normalized || seen.has(normalized.name)) continue;
    seen.add(normalized.name);
    result.push(normalized);
  }

  return result;
}

export interface MappingItem {
  officeName: string;
  locationCode: string;
}

let cachedMappings: MappingItem[] = [];
let mappingsFetched = false;

export async function fetchAndCacheMappings() {
  try {
    const response = await axiosInstance.get<MappingItem[]>("/api/mappings");
    cachedMappings = response.data;
    mappingsFetched = true;
    return cachedMappings;
  } catch (err) {
    console.error("Failed to fetch mappings on frontend:", err);
    return [];
  }
}

export function clearFrontendMappingsCache() {
  cachedMappings = [];
  mappingsFetched = false;
}

/** Canonical officeName (e.g. MNG2_JUAL → WL Mangga Dua). */
export function toCanonicalOfficeName(raw: string): string {
  const value = raw.trim();
  if (!value || value === "Semua") return value;

  if (!mappingsFetched) {
    mappingsFetched = true;
    fetchAndCacheMappings().catch(() => {});
  }

  const byName = cachedMappings.find(
    (m) => m.officeName.toLowerCase() === value.toLowerCase(),
  );
  if (byName) return byName.officeName;

  const byCode = cachedMappings.find(
    (m) => m.locationCode.toLowerCase() === value.toLowerCase(),
  );
  if (byCode) return byCode.officeName;

  return value;
}

/** NAV locationCode (e.g. WL Mangga Dua → MNG2_JUAL). */
export function toLocationCode(raw: string): string {
  const value = raw.trim();
  if (!value || value === "Semua") return value;

  if (!mappingsFetched) {
    mappingsFetched = true;
    fetchAndCacheMappings().catch(() => {});
  }

  const byCode = cachedMappings.find(
    (m) => m.locationCode.toLowerCase() === value.toLowerCase(),
  );
  if (byCode) return byCode.locationCode;

  const byName = cachedMappings.find(
    (m) => m.officeName.toLowerCase() === value.toLowerCase(),
  );
  if (byName) return byName.locationCode;

  return value;
}

export function isMatchingOffice(
  officeName: string,
  locationCode: string,
): boolean {
  const left = toCanonicalOfficeName(officeName).toLowerCase();
  const right = toCanonicalOfficeName(locationCode).toLowerCase();
  if (!left || !right) return false;
  return left === right;
}

export function locationExists(
  locations: LocationItem[],
  office: string,
): boolean {
  const value = office.trim();
  if (!value || value === "Semua") return value === "Semua";
  return locations.some((loc) => isMatchingOffice(value, loc.name));
}

export function resolvePickedOffice(
  pickedOffice: string,
  locations: LocationItem[],
): string {
  const value = pickedOffice.trim();
  if (!value || value === "Semua") return "Semua";
  const match = locations.find((loc) => isMatchingOffice(value, loc.name));
  if (!match) return "Semua";
  // Selalu simpan officeName kanonik, bukan locationCode
  return toCanonicalOfficeName(match.name);
}

export function resolveInitialPickedOffice(input: {
  userOffice?: string;
  savedOffice?: string;
  locations?: LocationItem[];
  fallback?: string;
}): string {
  const fallback = input.fallback || "Semua";
  const locations = input.locations ?? [];
  const candidates = [input.userOffice, input.savedOffice]
    .map((value) => value?.trim())
    .filter(Boolean) as string[];

  if (locations.length === 0) {
    return candidates[0] ? toCanonicalOfficeName(candidates[0]) : fallback;
  }
  for (const candidate of candidates) {
    const match = locations.find((loc) =>
      isMatchingOffice(candidate, loc.name),
    );
    if (match) {
      return toCanonicalOfficeName(match.name);
    }
  }

  return fallback;
}

/** Tulis ulang daftar lokasi ke officeName kanonik (hindari MNG2_JUAL di UI). */
export function canonicalizeLocationList(
  locations: LocationItem[],
): LocationItem[] {
  const seen = new Set<string>();
  const result: LocationItem[] = [];
  for (const loc of locations) {
    const name = toCanonicalOfficeName(loc.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    result.push({ ...loc, name });
  }
  return result;
}
