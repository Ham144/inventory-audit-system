import { Link } from "react-router";
import { Layers, BookOpen, LogIn } from "lucide-react";
import { useUserInfo } from "~/store";
import { AppNavigation } from "./AppNavigation";
import { UserSessionBadge } from "./UserSessionBadge";

const DOC_SECTIONS = [
  { id: "ringkasan", label: "Ringkasan" },
  { id: "role", label: "Role & Akses" },
  { id: "auth", label: "Alur Auth" },
  { id: "scan", label: "Logika Scan" },
  { id: "compare", label: "Rekonsiliasi" },
  { id: "menu", label: "Menu Aplikasi" },
  { id: "api", label: "API Reference" },
] as const;

const APP_MENUS = [
  { path: "/input", label: "/input", desc: "Formulir scan" },
  { path: "/admin", label: "/admin", desc: "Dashboard" },
  { path: "/settings", label: "/settings", desc: "Pengaturan" },
  { path: "/my-logs", label: "/my-logs", desc: "Riwayat scan" },
] as const;

type DocsShellProps = {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  showDocSidebar?: boolean;
};

export function DocsShell({
  children,
  title = "Stok Opname CSI",
  subtitle = "Technical Documentation",
  showDocSidebar = true,
}: DocsShellProps) {
  const { userInfo } = useUserInfo();
  const isLoggedIn = Boolean(userInfo?.username);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="p-2 rounded-xl bg-indigo-500 text-white shadow-sm">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 group-hover:text-indigo-700 transition-colors">
                {title}
              </p>
              <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                {subtitle}
              </p>
            </div>
          </Link>

          <div className="flex flex-wrap items-center gap-3">
            {!isLoggedIn ? (
              <Link
                to="/login"
                className="btn btn-sm btn-ghost gap-1.5 text-slate-600"
              >
                <LogIn className="h-3.5 w-3.5" />
                Login
              </Link>
            ) : (
              <>
                <AppNavigation />
                <div className="hidden sm:block h-6 w-px bg-slate-200" />
                <UserSessionBadge />
              </>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex gap-8 px-6 py-8">
        {showDocSidebar && (
          <aside className="hidden lg:block w-56 shrink-0">
            <div className="sticky top-24 space-y-6">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <BookOpen className="h-3 w-3" />
                  Dokumentasi
                </p>
                <ul className="space-y-1">
                  {DOC_SECTIONS.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className="text-xs font-semibold text-slate-600 hover:text-indigo-600 block py-1.5 px-2 rounded-lg hover:bg-indigo-50 transition-colors"
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Menu App
                </p>
                <ul className="space-y-1">
                  {APP_MENUS.map((m) => (
                    <li key={m.path}>
                      <Link
                        to={m.path}
                        className="text-xs font-semibold text-slate-600 hover:text-indigo-600 block py-1.5 px-2 rounded-lg hover:bg-slate-100 transition-colors"
                      >
                        <span className="font-mono">{m.label}</span>
                        <span className="text-slate-400 font-normal ml-1">
                          — {m.desc}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>
        )}

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

export function StatusBadge({
  status,
}: {
  status: "implemented" | "planned";
}) {
  return (
    <span
      className={`badge badge-sm font-bold ${
        status === "implemented"
          ? "badge-success"
          : "badge-warning"
      }`}
    >
      {status === "implemented" ? "Implemented" : "Planned"}
    </span>
  );
}

export function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 mb-12">
      <h2 className="text-lg font-black text-slate-900 mb-4 pb-2 border-b border-slate-200">
        {title}
      </h2>
      <div className="space-y-4 text-sm text-slate-700 leading-relaxed">
        {children}
      </div>
    </section>
  );
}
