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
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
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
  } catch (err) {
    console.error("Failed to fetch mappings on frontend:", err);
  }
}

export function clearFrontendMappingsCache() {
  cachedMappings = [];
  mappingsFetched = false;
}

function toConsonants(str: string): string {
  let s = str.toLowerCase();
  if (s.startsWith("wl")) {
    s = s.substring(2);
  }
  s = s.replace(/2/g, "d");
  return s.replace(/[^a-z]/g, "").replace(/[aeiou]/g, "");
}

function isSubsequence(sub: string, main: string): boolean {
  let subIdx = 0;
  for (let mainIdx = 0; mainIdx < main.length && subIdx < sub.length; mainIdx++) {
    if (sub[subIdx] === main[mainIdx]) {
      subIdx++;
    }
  }
  return subIdx === sub.length;
}

export function isMatchingOffice(officeName: string, locationCode: string): boolean {
  const officeClean = officeName.trim().toLowerCase();
  const codeClean = locationCode.trim().toLowerCase();
  
  if (officeClean === codeClean) return true;
  
  if (!mappingsFetched) {
    mappingsFetched = true; // prevent parallel fetches
    fetchAndCacheMappings().catch(() => {});
  }

  // Try cached database mappings first
  if (cachedMappings.length > 0) {
    const match = cachedMappings.find(
      (m) =>
        m.officeName.toLowerCase() === officeClean &&
        m.locationCode.toLowerCase() === codeClean,
    );
    if (match) return true;
  }
  
  const baseCode = codeClean.split("_")[0];
  if (officeClean.includes(baseCode) || baseCode.includes(officeClean)) return true;
  
  const officeConsonants = toConsonants(officeName);
  const codeConsonants = toConsonants(baseCode);
  
  if (!officeConsonants || !codeConsonants) return false;
  
  return isSubsequence(codeConsonants, officeConsonants) || isSubsequence(officeConsonants, codeConsonants);
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
  return match ? match.name : "Semua";
}

export function resolveInitialPickedOffice(input: {
  userOffice?: string;
  savedOffice?: string;
  locations: LocationItem[];
  fallback?: string;
}): string {
  const fallback = input.fallback ?? "Semua";
  const candidates = [input.userOffice, input.savedOffice]
    .map((value) => value?.trim())
    .filter(Boolean) as string[];

  if (input.locations.length === 0) {
    return candidates[0] ?? fallback;
  }

  for (const candidate of candidates) {
    const match = input.locations.find((loc) => isMatchingOffice(candidate, loc.name));
    if (match) return match.name;
  }

  return fallback;
}
