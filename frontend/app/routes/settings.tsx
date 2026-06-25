import { useEffect, useState } from "react";
import { Link, redirect } from "react-router";
import {
  Settings,
  ArrowLeft,
  User,
  RefreshCw,
  Palette,
  Shield,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DocsShell } from "~/components/DocsShell";
import { useUserInfo } from "~/store";
import {
  getAppUser,
  listAppUsers,
  syncAppUser,
  updateAppUserRole,
} from "~/api/opnameUserApi";
import locationApi from "~/api/LocationApi";
import {
  type AppRole,
  canAccessAdmin,
  isOwner,
  userRole,
  userSessionLabel,
} from "~/libs/user-access";
import {
  getAdminDefaultOffice,
  getAppTheme,
  setAdminDefaultOffice,
  setAppTheme,
  type AppTheme,
} from "~/libs/app-prefs";
import { normalizeLocationList, type LocationItem } from "~/libs/location";

const ROLE_LABELS: Record<AppRole, string> = {
  operator: "Operator",
  admin: "Admin",
  owner: "Owner",
};

const ROLE_BADGE: Record<AppRole, string> = {
  operator: "badge-ghost",
  admin: "badge-primary",
  owner: "badge-secondary",
};

function roleBadgeClass(role: AppRole | null) {
  if (!role) return "badge-ghost";
  return ROLE_BADGE[role];
}

