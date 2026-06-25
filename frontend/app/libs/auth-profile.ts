import type { AppRole } from "~/libs/user-access";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readFieldCI(
  record: Record<string, unknown> | null | undefined,
  ...names: string[]
) {
  if (!record) return undefined;
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

export type AuthProfile = {
  username: string;
  office: string | null;
  description: string | null;
};

export function isItDepartment(value?: string | null): boolean {
  return value?.trim().toUpperCase() === "IT";
}

export function inferRoleFromProfile(
  profile: Pick<AuthProfile, "office" | "description">,
): AppRole | null {
  if (
    isItDepartment(profile.office) ||
    isItDepartment(profile.description)
  ) {
    return "owner";
  }
  return null;
}

export function parseAuthProfile(payload: unknown): AuthProfile | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const root = payload as Record<string, unknown>;
  const data =
    typeof root.data === "object" && root.data !== null && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : null;
  const userInfo =
    typeof root.userInfo === "object" &&
    root.userInfo !== null &&
    !Array.isArray(root.userInfo)
      ? (root.userInfo as Record<string, unknown>)
      : null;

  const username =
    readFieldCI(data, "username", "usernameLdap", "userName", "name") ??
    readFieldCI(userInfo, "username", "usernameLdap", "userName", "name") ??
    readFieldCI(root, "username", "usernameLdap", "userName", "name");

  if (!username) return null;

  const office =
    readFieldCI(root, "office", "location", "locationCode", "wilayah") ??
    readFieldCI(data, "office", "location", "locationCode", "wilayah") ??
    readFieldCI(userInfo, "office", "location", "locationCode", "wilayah") ??
    null;

  const description =
    readFieldCI(root, "description", "department", "division", "jobTitle") ??
    readFieldCI(data, "description", "department", "division", "jobTitle") ??
    readFieldCI(userInfo, "description", "department", "division", "jobTitle") ??
    null;

  return { username, office, description };
}

export function resolveUserRole(
  profile: AuthProfile,
  syncedRole?: string | null,
): AppRole | undefined {
  const normalized = syncedRole?.trim().toLowerCase();
  if (
    normalized === "operator" ||
    normalized === "admin" ||
    normalized === "owner"
  ) {
    return normalized;
  }
  return inferRoleFromProfile(profile) ?? undefined;
}
