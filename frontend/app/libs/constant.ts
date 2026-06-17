// 1. Ambil hostname secara aman (hanya jika dieksekusi di browser)
const getHostname = () => {
  if (typeof window !== "undefined") {
    return window.location.hostname;
  }
  return "";
};

// 2. Deteksi environment berbasis hostname atau process.env
export const NODE_ENV =
  getHostname() === "192.168.169.12" || process.env.NODE_ENV === "development"
    ? "development"
    : "production";

// 3. Tentukan BASE_URL
export const BASE_URL =
  NODE_ENV === "development"
    ? "http://192.168.169.12:3000"
    : "http://192.168.169.26:3000";

