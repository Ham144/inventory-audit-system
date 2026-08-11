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
  mongooseId?: string;
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

  const rawOffice =
    readFieldCI(root, "office", "location", "locationCode", "wilayah") ??
    readFieldCI(dataNode, "office", "location", "locationCode", "wilayah") ??
    readFieldCI(userInfoNode, "office", "location", "locationCode", "wilayah");

  const office =
    rawOffice && rawOffice.trim().toUpperCase() === "IT"
      ? undefined
      : rawOffice;

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

  const rawMongooseId =
    readFieldCI(root, "_id", "id") ??
    readFieldCI(dataNode, "_id", "id") ??
    readFieldCI(userInfoNode, "_id", "id");

  const mongooseId = rawMongooseId
    ? String(rawMongooseId).replace(/^ObjectId\(['"]?(.*?)['"]?\)$/, "$1")
    : undefined;

  return { username, office, description, mongooseId };
}

export function readJwtUsername(jwtUser?: StringRecord | null): string | null {
  if (!jwtUser) return null;
  const username =
    readFieldCI(jwtUser, "username", "usernameLdap", "userName", "name") ??
    null;
  return username ?? null;
}

export function readJwtMongooseId(jwtUser?: StringRecord | null): string | null {
  if (!jwtUser) return null;
  const rawId = readFieldCI(jwtUser, "_id", "id");
  return rawId ? String(rawId).replace(/^ObjectId\(['"]?(.*?)['"]?\)$/, "$1") : null;
}
