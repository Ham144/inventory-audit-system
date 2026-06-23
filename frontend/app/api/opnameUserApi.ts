import axiosInstance from "./axios-instance";
import type { AppRole } from "~/libs/user-access";

export type AppUserRecord = {
  username: string;
  role: string | null;
  office: string | null;
};

export async function syncAppUser(payload: {
  office?: string | null;
  description?: string | null;
}) {
  const response = await axiosInstance.post<AppUserRecord>(
    "/api/opname/me/sync",
    payload,
  );
  return response.data;
}

export async function getAppUser() {
  const response = await axiosInstance.get<AppUserRecord>("/api/opname/me");
  return response.data;
}

export async function listAppUsers() {
  const response = await axiosInstance.get<AppUserRecord[]>("/api/opname/users");
  return response.data;
}

export async function updateAppUserRole(username: string, role: AppRole) {
  const response = await axiosInstance.patch<AppUserRecord>(
    `/api/opname/users/${encodeURIComponent(username)}/role`,
    { role },
  );
  return response.data;
}
