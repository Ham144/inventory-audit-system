import type { UserInfo } from "~/store";

export type AppRole = "operator" | "admin" | "owner";

function normalizeRole(role?: string | null): AppRole | null {
  const value = role?.trim().toLowerCase();
  if (value === "operator" || value === "admin" || value === "owner") {
    return value;
  }
  return null;
}

export function userRole(user: UserInfo | null | undefined): AppRole | null {
  return normalizeRole(user?.role);
}

export function isOwner(user: UserInfo | null | undefined): boolean {
  return userRole(user) === "owner";
}

export function isAdmin(user: UserInfo | null | undefined): boolean {
  return userRole(user) === "admin";
}

export function isOperator(user: UserInfo | null | undefined): boolean {
  return userRole(user) === "operator";
}

export function canAccessAdmin(user: UserInfo | null | undefined): boolean {
  return isAdmin(user) || isOwner(user);
}

export function adminCanPickOffice(user: UserInfo | null | undefined): boolean {
  return isAdmin(user) || isOwner(user);
}

export function userOffice(user: UserInfo | null | undefined): string {
  return user?.office?.trim() ?? "";
}

export function ownerNeedsLocationPicker(
  user: UserInfo | null | undefined,
): boolean {
  return isOwner(user) && !userOffice(user);
}

export function canScan(
  user: UserInfo | null | undefined,
  pickedOffice?: string,
): boolean {
  if (isOwner(user)) {
    return Boolean(userOffice(user) || pickedOffice?.trim());
  }
  return Boolean(userOffice(user));
}

export function compareOfficeScope(
  user: UserInfo | null | undefined,
  pickedOffice?: string,
): string {
  if (isOwner(user) || isAdmin(user)) {
    return pickedOffice?.trim() || "Semua";
  }
  return userOffice(user);
}

export function userSessionLabel(user: UserInfo | null | undefined): string {
  const name =
    user?.username?.trim() ||
    user?.displayName?.trim() ||
    user?.name?.trim() ||
    "";
  const role = userRole(user);
  if (role === "owner") return `Owner: ${name}`;
  if (role === "admin") return `Admin: ${name}`;
  return `Opr: ${name}`;
}
