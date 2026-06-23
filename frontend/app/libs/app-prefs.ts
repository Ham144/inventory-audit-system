export type AppTheme = "light" | "dark";

const THEME_KEY = "stok-opname-theme";
const ADMIN_OFFICE_KEY = "stok-opname-admin-default-office";

export function getAppTheme(): AppTheme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "dark" ? "dark" : "light";
}

export function setAppTheme(theme: AppTheme) {
  if (typeof window === "undefined") return;
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.dataset.theme = theme;
}

export function applyStoredTheme() {
  if (typeof window === "undefined") return;
  document.documentElement.dataset.theme = getAppTheme();
}

export function getAdminDefaultOffice(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ADMIN_OFFICE_KEY)?.trim() ?? "";
}

export function setAdminDefaultOffice(office: string) {
  if (typeof window === "undefined") return;
  const value = office.trim();
  if (value) {
    localStorage.setItem(ADMIN_OFFICE_KEY, value);
  } else {
    localStorage.removeItem(ADMIN_OFFICE_KEY);
  }
}
