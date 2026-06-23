import { findUserByUsername } from "./user-store.js";

export type AppUser = {
  username: string;
  role: string | null;
  office: string | null;
};

export type AppRole = "operator" | "admin" | "owner";

type JwtPayload = Record<string, unknown>;

function normalizeRole(role?: string | null): AppRole | null {
  const value = role?.trim().toLowerCase();
  if (value === "operator" || value === "admin" || value === "owner") {
    return value;
  }
  return null;
}

function readUsername(jwtUser?: JwtPayload): string | null {
  if (!jwtUser) return null;
  const username = jwtUser.username ?? jwtUser.name ?? jwtUser.usernameLdap;
  return typeof username === "string" && username.trim() ? username.trim() : null;
}

function readOfficeFromJwt(jwtUser?: JwtPayload): string | null {
  if (!jwtUser) return null;
  const office = jwtUser.office ?? jwtUser.location;
  return typeof office === "string" && office.trim() ? office.trim() : null;
}

export function userRole(user: AppUser | null | undefined): AppRole | null {
  return normalizeRole(user?.role);
}

export function isOwner(user: AppUser | null | undefined): boolean {
  return userRole(user) === "owner";
}

export function isAdmin(user: AppUser | null | undefined): boolean {
  return userRole(user) === "admin";
}

export function canAccessAdmin(user: AppUser | null | undefined): boolean {
  return isAdmin(user) || isOwner(user);
}

export function canScan(
  user: AppUser | null | undefined,
  requestedOffice?: string,
): boolean {
  if (isOwner(user)) {
    return Boolean(user?.office?.trim() || requestedOffice?.trim());
  }
  return Boolean(user?.office?.trim());
}

export async function resolveAppUser(req: {
  user?: JwtPayload;
}): Promise<AppUser | null> {
  const username = readUsername(req.user);
  if (!username) return null;

  const dbUser = await findUserByUsername(username);

  if (dbUser) {
    return {
      username: dbUser.username,
      role: dbUser.role,
      office: dbUser.office,
    };
  }

  return {
    username,
    role: null,
    office: readOfficeFromJwt(req.user),
  };
}

export function resolveOfficeFilter(
  user: AppUser | null,
  requestedOffice?: string,
): string {
  const requested = requestedOffice?.trim();
  if (isOwner(user) || isAdmin(user)) {
    return requested || user?.office?.trim() || "Semua";
  }
  if (user?.office?.trim()) {
    return user.office.trim();
  }
  return requested || "Semua";
}

export function assertScanAccess(
  user: AppUser | null,
  requestedOffice?: string,
):
  | { ok: true; office: string }
  | { ok: false; status: number; message: string } {
  if (!user) {
    return { ok: false, status: 401, message: "User tidak ditemukan" };
  }

  if (isOwner(user)) {
    const office = user.office?.trim() || requestedOffice?.trim();
    if (!office) {
      return {
        ok: false,
        status: 403,
        message: "Pilih wilayah/lokasi terlebih dahulu.",
      };
    }
    return { ok: true, office };
  }

  const office = user.office?.trim();
  if (!office) {
    return {
      ok: false,
      status: 403,
      message: "Akun tidak memiliki office. Scan tidak diizinkan.",
    };
  }
  return { ok: true, office };
}
