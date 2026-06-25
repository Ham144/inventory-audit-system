export type LocationItem = {
  code: string;
  name?: string;
  description?: string;
};

function readString(value: unknown): string | undefined {
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
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const code =
    readFieldCI(record, "code", "locationCode", "office", "wilayah") ?? "";
  if (!code) return null;

  return {
    code,
    name: readFieldCI(record, "name", "locationName", "title"),
    description: readFieldCI(record, "description", "desc"),
  };
}

function unwrapLocationArray(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];

  const root = response as Record<string, unknown>;
  const candidates = [root.data, root.items, root.locations, root.results];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const nested = candidate as Record<string, unknown>;
      if (Array.isArray(nested.data)) return nested.data;
      if (Array.isArray(nested.items)) return nested.items;
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
    if (!normalized || seen.has(normalized.code)) continue;
    seen.add(normalized.code);
    result.push(normalized);
  }

  return result;
}

export function resolvePickedOffice(
  pickedOffice: string,
  locations: LocationItem[],
): string {
  const value = pickedOffice.trim();
  if (!value || value === "Semua") return "Semua";
  if (locations.some((loc) => loc.code === value)) return value;
  return "Semua";
}
