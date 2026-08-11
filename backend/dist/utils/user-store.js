import { pool } from "../config/db.js";
import { resolveOfficeName } from "./office-mapping.js";
export function isItDepartment(value) {
    return value?.trim().toUpperCase() === "IT";
}
export function shouldAssignOwnerRole(input) {
    return isItDepartment(input.office) || isItDepartment(input.description);
}
export async function findUserByUsername(username) {
    const result = await pool.query(`SELECT username, role, office, type
     FROM "User"
     WHERE username = $1
     LIMIT 1`, [username]);
    return result.rows[0] ?? null;
}
export async function syncUserProfile(input) {
    const username = input.username.trim();
    const rawOffice = input.office?.trim() || null;
    const assignOwner = shouldAssignOwnerRole(input);
    const userType = input.type?.trim() || "external";
    // If rawOffice is "IT", it is a department name, not a physical office location
    let sanitizedOffice = isItDepartment(rawOffice) ? null : rawOffice;
    if (sanitizedOffice) {
        const resolved = await resolveOfficeName(sanitizedOffice);
        if (resolved) {
            sanitizedOffice = resolved;
        }
    }
    const result = await pool.query(`INSERT INTO "User" (username, role, office, type, "createdAt", "updatedAt")
     VALUES ($1, CASE WHEN $3 THEN 'owner' ELSE 'operator' END, $2, $4, NOW(), NOW())
     ON CONFLICT (username)
     DO UPDATE SET
       office = CASE
         WHEN "User".office IS NOT NULL AND TRIM("User".office) <> '' AND UPPER(TRIM("User".office)) <> 'IT'
         THEN "User".office
         ELSE EXCLUDED.office
       END,
       type = CASE
         WHEN "User".type = 'app' THEN 'app'
         ELSE COALESCE(EXCLUDED.type, "User".type, 'external')
       END,
       "updatedAt" = NOW()
     RETURNING username, role, office, type`, [username, sanitizedOffice, assignOwner, userType]);
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
    const result = await pool.query(`SELECT username, role, office, type
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
     RETURNING username, role, office, type`, [username.trim(), normalizedRole]);
    return result.rows[0] ?? null;
}
export async function updateUserOffice(username, office) {
    const rawOffice = office?.trim() || null;
    let sanitizedOffice = isItDepartment(rawOffice) ? null : rawOffice;
    if (sanitizedOffice) {
        const resolved = await resolveOfficeName(sanitizedOffice);
        if (resolved) {
            sanitizedOffice = resolved;
        }
    }
    const result = await pool.query(`UPDATE "User"
     SET office = $2, "updatedAt" = NOW()
     WHERE username = $1
     RETURNING username, role, office, type`, [username.trim(), sanitizedOffice]);
    return result.rows[0] ?? null;
}
export async function deleteUser(username) {
    const target = username.trim();
    await pool.query(`DELETE FROM "TracingInput" WHERE username = $1`, [target]);
    const result = await pool.query(`DELETE FROM "User" WHERE username = $1`, [target]);
    return (result.rowCount ?? 0) > 0;
}
export async function upsertUser(input) {
    const username = input.username.trim();
    const role = input.role?.trim().toLowerCase() || "operator";
    const office = input.office?.trim() || null;
    const userType = input.type?.trim() || "app";
    if (!isValidAppRole(role)) {
        throw new Error("Role tidak valid");
    }
    const result = await pool.query(`INSERT INTO "User" (username, role, office, type, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (username)
     DO UPDATE SET
       role = EXCLUDED.role,
       office = EXCLUDED.office,
       type = EXCLUDED.type,
       "updatedAt" = NOW()
     RETURNING username, role, office, type`, [username, role, office, userType]);
    return result.rows[0];
}