export default function SettingsPage() {
  const { userInfo, setUserInfo } = useUserInfo();
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<AppTheme>(() => getAppTheme());
  const [adminOffice, setAdminOffice] = useState(() => getAdminDefaultOffice());
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "warning";
  } | null>(null);

  const showOwnerSection = isOwner(userInfo);
  const currentRole = userRole(userInfo);

  const profileQuery = useQuery({
    queryKey: ["app-user", "me"],
    queryFn: getAppUser,
    enabled: Boolean(userInfo?.username),
  });

  const usersQuery = useQuery({
    queryKey: ["app-users"],
    queryFn: listAppUsers,
    enabled: showOwnerSection,
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      syncAppUser({
        office: userInfo?.office ?? null,
        description: userInfo?.description ?? null,
      }),
    onSuccess: (data) => {
      setUserInfo({
        ...userInfo,
        office: data.office ?? userInfo?.office,
        role: data.role ?? userInfo?.role,
      });
      queryClient.invalidateQueries({ queryKey: ["app-user", "me"] });
      setToast({ message: "Office berhasil disinkronkan", type: "success" });
    },
    onError: () => {
      setToast({ message: "Gagal sinkronisasi office", type: "warning" });
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ username, role }: { username: string; role: AppRole }) =>
      updateAppUserRole(username, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-users"] });
      setToast({ message: "Role berhasil diperbarui", type: "success" });
    },
    onError: () => {
      setToast({ message: "Gagal memperbarui role", type: "warning" });
    },
  });

  useEffect(() => {
    if (!userInfo?.username) {
      redirect("/login");
      return;
    }
    if (!canAccessAdmin(userInfo)) {
      redirect("/input");
    }
  }, [userInfo]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!showOwnerSection) return;

    const fetchLocations = async () => {
      try {
        const res = await locationApi.getAllLocation("");
        setLocations(normalizeLocationList(res));
      } catch {
        setLocations([]);
      }
    };
    fetchLocations();
  }, [showOwnerSection]);

  const handleThemeChange = (next: AppTheme) => {
    setTheme(next);
    setAppTheme(next);
  };

  const handleAdminOfficeChange = (value: string) => {
    setAdminOffice(value);
    setAdminDefaultOffice(value);
    setToast({ message: "Default office admin disimpan", type: "success" });
  };

  const displayOffice =
    profileQuery.data?.office ?? userInfo?.office ?? "—";

  return (
    <DocsShell title="Pengaturan" subtitle="Settings" showDocSidebar={false}>
      <div className="max-w-3xl space-y-6">
        <Link
          to="/input"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Kembali ke input scan
        </Link>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-slate-100 text-slate-600">
            <Settings className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900">Pengaturan</h1>
            <p className="text-sm text-slate-500">{userSessionLabel(userInfo)}</p>
          </div>
        </div>

        {/* Profil */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-indigo-500" />
            <h2 className="font-bold text-slate-900">Profil</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Username
              </p>
              <p className="font-semibold text-slate-800">
                {userInfo?.username ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Role
              </p>
              <span className={`badge badge-sm font-bold ${roleBadgeClass(currentRole)}`}>
                {currentRole ? ROLE_LABELS[currentRole] : "Belum diset"}
              </span>
            </div>
            <div className="sm:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Office (read-only dari ERP)
              </p>
              <p className="font-semibold text-slate-800">{displayOffice}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="btn btn-sm btn-outline border-indigo-200 text-indigo-700 gap-2"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`}
            />
            Sinkronkan Office
          </button>
        </section>

        {/* Preferensi UI */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-indigo-500" />
            <h2 className="font-bold text-slate-900">Preferensi UI</h2>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Tema
            </p>
            <div className="join">
              <button
                type="button"
                className={`btn btn-sm join-item ${theme === "light" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => handleThemeChange("light")}
              >
                Light
              </button>
              <button
                type="button"
                className={`btn btn-sm join-item ${theme === "dark" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => handleThemeChange("dark")}
              >
                Dark
              </button>
            </div>
          </div>

          {showOwnerSection && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Default Office Admin
              </p>
              <select
                className="select select-bordered select-sm w-full max-w-xs bg-slate-50 font-semibold"
                value={adminOffice}
                onChange={(e) => handleAdminOfficeChange(e.target.value)}
              >
                <option value="">— Tidak ada default —</option>
                {locations.map((loc) => (
                  <option key={loc.code} value={loc.code}>
                    {loc.name || loc.description || loc.code}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1.5">
                Dipakai saat membuka halaman admin sebagai owner.
              </p>
            </div>
          )}
        </section>

        {/* Manajemen Role */}
        {showOwnerSection && (
          <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-indigo-500" />
              <h2 className="font-bold text-slate-900">Manajemen Role</h2>
            </div>

            {usersQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <span className="loading loading-spinner loading-md text-indigo-500" />
              </div>
            ) : usersQuery.isError ? (
              <p className="text-sm text-red-600">Gagal memuat daftar user.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="table table-sm">
                  <thead>
                    <tr className="text-slate-500">
                      <th>Username</th>
                      <th>Office</th>
                      <th>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(usersQuery.data ?? []).map((row) => {
                      const isSelf = row.username === userInfo?.username;
                      return (
                        <tr key={row.username}>
                          <td className="font-semibold">{row.username}</td>
                          <td className="text-slate-600">
                            {row.office ?? "—"}
                          </td>
                          <td>
                            {isSelf ? (
                              <span className="text-xs text-slate-400">
                                {ROLE_LABELS[userRole({ role: row.role ?? undefined }) ?? "operator"]}{" "}
                                (tidak bisa ubah sendiri)
                              </span>
                            ) : (
                              <select
                                className="select select-bordered select-xs font-semibold"
                                value={(row.role ?? "operator").toLowerCase()}
                                disabled={roleMutation.isPending}
                                onChange={(e) =>
                                  roleMutation.mutate({
                                    username: row.username,
                                    role: e.target.value as AppRole,
                                  })
                                }
                              >
                                <option value="operator">Operator</option>
                                <option value="admin">Admin</option>
                                <option value="owner">Owner</option>
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div
            className={`flex items-center gap-3 px-5 py-4 rounded-2xl border backdrop-blur-xl shadow-xl ${
              toast.type === "success"
                ? "bg-white border-emerald-200/80 text-emerald-900"
                : "bg-white border-red-200/80 text-red-900"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-500" />
            )}
            <span className="text-sm font-semibold">{toast.message}</span>
          </div>
        </div>
      )}
    </DocsShell>
  );
}
