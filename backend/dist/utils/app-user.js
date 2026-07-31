import { findUserByUsername, isItDepartment } from "./user-store.js";
import { readJwtUsername } from "./auth-profile.js";
import { mapLocationToOffice } from "./office-mapping.js";
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
    if (isAdmin(user)) {
        return false;
    }
    if (isOwner(user)) {
        return Boolean(user?.office?.trim() || requestedOffice?.trim());
    }
    return Boolean(user?.office?.trim());
}
export async function resolveAppUser(req) {
    console.log("DEBUG resolveAppUser: req.user =", req.user);
    const username = readUsername(req.user);
    console.log("DEBUG resolveAppUser: username =", username);
    if (!username)
        return null;
    const dbUser = await findUserByUsername(username);
    console.log("DEBUG resolveAppUser: dbUser =", dbUser);
    if (dbUser) {
        const rawOffice = dbUser.office?.trim() || null;
        const cleanOffice = isItDepartment(rawOffice) ? null : rawOffice;
        const res = {
            username: dbUser.username,
            role: dbUser.role ?? "operator",
            office: cleanOffice,
        };
        console.log("DEBUG resolveAppUser: returning dbUser mapping =", res);
        return res;
    }
    const rawJwtOffice = readOfficeFromJwt(req.user);
    const cleanJwtOffice = isItDepartment(rawJwtOffice) ? null : rawJwtOffice;
    const res = {
        username,
        role: null,
        office: cleanJwtOffice,
    };
    console.log("DEBUG resolveAppUser: returning JWT fallback =", res);
    return res;
}
export function resolveOfficeFilter(user, requestedOffice) {
    const requested = requestedOffice?.trim();
    if (isOwner(user) || isAdmin(user)) {
        const rawOffice = requested || user?.office?.trim() || "Semua";
        return rawOffice === "Semua" ? "Semua" : mapLocationToOffice(rawOffice);
    }
    if (user?.office?.trim()) {
        return mapLocationToOffice(user.office.trim());
    }
    const rawOffice = requested || "Semua";
    return rawOffice === "Semua" ? "Semua" : mapLocationToOffice(rawOffice);
}
export function assertScanAccess(user, requestedOffice) {
    if (!user) {
        return { ok: false, status: 401, message: "User tidak ditemukan" };
    }
    if (isAdmin(user)) {
        return {
            ok: false,
            status: 403,
            message: "Admin tidak diperbolehkan melakukan scan input fisik.",
        };
    }
    const rawOffice = requestedOffice?.trim() || user.office?.trim();
    if (!rawOffice) {
        return {
            ok: false,
            status: 403,
            message: "Lokasi office tidak ditemukan. Pilih atau hubungi admin untuk menyetel office.",
        };
    }
    // Return rawOffice as-is; async mapping is handled by the caller (route)
    return { ok: true, office: rawOffice };
}
