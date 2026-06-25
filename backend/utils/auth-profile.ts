type StringRecord = Record<string, unknown>;

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readFieldCI(
  record: StringRecord | null | undefined,
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

export type AuthProfileFields = {
  username?: string;
  office?: string;
  description?: string;
};

export function extractAuthProfileFields(
  data: unknown,
): AuthProfileFields | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const root = data as StringRecord;
  const dataNode =
    typeof root.data === "object" &&
    root.data !== null &&
    !Array.isArray(root.data)
      ? (root.data as StringRecord)
      : null;
  const userInfoNode =
    typeof root.userInfo === "object" &&
    root.userInfo !== null &&
    !Array.isArray(root.userInfo)
      ? (root.userInfo as StringRecord)
      : null;

  const username =
    readFieldCI(dataNode, "username", "usernameLdap", "userName", "name") ??
    readFieldCI(userInfoNode, "username", "usernameLdap", "userName", "name") ??
    readFieldCI(root, "username", "usernameLdap", "userName", "name");

  if (!username) return null;

  const office =
    readFieldCI(root, "office", "location", "locationCode", "wilayah") ??
    readFieldCI(dataNode, "office", "location", "locationCode", "wilayah") ??
    readFieldCI(userInfoNode, "office", "location", "locationCode", "wilayah");

  const description =
    readFieldCI(root, "description", "department", "division", "jobTitle") ??
    readFieldCI(
      dataNode,
      "description",
      "department",
      "division",
      "jobTitle",
    ) ??
    readFieldCI(
      userInfoNode,
      "description",
      "department",
      "division",
      "jobTitle",
    );

  return { username, office, description };
}

export function readJwtUsername(jwtUser?: StringRecord | null): string | null {
  if (!jwtUser) return null;
  const username =
    readFieldCI(jwtUser, "username", "usernameLdap", "userName", "name") ??
    null;
  return username ?? null;
}
