/**
 * Helpers for calling DATABASE_REUSABLE_API (open/reusable backend).
 * Production expects X_API_KEY as header `x-api-key`.
 */

export function getReusableApiBase(): string {
  return (
    process.env.DATABASE_REUSABLE_API?.trim() ||
    process.env.DATABASE_CENTER?.trim() ||
    "http://192.168.169.12:7047"
  );
}

export function getXApiKey(): string {
  return process.env.X_API_KEY?.trim() || "";
}

/** Headers for outbound calls to the reusable API. */
export function getReusableApiHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const apiKey = getXApiKey();
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}
