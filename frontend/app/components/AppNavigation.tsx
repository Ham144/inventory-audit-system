import { History, ScanLine, Settings, Shield, AlertCircle } from "lucide-react";
import { Link, useLocation } from "react-router";
import { canAccessAdmin, isOwner, isAdmin } from "~/libs/user-access";
import { useUserInfo, type UserInfo } from "~/store";

const NAV_ITEMS = [
  {
    path: "/input",
    label: "Input",
    icon: ScanLine,
    show: (user: UserInfo | null | undefined) => !isAdmin(user),
  },
  {
    path: "/admin",
    label: "Admin",
    icon: Shield,
    show: canAccessAdmin,
  },
  {
    path: "/my-logs",
    label: "My Logs",
    icon: History,
    show: () => true,
  },
  {
    path: "/selisih",
    label: "Cek Selisih",
    icon: AlertCircle,
    show: () => true,
  },
  {
    path: "/settings",
    label: "Settings",
    icon: Settings,
    show: isOwner,
  },
] as const;

type AppNavigationProps = {
  className?: string;
};

export function AppNavigation({ className = "" }: AppNavigationProps) {
  const { pathname } = useLocation();
  const { userInfo } = useUserInfo();

  return (
    <nav
      className={`flex items-center gap-1.5 overflow-x-auto rounded-2xl ${className}`}
      aria-label="Navigasi aplikasi"
    >
      {NAV_ITEMS.filter((item) => item.show(userInfo)).map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.path || pathname.startsWith(`${item.path}/`);

        return (
          <Link
            key={item.path}
            to={item.path}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-all duration-150 ${
              isActive
                ? "border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-500/20"
                : "border-transparent bg-transparent text-slate-600 hover:border-indigo-100 hover:bg-indigo-50 hover:text-indigo-700"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
