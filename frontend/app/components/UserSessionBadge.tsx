import { UserCheck, LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { logout } from "~/api/authApi";
import { userSessionLabel } from "~/libs/user-access";
import { useUserInfo } from "~/store";

export function UserSessionBadge() {
  const { userInfo } = useUserInfo();
  const navigate = useNavigate();

  if (!userInfo?.username) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-750 text-[10px] font-bold tracking-wider border border-indigo-150 shadow-sm">
        <UserCheck className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
        <span>{userSessionLabel(userInfo)}</span>
        {userInfo.office && <span>- {userInfo.office} (office)</span>}
        {userInfo.description && <span>- {userInfo.description} (desc)</span>}
      </span>
      <button
        type="button"
        onClick={async () => {
          await logout();
          navigate("/login");
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 text-[10px] font-bold tracking-wider border border-rose-200 shadow-sm transition-colors cursor-pointer"
        title="Logout"
      >
        <LogOut className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">Logout</span>
      </button>
    </div>
  );
}
