import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Settings,
  ArrowLeft,
  User,
  RefreshCw,
  Palette,
  Shield,
  MapPin,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  UserPlus,
  KeyRound,
  Lock,
  Delete,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DocsShell } from "~/components/DocsShell";
import {
  listOfficeMappings,
  createOfficeMapping,
  updateOfficeMapping,
  deleteOfficeMapping,
  type OfficeMappingRecord,
} from "~/api/officeMappingApi";
import { useUserInfo } from "~/store";
import { createAppUser, resetPassword, deleteAppUser } from "~/api/authApi";
import {
  getAppUser,
  listAppUsers,
  syncAppUser,
  updateAppUserRole,
  updateAppUserOffice,
  deleteAppUserFromOpname,
  syncNonAdAppUser,
  type AppUserRecord,
} from "~/api/opnameUserApi";
import locationApi from "~/api/LocationApi";
import {
  type AppRole,
  canAccessAdmin,
  isOwner,
  userRole,
  userSessionLabel,
} from "~/libs/user-access";
import { getAppTheme, setAppTheme, type AppTheme } from "~/libs/app-prefs";
import {
  normalizeLocationList,
  resolveInitialPickedOffice,
  clearFrontendMappingsCache,
  fetchAndCacheMappings,
  type LocationItem,
} from "~/libs/location";
import { toast } from "sonner";

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
  const navigate = useNavigate();
  const { userInfo, setUserInfo } = useUserInfo();
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<AppTheme>(() => getAppTheme());
  const [locations, setLocations] = useState<LocationItem[]>([]);

  //userInfo
  const iamowner = isOwner(userInfo);

  const [mappings, setMappings] = useState<OfficeMappingRecord[]>([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOfficeName, setFormOfficeName] = useState("");
  const [formLocationCode, setFormLocationCode] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("operator");
  const [newOffice, setNewOffice] = useState("");

  const [resetPasswordUser, setResetPasswordUser] = useState<string | null>(
    null,
  );
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const { mutate: handleCreateNonAdUser, isPending: isCreatingUser } =
    useMutation({
      mutationKey: ["user"],
      // 1. TAMBAHKAN 'async' di sini karena di dalamnya ada 'await'
      mutationFn: async () => {
        if (!newUsername.trim() || !newPassword.trim()) {
          toast.error("Username dan Password wajib diisi"); // Diubah ke toast.error agar konsisten
          return; // 2. Di sini berhenti kalau validasi gagal
        } // <- Tadi kurung penutup if ini hilang

        // 3. Sekarang kode di bawah ini bisa berjalan karena tidak terpotong return kosong
        const createdRes = await createAppUser({
          username: newUsername.trim(),
          password: newPassword.trim(),
          role: newRole,
          office: newOffice || undefined,
        });

        const mongooseId =
          createdRes?.data?._id ||
          createdRes?.data?.id ||
          createdRes?.user?._id ||
          createdRes?.user?.id ||
          createdRes?._id ||
          createdRes?.id;

        await syncNonAdAppUser({
          username: newUsername.trim(),
          role: newRole,
          office: newOffice || null,
          mongooseId: mongooseId ? String(mongooseId) : null,
        });

        toast.success(`User Non-AD "${newUsername.trim()}" berhasil dibuat`);
        setIsAddingUser(false);
        setNewUsername("");
        setNewPassword("");
        setNewRole("operator");
        setNewOffice("");
      }, // 4. Menambahkan penutup fungsi mutationFn yang tadi hilang
      onError: (err: any) => {
        // Mengambil error message dari response data
        toast.error(
          err?.response?.data?.message ||
            err?.response?.data?.error ||
            err?.message ||
            "Terjadi kesalahan",
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["app-users"] });
      },
    });

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordUser || !resetPasswordValue.trim()) {
      toast("Password baru wajib diisi");
      return;
    }
    setIsResettingPassword(true);
    try {
      await resetPassword({
        username: resetPasswordUser,
        newPassword: resetPasswordValue.trim(),
      });
      toast(`Password user "${resetPasswordUser}" berhasil diperbarui`);
      setResetPasswordUser(null);
      setResetPasswordValue("");
    } catch (err: any) {
      toast(
        err?.response?.data?.message ||
          err?.message ||
          "Gagal mereset password",
      );
    } finally {
      setIsResettingPassword(false);
    }
  };

  const showOwnerSection = isOwner(userInfo);
  const currentRole = userRole(userInfo);

  const profileQuery = useQuery({
    queryKey: ["app-user", "me"],
    queryFn: getAppUser,
    enabled: Boolean(userInfo?.username),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (username: string) =>
      await deleteAppUserFromOpname(username),
    onSuccess: (_, username) => {
      queryClient.invalidateQueries({ queryKey: ["app-users"] });
      toast.success(`User "${username}" berhasil dihapus`);
    },
    onError: (er: any) => {
      toast.error(
        er?.response?.data?.message || er?.message || "Gagal menghapus user",
      );
    },
  });

  const usersQuery = useQuery({
    queryKey: ["app-users"],
    queryFn: listAppUsers,
    enabled: canAccessAdmin(userInfo),
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
      toast.success("Office berhasil disinkronkan");
    },
    onError: (er: any) => {
      toast.error(
        er?.response?.data?.message ||
          er?.response?.data?.error ||
          er?.message ||
          "Terjadi kesalahan",
      );
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({
      username,
      role,
    }: {
      username: string;
      role: AppRole;
    }) => await updateAppUserRole(username, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-users"] });
      toast.success("Role berhasil diperbarui");
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || "Gagal memperbarui role");
    },
  });

  const officeMutation = useMutation({
    mutationFn: async ({
      username,
      office,
    }: {
      username: string;
      office: string | null;
    }) => await updateAppUserOffice(username, office),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-users"] });
      toast.success("Office user berhasil diperbarui");
    },
    onError: (e: any) => {
      toast.error(
        e?.response?.data?.message || "Gagal memperbarui office user",
      );
    },
  });

  useEffect(() => {
    if (userInfo === null) {
      navigate("/login", { replace: true });
      return;
    }
    if (userInfo && !canAccessAdmin(userInfo)) {
      navigate("/input", { replace: true });
    }
  }, [userInfo, navigate]);

  useEffect(() => {
    if (!showOwnerSection) return;

    const fetchLocations = async () => {
      try {
        await fetchAndCacheMappings();
        const res = await locationApi.getAllLocation("");
        const list = normalizeLocationList(res);
        setLocations(list);
      } catch {
        setLocations([]);
      }
    };
    fetchLocations();
  }, [showOwnerSection, userInfo]);

  const fetchMappings = async () => {
    setIsLoadingMappings(true);
    try {
      const data = await listOfficeMappings();
      setMappings(data);
    } catch (err) {
      console.error(err);
      toast.error("Gagal memuat pemetaan lokasi");
    } finally {
      setIsLoadingMappings(false);
    }
  };

  useEffect(() => {
    fetchMappings();
  }, []);

  const handleAddMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formOfficeName.trim() || !formLocationCode.trim()) return;
    try {
      await createOfficeMapping({
        officeName: formOfficeName.trim(),
        locationCode: formLocationCode.trim().toUpperCase(),
      });
      toast.success("Pemetaan lokasi berhasil ditambahkan");
      setFormOfficeName("");
      setFormLocationCode("");
      setIsAdding(false);
      clearFrontendMappingsCache();
      fetchMappings();
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.error || "Gagal menambahkan pemetaan";
      toast.error(errorMsg);
    }
  };

  const handleUpdateMapping = async (id: string) => {
    if (!formOfficeName.trim() || !formLocationCode.trim()) return;
    try {
      await updateOfficeMapping(id, {
        officeName: formOfficeName.trim(),
        locationCode: formLocationCode.trim().toUpperCase(),
      });
      toast("Pemetaan lokasi berhasil diperbarui");
      setEditingId(null);
      setFormOfficeName("");
      setFormLocationCode("");
      clearFrontendMappingsCache();
      fetchMappings();
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.error || "Gagal memperbarui pemetaan";
      toast.error(errorMsg);
    }
  };

  const handleDeleteMapping = async (id: string) => {
    if (!confirm("Apakah Anda yakin ingin menghapus pemetaan ini?")) return;
    try {
      await deleteOfficeMapping(id);
      toast.error("Pemetaan lokasi berhasil dihapus");
      clearFrontendMappingsCache();
      fetchMappings();
    } catch (err: any) {
      toast.error(
        ((err?.message as string) || "Gagal menghapus pemetaan") as string,
      );
    }
  };

  const startEdit = (row: OfficeMappingRecord) => {
    setEditingId(row.id);
    setFormOfficeName(row.officeName);
    setFormLocationCode(row.locationCode);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormOfficeName("");
    setFormLocationCode("");
  };

  const handleThemeChange = (next: AppTheme) => {
    setTheme(next);
    setAppTheme(next);
  };

  const displayOffice = profileQuery.data?.office ?? userInfo?.office ?? "—";

  if (userInfo === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <span className="loading loading-spinner loading-lg text-slate-500" />
      </div>
    );
  }

  return (
    <DocsShell title="Pengaturan" subtitle="Settings" showDocSidebar={false}>
      <div className="max-w-3xl space-y-6">
        <Link
          to="/input"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-600"
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
            <p className="text-sm text-slate-500">
              {userSessionLabel(userInfo)}
            </p>
          </div>
        </div>

        {/* Profil */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-slate-500" />
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
              <span
                className={`badge badge-sm font-bold ${roleBadgeClass(currentRole)}`}
              >
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
            className="btn btn-sm btn-outline border-slate-200 text-slate-700 gap-2"
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
            <Palette className="h-4 w-4 text-slate-500" />
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
        </section>

        {/* Pemetaan Lokasi (CRUD) */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-slate-500" />
              <h2 className="font-bold text-slate-900">
                Pemetaan Lokasi (Office & ERP Code)
              </h2>
            </div>
            {!isAdding && !editingId && (
              <button
                type="button"
                onClick={() => setIsAdding(true)}
                className="btn btn-xs btn-primary gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Mapping
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Digunakan untuk mencocokkan Nama Office pengguna (misal:{" "}
            <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600 font-semibold">
              WL Pluit
            </code>
            ) dengan Kode Lokasi yang berasal dari ERP (misal:{" "}
            <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600 font-semibold">
              PLUIT_JUAL
            </code>
            ).
          </p>

          {/* Form Tambah */}
          {isAdding && (
            <form
              onSubmit={handleAddMapping}
              className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3"
            >
              <h3 className="text-xs font-bold text-slate-700">
                Tambah Mapping Baru
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label py-0.5">
                    <span className="label-text text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Nama Office (Internal)
                    </span>
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: WL Pluit"
                    className="input input-bordered input-sm w-full bg-white font-medium"
                    value={formOfficeName}
                    onChange={(e) => setFormOfficeName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label py-0.5">
                    <span className="label-text text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Kode Lokasi (ERP)
                    </span>
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: PLUIT_JUAL"
                    className="input-bordered input-sm w-full bg-white font-medium"
                    value={formLocationCode}
                    onChange={(e) => setFormLocationCode(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAdding(false);
                    setFormOfficeName("");
                    setFormLocationCode("");
                  }}
                  className="btn btn-xs btn-ghost"
                >
                  Batal
                </button>
                <button type="submit" className="btn btn-xs btn-primary">
                  Simpan Mapping
                </button>
              </div>
            </form>
          )}

          {isLoadingMappings ? (
            <div className="flex justify-center py-6">
              <span className="loading loading-spinner loading-md text-slate-500" />
            </div>
          ) : mappings.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">
              Belum ada pemetaan lokasi yang terdaftar.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="table table-sm">
                <thead>
                  <tr className="text-slate-500">
                    <th>Nama Office (Internal)</th>
                    <th>Kode Lokasi (ERP)</th>
                    <th className="text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((row) => {
                    const isEditing = editingId === row.id;
                    return (
                      <tr key={row.id}>
                        <td className="font-semibold">
                          {isEditing ? (
                            <input
                              type="text"
                              className="input input-bordered input-xs w-full max-w-xs font-semibold"
                              value={formOfficeName}
                              onChange={(e) =>
                                setFormOfficeName(e.target.value)
                              }
                            />
                          ) : (
                            row.officeName
                          )}
                        </td>
                        <td className="text-slate-600">
                          {isEditing ? (
                            <input
                              type="text"
                              className="input input-bordered input-xs w-full max-w-xs font-semibold bg-white"
                              value={formLocationCode}
                              onChange={(e) =>
                                setFormLocationCode(e.target.value)
                              }
                            />
                          ) : (
                            row.locationCode
                          )}
                        </td>
                        <td className="text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleUpdateMapping(row.id)}
                                className="btn btn-xs btn-success gap-1 px-2.5"
                              >
                                <Save className="h-3 w-3" />
                                Simpan
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                className="btn btn-xs btn-ghost gap-1 px-2.5"
                              >
                                <X className="h-3 w-3" />
                                Batal
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEdit(row)}
                                className="btn btn-xs btn-ghost text-slate-500 hover:text-slate-600"
                                disabled={!!editingId || isAdding}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMapping(row.id)}
                                className="btn btn-xs btn-ghost text-slate-500 hover:text-red-600"
                                disabled={!!editingId || isAdding}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
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

        {/* Manajemen User (Non-AD & AD) */}
        {canAccessAdmin(userInfo) && (
          <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-slate-500" />
                <h2 className="font-bold text-slate-900">
                  Manajemen User (Non-AD & AD)
                </h2>
              </div>
              {!isAddingUser && (
                <button
                  type="button"
                  onClick={() => setIsAddingUser(true)}
                  className="btn btn-xs btn-primary gap-1"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Tambah User Non-AD
                </button>
              )}
            </div>

            <p className="text-xs text-slate-500">
              Kelola role, lokasi office, reset password, dan pembuatan akun
              Non-AD untuk staf operasional atau tim IT.
            </p>

            {/* Form Tambah User Non-AD */}
            {isAddingUser && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreateNonAdUser();
                }}
                className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-3"
              >
                <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
                  <UserPlus className="h-4 w-4 text-slate-600" />
                  <span>Tambah User Baru (Tanpa AD / Local App)</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label py-0.5">
                      <span className="label-text text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Username *
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="Contoh: op_pluit1"
                      className="input input-bordered input-sm w-full bg-white font-medium"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="label py-0.5">
                      <span className="label-text text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Password *
                      </span>
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      className="input input-bordered input-sm w-full bg-white font-medium"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="label py-0.5">
                      <span className="label-text text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Role Aplikasi *
                      </span>
                    </label>
                    <select
                      className="select select-bordered select-sm w-full bg-white font-semibold"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as AppRole)}
                    >
                      <option value="operator">Operator (Scan Fisik)</option>
                      <option value="admin">Admin (Approval & Sync)</option>
                      <option value="owner">Owner (IT / Full Control)</option>
                    </select>
                  </div>

                  <div>
                    <label className="label py-0.5">
                      <span className="label-text text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Wilayah / Office Default
                      </span>
                    </label>
                    <select
                      className="select select-bordered select-sm w-full bg-white font-semibold"
                      value={newOffice}
                      onChange={(e) => setNewOffice(e.target.value)}
                    >
                      <option value="">-- Pilih Office (Opsional) --</option>
                      {mappings.map((loc) => (
                        <option key={loc.officeName} value={loc.officeName}>
                          {loc.officeName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingUser(false);
                      setNewUsername("");
                      setNewPassword("");
                      setNewRole("operator");
                      setNewOffice("");
                    }}
                    className="btn btn-xs btn-ghost"
                    disabled={isCreatingUser}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="btn btn-xs btn-primary gap-1"
                    disabled={isCreatingUser}
                  >
                    {isCreatingUser && (
                      <span className="loading loading-spinner loading-xs" />
                    )}
                    Simpan User Non-AD
                  </button>
                </div>
              </form>
            )}

            {usersQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <span className="loading loading-spinner loading-md text-slate-500" />
              </div>
            ) : usersQuery.isError ? (
              <p className="text-sm text-red-600">Gagal memuat daftar user.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="table table-sm">
                  <thead>
                    <tr className="text-slate-500">
                      <th>Username</th>
                      <th>Tipe</th>
                      <th>Role</th>
                      <th>Office</th>
                      <th className="text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(usersQuery.data ?? []).map((row) => {
                      const isSelf = row.username === userInfo?.username;
                      const isNonAd =
                        row.type === "app" ||
                        row.type === "non-ad" ||
                        row.type === "local" ||
                        row.authMethod === "app";

                      return (
                        <tr key={row.username}>
                          <td className="font-semibold text-slate-800">
                            {row.username}
                          </td>
                          <td>
                            <span
                              className={`badge badge-xs font-bold ${
                                isNonAd ? "badge-info" : "badge-ghost"
                              }`}
                            >
                              {isNonAd ? "Non-AD (App)" : "AD (LDAP)"}
                            </span>
                          </td>
                          <td>
                            {isSelf && row.role != "owner" ? (
                              <span className="text-xs text-slate-400">
                                {
                                  ROLE_LABELS[
                                    userRole({ role: row.role ?? undefined }) ??
                                      "operator"
                                  ]
                                }
                              </span>
                            ) : (
                              <select
                                className="select select-bordered select-xs font-semibold bg-white"
                                value={(row.role ?? "operator").toLowerCase()}
                                disabled={roleMutation.isPending || !iamowner}
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
                          <td>
                            <select
                              className="select select-bordered select-xs font-semibold bg-white max-w-45"
                              value={row.office ?? ""}
                              disabled={officeMutation.isPending}
                              onChange={(e) =>
                                officeMutation.mutate({
                                  username: row.username,
                                  office: e.target.value || null,
                                })
                              }
                            >
                              <option value="">-- Pilih Office --</option>
                              {mappings.map((loc) => (
                                <option
                                  key={loc.officeName}
                                  value={loc.officeName}
                                >
                                  {loc.officeName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="text-right">
                            <div className="flex justify-end gap-1">
                              {row.type === "app" ||
                              row.authMethod === "app" ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setResetPasswordUser(row.username)
                                    }
                                    className="btn btn-xs btn-ghost text-slate-600 hover:text-slate-600 gap-1"
                                    title="Reset Password"
                                  >
                                    <KeyRound className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">
                                      Reset
                                    </span>
                                  </button>
                                  {canAccessAdmin(userInfo) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (
                                          confirm(
                                            `Apakah Anda yakin ingin menghapus user "${row.username}"?`,
                                          )
                                        ) {
                                          deleteUserMutation.mutate(
                                            row.username,
                                          );
                                        }
                                      }}
                                      className="btn btn-xs btn-ghost text-red-500 hover:text-red-600 hover:bg-red-50 p-1 cursor-pointer"
                                      title="Hapus User"
                                      disabled={deleteUserMutation.isPending}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </>
                              ) : (
                                <Lock className="text-slate-300 h-5 w-5 cursor-not-allowed" />
                              )}
                            </div>
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

        {/* Modal Reset Password */}
        {resetPasswordUser && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-slate-50 rounded-xl text-slate-600">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">
                      Reset Password User
                    </h3>
                    <p className="text-xs text-slate-500">
                      Target:{" "}
                      <span className="font-semibold text-slate-600">
                        {resetPasswordUser}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setResetPasswordUser(null);
                    setResetPasswordValue("");
                  }}
                  className="btn btn-xs btn-ghost btn-circle text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">
                    Password Baru *
                  </label>
                  <input
                    type="password"
                    placeholder="Masukkan password baru..."
                    className="input input-bordered input-sm w-full bg-slate-50 font-medium focus:bg-white"
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    required
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setResetPasswordUser(null);
                      setResetPasswordValue("");
                    }}
                    className="btn btn-sm btn-ghost"
                    disabled={isResettingPassword}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary gap-1"
                    disabled={isResettingPassword}
                  >
                    {isResettingPassword && (
                      <span className="loading loading-spinner loading-xs" />
                    )}
                    Simpan Password Baru
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DocsShell>
  );
}
