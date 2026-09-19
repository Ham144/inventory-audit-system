import { create } from "zustand";

export interface UserInfo {
  _id?: string;
  username?: string;
  displayName?: string;
  email?: string | null;
  location?: string | null;
  office?: string | null;
  role?: string;
  description?: string;
  authMethod?: string;
  [key: string]: any;
}

const SESSION_USER_KEY = "stok-opname-session-user";

function readCachedUserInfo(): UserInfo | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(SESSION_USER_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as UserInfo;
  } catch {
    return undefined;
  }
}

function writeCachedUserInfo(userInfo: UserInfo | null) {
  if (typeof window === "undefined") return;
  if (userInfo?.username) {
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(userInfo));
    return;
  }
  sessionStorage.removeItem(SESSION_USER_KEY);
}

interface UserState {
  userInfo: UserInfo | null | undefined;
  authChecked: boolean;
  setUserInfo: (userInfo: UserInfo | null) => void;
  clearUserInfo: () => void;
  setAuthChecked: (checked: boolean) => void;
}

export const useUserInfo = create<UserState>((set) => ({
  userInfo: readCachedUserInfo(),
  authChecked: false,
  setUserInfo: (userInfo) => {
    writeCachedUserInfo(userInfo);
    set(() => ({ userInfo }));
  },
  clearUserInfo: () => {
    writeCachedUserInfo(null);
    set(() => ({ userInfo: null }));
  },
  setAuthChecked: (authChecked) => set(() => ({ authChecked })),
}));
