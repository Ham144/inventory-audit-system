import { pool } from "../config/db.js";
import { resolveOfficeName } from "./office-mapping.js";

export type StoredUser = {
  username: string;
  role: string | null;
  office: string | null;
  type: string | null;
  mongooseId: string | null;
};

export function isItDepartment(value?: string | null): boolean {
  return value?.trim().toUpperCase() === "IT";
}

export function shouldAssignOwnerRole(input: {
  office?: string | null;
  description?: string | null;
}): boolean {
  return isItDepartment(input.office) || isItDepartment(input.description);
}

export async function findUserByUsername(
  username: string,
): Promise<StoredUser | null> {
  const result = await pool.query<StoredUser>(
    `SELECT username, role, office, type, "mongooseId"
     FROM "User"
     WHERE username = $1
     LIMIT 1`,
    [username],
  );
  return result.rows[0] ?? null;
}

export async function syncUserProfile(input: {
  username: string;
  office?: string | null;
  description?: string | null;
  type?: string | null;
  mongooseId?: string | null;
}): Promise<StoredUser> {
  const username = input.username.trim();
  const rawOffice = input.office?.trim() || null;
  const assignOwner = shouldAssignOwnerRole(input);
  const userType = input.type?.trim() || "external";
  const mongooseId = input.mongooseId?.trim() || null;

  // If rawOffice is "IT", it is a department name, not a physical office location
  let sanitizedOffice: string | null = isItDepartment(rawOffice) ? null : rawOffice;
  if (sanitizedOffice) {
    const resolved = await resolveOfficeName(sanitizedOffice);
    if (resolved) {
      sanitizedOffice = resolved;
    }
  }

  const result = await pool.query<StoredUser>(
    `INSERT INTO "User" (username, role, office, type, "mongooseId", "createdAt", "updatedAt")
     VALUES ($1, CASE WHEN $3 THEN 'owner' ELSE 'operator' END, $2, $4, $5, NOW(), NOW())
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
       "mongooseId" = COALESCE(EXCLUDED."mongooseId", "User"."mongooseId"),
       "updatedAt" = NOW()
     RETURNING username, role, office, type, "mongooseId"`,
    [username, sanitizedOffice, assignOwner, userType, mongooseId],
  );

  return result.rows[0];
}

/** @deprecated use syncUserProfile */
export async function syncUserOffice(input: {
  username: string;
  office?: string | null;
}): Promise<StoredUser> {
  return syncUserProfile(input);
}

const VALID_ROLES = new Set(["operator", "admin", "owner"]);

export function isValidAppRole(role: string): boolean {
  return VALID_ROLES.has(role.trim().toLowerCase());
}

export async function listUsers(): Promise<StoredUser[]> {
  const result = await pool.query<StoredUser>(
    `SELECT username, role, office, type, "mongooseId"
     FROM "User"
     ORDER BY username ASC`,
  );
  return result.rows;
}

export async function updateUserRole(
  username: string,
  role: string,
): Promise<StoredUser | null> {
  const normalizedRole = role.trim().toLowerCase();
  if (!isValidAppRole(normalizedRole)) {
    throw new Error("Role tidak valid");
  }

  const result = await pool.query<StoredUser>(
    `UPDATE "User"
     SET role = $2, "updatedAt" = NOW()
     WHERE username = $1
     RETURNING username, role, office, type, "mongooseId"`,
    [username.trim(), normalizedRole],
  );
  return result.rows[0] ?? null;
}

export async function updateUserOffice(
  username: string,
  office: string | null,
): Promise<StoredUser | null> {
  const rawOffice = office?.trim() || null;
  let sanitizedOffice: string | null = isItDepartment(rawOffice) ? null : rawOffice;
  if (sanitizedOffice) {
    const resolved = await resolveOfficeName(sanitizedOffice);
    if (resolved) {
      sanitizedOffice = resolved;
    }
  }

  const result = await pool.query<StoredUser>(
    `UPDATE "User"
     SET office = $2, "updatedAt" = NOW()
     WHERE username = $1
     RETURNING username, role, office, type, "mongooseId"`,
    [username.trim(), sanitizedOffice],
  );
  return result.rows[0] ?? null;
}

export async function deleteUser(username: string): Promise<boolean> {
  const target = username.trim();
  await pool.query(
    `DELETE FROM "TracingInput" WHERE username = $1`,
    [target],
  );
  const result = await pool.query(
    `DELETE FROM "User" WHERE username = $1`,
    [target],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function upsertUser(input: {
  username: string;
  role?: string | null;
  office?: string | null;
  type?: string | null;
  mongooseId?: string | null;
}): Promise<StoredUser> {
  const username = input.username.trim();
  const role = input.role?.trim().toLowerCase() || "operator";
  const office = input.office?.trim() || null;
  const userType = input.type?.trim() || "app";
  const mongooseId = input.mongooseId?.trim() || null;

  if (!isValidAppRole(role)) {
    throw new Error("Role tidak valid");
  }

  const result = await pool.query<StoredUser>(
    `INSERT INTO "User" (username, role, office, type, "mongooseId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (username)
     DO UPDATE SET
       role = EXCLUDED.role,
       office = EXCLUDED.office,
       type = EXCLUDED.type,
       "mongooseId" = COALESCE(EXCLUDED."mongooseId", "User"."mongooseId"),
       "updatedAt" = NOW()
     RETURNING username, role, office, type, "mongooseId"`,
    [username, role, office, userType, mongooseId],
  );
  return result.rows[0];
}

