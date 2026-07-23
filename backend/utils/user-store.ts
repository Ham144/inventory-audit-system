import { pool } from "../config/db.js";

export type StoredUser = {
  username: string;
  role: string | null;
  office: string | null;
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
    `SELECT username, role, office
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
}): Promise<StoredUser> {
  const username = input.username.trim();
  const office = input.office?.trim() || null;
  const assignOwner = shouldAssignOwnerRole(input);

  const result = await pool.query<StoredUser>(
    `INSERT INTO "User" (username, role, office, "createdAt", "updatedAt")
     VALUES ($1, CASE WHEN $3 THEN 'owner' ELSE 'operator' END, $2, NOW(), NOW())
     ON CONFLICT (username)
     DO UPDATE SET
       office = COALESCE(EXCLUDED.office, "User".office),
       role = CASE
         WHEN $3 THEN 'owner'
         ELSE COALESCE("User".role, 'operator')
       END,
       "updatedAt" = NOW()
     RETURNING username, role, office`,
    [username, office, assignOwner],
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
    `SELECT username, role, office
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
     RETURNING username, role, office`,
    [username.trim(), normalizedRole],
  );
  return result.rows[0] ?? null;
}

export async function updateUserOffice(
  username: string,
  office: string | null,
): Promise<StoredUser | null> {
  const normalizedOffice = office?.trim() || null;
  const result = await pool.query<StoredUser>(
    `UPDATE "User"
     SET office = $2, "updatedAt" = NOW()
     WHERE username = $1
     RETURNING username, role, office`,
    [username.trim(), normalizedOffice],
  );
  return result.rows[0] ?? null;
}
