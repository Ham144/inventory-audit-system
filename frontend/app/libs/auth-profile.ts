function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export type AuthProfile = {
  username: string;
  office: string | null;
  description: string | null;
};

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
    readString(data?.username) ??
    readString(userInfo?.username) ??
    readString(root.username) ??
    readString(data?.name) ??
    readString(userInfo?.name);

  if (!username) return null;

  const office =
    readString(root.office) ??
    readString(data?.office) ??
    readString(userInfo?.office) ??
    readString(root.location) ??
    readString(data?.location) ??
    readString(userInfo?.location) ??
    null;

  const description =
    readString(data?.description) ??
    readString(userInfo?.description) ??
    readString(root.description) ??
    null;

  return { username, office, description };
}
