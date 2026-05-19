import { create } from "zustand";

export interface UserInfo {
  _id?: string;
  username?: string;
  displayName?: string;
  email?: string | null;
  location?: string | null;
  role?: string;
  description?: string;
  authMethod?: string;
  [key: string]: any;
}

interface UserState {
  userInfo: UserInfo | null;
  setUserInfo: (userInfo: UserInfo | null) => void;
  clearUserInfo: () => void;
}

export const useUserInfo = create<UserState>((set) => ({
  userInfo: null,
  setUserInfo: (userInfo) => set(() => ({ userInfo })),
  clearUserInfo: () => set(() => ({ userInfo: null })),
}));
