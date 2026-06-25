import { findUserByUsername } from "./user-store.js";
import { readJwtUsername } from "./auth-profile.js";
export { readJwtUsername } from "./auth-profile.js";
function normalizeRole(role) {
    const value = role?.trim().toLowerCase();
    if (value === "operator" || value === "admin" || value === "owner") {
        return value;
    }
    return null;
}
function readUsername(jwtUser) {
    return readJwtUsername(jwtUser);
}
function readOfficeFromJwt(jwtUser) {
    if (!jwtUser)
        return null;
    const office = jwtUser.office ?? jwtUser.location;
    return typeof office === "string" && office.trim() ? office.trim() : null;
}
export function userRole(user) {
    return normalizeRole(user?.role);
}
export function isOwner(user) {
    return userRole(user) === "owner";
}
export function isAdmin(user) {
    return userRole(user) === "admin";
}
export function canAccessAdmin(user) {
    return isAdmin(user) || isOwner(user);
}
export function canScan(user, requestedOffice) {
    if (isOwner(user)) {
        return Boolean(user?.office?.trim() || requestedOffice?.trim());
    }
    return Boolean(user?.office?.trim());
}
export async function resolveAppUser(req) {
    const username = readUsername(req.user);
    if (!username)
        return null;
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
export function resolveOfficeFilter(user, requestedOffice) {
    const requested = requestedOffice?.trim();
    if (isOwner(user) || isAdmin(user)) {
        return requested || user?.office?.trim() || "Semua";
    }
    if (user?.office?.trim()) {
        return user.office.trim();
    }
    return requested || "Semua";
}
export function assertScanAccess(user, requestedOffice) {
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
