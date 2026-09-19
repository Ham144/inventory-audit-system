import { getUserInfo, refreshSession } from "~/api/authApi";
import { getAppUser, syncAppUser } from "~/api/opnameUserApi";
import { parseAuthProfile, resolveUserRole } from "~/libs/auth-profile";
import type { UserInfo } from "~/store";

export async function resolveUserInfoFromAuthPayload(
  res: unknown,
): Promise<UserInfo | null> {
  const profile = parseAuthProfile(res);
  if (!profile) return null;
  
  try {
    const synced = await syncAppUser({
      office: profile.office,
      description: profile.description,
    });
    const rawOffice = synced.office ?? profile.office;
    const cleanOffice =
      parseAuthProfile({ office: rawOffice })?.office ?? null;
    return {
      username: profile.username,
      office: cleanOffice,
      description: profile.description ?? undefined,
      role: resolveUserRole(profile, synced.role),
    };
  } catch {
    try {
      const appUser = await getAppUser();
      const rawOffice = appUser.office ?? profile.office;
      const cleanOffice =
        parseAuthProfile({ office: rawOffice })?.office ?? null;
      return {
        username: profile.username,
        office: cleanOffice,
        description: profile.description ?? undefined,
        role: resolveUserRole(profile, appUser.role),
      };
    } catch {
      return {
        username: profile.username,
        office: profile.office,
        description: profile.description ?? undefined,
        role: resolveUserRole(profile),
      };
    }
  }
}

export async function bootstrapSession(): Promise<UserInfo | null> {
  await refreshSession();
  const res = await getUserInfo();
  if (!res) return null;
  return resolveUserInfoFromAuthPayload(res);
}
