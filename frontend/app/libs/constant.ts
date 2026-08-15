const DEV_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "192.168.169.12",
]);

const getHostname = () => {
  if (typeof window !== "undefined") {
    return window.location.hostname;
  }
  return "";
};

// Use the actual browser hostname when available so production builds
// served from a different host do not inherit a dev backend target.
export const NODE_ENV = DEV_HOSTNAMES.has(getHostname())
  ? "development"
  : "production";

export const BASE_URL =
  NODE_ENV === "development"
    ? "http://192.168.169.12:3000"
    : "http://192.168.169.26:3000";
