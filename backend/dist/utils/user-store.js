import { pool } from "../config/db.js";
export function isItDepartment(value) {
    return value?.trim().toUpperCase() === "IT";
}
export function shouldAssignOwnerRole(input) {
    return isItDepartment(input.office) || isItDepartment(input.description);
}
export async function findUserByUsername(username) {
    const result = await pool.query(`SELECT username, role, office
     FROM "User"
     WHERE username = $1
     LIMIT 1`, [username]);
    return result.rows[0] ?? null;
}
export async function syncUserProfile(input) {
    const username = input.username.trim();
    const office = input.office?.trim() || null;
    const assignOwner = shouldAssignOwnerRole(input);
    const result = await pool.query(`INSERT INTO "User" (username, role, office, "createdAt", "updatedAt")
     VALUES ($1, CASE WHEN $3 THEN 'owner' ELSE NULL END, $2, NOW(), NOW())
     ON CONFLICT (username)
     DO UPDATE SET
       office = COALESCE(EXCLUDED.office, "User".office),
       "updatedAt" = NOW()
     RETURNING username, role, office`, [username, office, assignOwner]);
    return result.rows[0];
}
/** @deprecated use syncUserProfile */
export async function syncUserOffice(input) {
    return syncUserProfile(input);
}
const VALID_ROLES = new Set(["operator", "admin", "owner"]);
export function isValidAppRole(role) {
    return VALID_ROLES.has(role.trim().toLowerCase());
}
export async function listUsers() {
    const result = await pool.query(`SELECT username, role, office
     FROM "User"
     ORDER BY username ASC`);
    return result.rows;
}
export async function updateUserRole(username, role) {
    const normalizedRole = role.trim().toLowerCase();
    if (!isValidAppRole(normalizedRole)) {
        throw new Error("Role tidak valid");
    }
    const result = await pool.query(`UPDATE "User"
     SET role = $2, "updatedAt" = NOW()
     WHERE username = $1
     RETURNING username, role, office`, [username.trim(), normalizedRole]);
    return result.rows[0] ?? null;
}
