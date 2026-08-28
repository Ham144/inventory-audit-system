import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ClipboardList,
  RefreshCw,
  Calendar,
  MapPin,
  ArrowLeft,
  DatabaseBackup,
  Search,
  BarChart3,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CheckCircle2,
  Clock,
  Building2,
} from "lucide-react";
import { DocsShell } from "~/components/DocsShell";
import { useUserInfo } from "~/store";
import {
  adminCanPickOffice,
  canAccessAdmin,
  compareOfficeScope,
  userOffice,
} from "~/libs/user-access";
import {
  fetchAndCacheMappings,
  normalizeLocationList,
  resolveInitialPickedOffice,
  resolvePickedOffice,
  type LocationItem,
} from "~/libs/location";
import locationApi from "~/api/LocationApi";
import { getAdminDefaultOffice, setAdminDefaultOffice } from "~/libs/app-prefs";
import { listUnresolvedSkus, startNewPeriod } from "~/api/skuReminder.api";

const PAGE_SIZES = [25, 50, 100, 200];

function toDateInputValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function StatCard({
  label,
  value,
  accent = false,
  sub,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  sub?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-5 py-3 min-w-[120px]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p
        className={`text-xl font-black mt-0.5 ${accent ? "text-indigo-600" : "text-slate-900"}`}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

type StatusFilter = "all" | "unresolved" | "resolved";

export default function TugasSkuPage() {
  const { userInfo } = useUserInfo();
  const navigate = useNavigate();
  const isAdmin = canAccessAdmin(userInfo);
  const showOfficePicker = adminCanPickOffice(userInfo);
  const officeDefaultApplied = useRef(false);

  const [pickedOffice, setPickedOffice] = useState("Semua");
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [startPeriod, setStartPeriod] = useState(toDateInputValue(new Date()));
  const [endPeriod, setEndPeriod] = useState("");
  const [toast, setToast] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unresolved");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  const officeScope = compareOfficeScope(
    userInfo,
    showOfficePicker ? pickedOffice : undefined,
  );

  const listMode = useMemo((): "unresolved" | "all" => {
    if (officeScope === "Semua") return "all";
    if (statusFilter === "unresolved") return "unresolved";
    return "all";
  }, [officeScope, statusFilter]);

  const remindersQuery = useQuery({
    queryKey: ["sku-reminders", officeScope, listMode],
    queryFn: () =>
      listUnresolvedSkus({
        office: officeScope || "Semua",
        mode: listMode,
      }),
    enabled: Boolean(userInfo?.username),
    refetchInterval: 30000,
  });

  const startNewPeriodMutation = useMutation({
    mutationFn: () =>
      startNewPeriod({
        startPeriod: startPeriod || undefined,
        endPeriod: endPeriod || undefined,
      }),
    onSuccess: async (data) => {
      setToast(`${data.message}. Total SKU: ${data.totalSku}`);
      await remindersQuery.refetch();
      (document.getElementById("open-new-period") as HTMLDialogElement)?.close();
    },
    onError: () => {
      setToast("Gagal membuka periode baru.");
    },
  });

  useEffect(() => {
    if (userInfo === null) navigate("/login", { replace: true });
  }, [userInfo, navigate]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!showOfficePicker) return;
    const fetchLocations = async () => {
      setIsLoadingLocations(true);
      try {
        await fetchAndCacheMappings();
        const res = await locationApi.getAllLocation("");
        setLocations(normalizeLocationList(res));
      } catch {
        setLocations([]);
      } finally {
        setIsLoadingLocations(false);
      }
    };
    fetchLocations();
  }, [showOfficePicker]);

  useEffect(() => {
    if (
      !showOfficePicker ||
      locations.length === 0 ||
      officeDefaultApplied.current
    ) {
      return;
    }
    officeDefaultApplied.current = true;
    setPickedOffice(
      resolveInitialPickedOffice({
        userOffice: userOffice(userInfo),
        savedOffice: getAdminDefaultOffice(),
        locations,
      }),
    );
  }, [showOfficePicker, locations, userInfo]);

  useEffect(() => {
    if (!showOfficePicker || locations.length === 0) return;
    const resolved = resolvePickedOffice(pickedOffice, locations);
    if (resolved !== pickedOffice) setPickedOffice(resolved);
  }, [showOfficePicker, locations, pickedOffice]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, officeScope, pageSize]);

  const officeLabel = remindersQuery.data?.office ?? officeScope;
  const summary = remindersQuery.data?.summary;
  const period = remindersQuery.data?.period;
  const allRows = remindersQuery.data?.data ?? [];

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const activeOffice =
      officeScope && officeScope !== "Semua" ? officeScope : null;

    return allRows.filter((row) => {
      const isResolvedForOffice = activeOffice
        ? row.resolvedOffices.includes(activeOffice)
        : row.resolvedOffices.length > 0;

      if (statusFilter === "resolved" && !isResolvedForOffice) return false;
      if (statusFilter === "unresolved" && isResolvedForOffice) return false;
      if (search && !row.sku.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [allRows, searchTerm, statusFilter, officeScope]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  const periodLabel = useMemo(() => {
    if (!period?.startPeriod) return "-";
    const end = period.endPeriod
      ? ` s/d ${formatDate(period.endPeriod)}`
      : "";
    return `${formatDate(period.startPeriod)}${end}`;
  }, [period]);

  const hasActiveFilters = Boolean(searchTerm) || statusFilter !== "unresolved";

  if (userInfo === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <span className="loading loading-spinner loading-lg text-slate-500" />
      </div>
    );
  }

  return (
    <DocsShell title="Tugas SKU" subtitle="Stok Opname" showDocSidebar={false}>
      <div className="max-w-6xl space-y-5">
        <Link
          to="/my-logs"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Kembali ke My Logs
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-slate-500 to-indigo-500 text-white shadow-lg shadow-indigo-100">
              <ClipboardList className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Daftar Tugas SKU
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Pantau SKU yang belum dikerjakan per wilayah — {officeLabel}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => remindersQuery.refetch()}
              disabled={remindersQuery.isFetching}
              title="Refresh data"
              className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-all"
            >
              <RefreshCw
                className={`h-4 w-4 ${remindersQuery.isFetching ? "animate-spin" : ""}`}
              />
            </button>
            {isAdmin && (
              <button
                onClick={() =>
                  (
                    document.getElementById(
                      "open-new-period",
                    ) as HTMLDialogElement
                  )?.showModal()
                }
                disabled={startNewPeriodMutation.isPending}
                className="btn btn-sm bg-slate-700 text-white border-slate-700 hover:bg-slate-800 gap-1.5"
              >
                <DatabaseBackup className="h-4 w-4" />
                Buka Periode Baru
              </button>
            )}
          </div>
        </div>

        {/* Stat cards */}
        <div className="flex flex-wrap gap-3">
          <StatCard
            label="Total Katalog"
            value={(summary?.totalCatalog ?? 0).toLocaleString("id-ID")}
          />
          <StatCard
            label="Belum Dikerjakan"
            value={(summary?.unresolved ?? filteredRows.length).toLocaleString(
              "id-ID",
            )}
            accent
          />
          <StatCard
            label="Sudah Dikerjakan"
            value={(summary?.resolved ?? 0).toLocaleString("id-ID")}
          />
          <StatCard
            label="Progress"
            value={`${summary?.progressPercent ?? 0}%`}
            sub={officeScope !== "Semua" ? `di ${officeLabel}` : undefined}
          />
          <StatCard label="Periode Sejak" value={periodLabel} />
          <StatCard
            label="Halaman"
            value={`${safePage} / ${totalPages}`}
          />
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <BarChart3 className="h-3.5 w-3.5" />
              Filter Data
            </div>
            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("unresolved");
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-700"
              >
                <X className="h-3 w-3" />
                Reset filter
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5 min-w-[200px] flex-1">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <Search className="h-3 w-3" />
                Cari SKU
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Ketik SKU..."
                  className="input input-bordered input-sm w-full pl-9 bg-slate-50 font-semibold"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 min-w-[150px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as StatusFilter)
                }
                className="select select-bordered select-sm bg-slate-50 font-semibold"
              >
                <option value="unresolved">Belum dikerjakan</option>
                <option value="resolved">Sudah dikerjakan</option>
                <option value="all">Semua</option>
              </select>
            </div>

            {showOfficePicker && (
              <div className="flex flex-col gap-1.5 min-w-[175px]">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  Wilayah
                </label>
                <select
                  value={pickedOffice}
                  onChange={(e) => {
                    setPickedOffice(e.target.value);
                    setAdminDefaultOffice(
                      e.target.value === "Semua" ? "" : e.target.value,
                    );
                  }}
                  disabled={isLoadingLocations}
                  className="select select-bordered select-sm bg-slate-50 font-semibold"
                >
                  {isLoadingLocations ? (
                    <option value="Semua">Memuat...</option>
                  ) : (
                    <>
                      <option value="Semua">Semua Wilayah</option>
                      {locations.map((loc) => (
                        <option key={loc._id ?? loc.name} value={loc.name}>
                          {loc.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
            )}
          </div>
        </div>

        {toast && (
          <div className="alert alert-info py-2 text-sm shadow-sm">
            <span>{toast}</span>
          </div>
        )}

        {/* Table */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-slate-700">
              Data SkuReminder
            </span>
            <span className="text-xs text-slate-500">
              Menampilkan {paginatedRows.length} dari {filteredRows.length} baris
            </span>
          </div>

          <div className="overflow-x-auto">
            {remindersQuery.isError ? (
              <div className="p-6 text-sm text-rose-600">
                Gagal memuat daftar tugas. Pastikan Anda sudah login dan backend
                sudah di-deploy.
              </div>
            ) : remindersQuery.isLoading ? (
              <div className="p-6 text-sm text-slate-500 flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Memuat data...
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 text-center">
                {allRows.length === 0
                  ? "Belum ada data tugas. Admin dapat menekan \"Buka Periode Baru\" untuk mengisi katalog SKU."
                  : "Tidak ada SKU yang cocok dengan filter."}
              </div>
            ) : (
              <table className="table table-sm">
                <thead className="bg-slate-50">
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="w-12">No</th>
                    <th>SKU</th>
                    <th>Status</th>
                    <th>Wilayah Selesai</th>
                    <th>Mulai Periode</th>
                    <th>Akhir Periode</th>
                    <th>Dibuat</th>
                    <th>Diupdate</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row, index) => {
                    const activeOffice =
                      officeScope && officeScope !== "Semua"
                        ? officeScope
                        : null;
                    const isDone = activeOffice
                      ? row.resolvedOffices.includes(activeOffice)
                      : row.resolvedOffices.length > 0;

                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80">
                        <td className="text-slate-400 font-medium">
                          {(safePage - 1) * pageSize + index + 1}
                        </td>
                        <td className="font-mono font-bold text-slate-800">
                          {row.sku}
                        </td>
                        <td>
                          {isDone ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="h-3 w-3" />
                              Selesai
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                              <Clock className="h-3 w-3" />
                              Belum
                            </span>
                          )}
                        </td>
                        <td>
                          {row.resolvedOffices.length === 0 ? (
                            <span className="text-xs text-slate-400">-</span>
                          ) : (
                            <div className="flex flex-wrap gap-1 max-w-[220px]">
                              {row.resolvedOffices.map((off) => (
                                <span
                                  key={off}
                                  className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded"
                                >
                                  <Building2 className="h-2.5 w-2.5" />
                                  {off}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="text-xs text-slate-600 whitespace-nowrap">
                          {formatDate(row.startPeriod)}
                        </td>
                        <td className="text-xs text-slate-600 whitespace-nowrap">
                          {formatDate(row.endPeriod)}
                        </td>
                        <td className="text-xs text-slate-500 whitespace-nowrap">
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td className="text-xs text-slate-500 whitespace-nowrap">
                          {formatDateTime(row.updatedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {filteredRows.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Baris per halaman</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="select select-bordered select-xs bg-white"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button
                  className="btn btn-xs btn-ghost"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage(1)}
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  className="btn btn-xs btn-ghost"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs font-semibold text-slate-600 px-2">
                  {safePage} / {totalPages}
                </span>
                <button
                  className="btn btn-xs btn-ghost"
                  disabled={safePage >= totalPages}
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  className="btn btn-xs btn-ghost"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <dialog id="open-new-period" className="modal">
        <div className="modal-box max-w-md">
          <h3 className="font-bold text-lg">Buka Periode Baru</h3>
          <p className="text-sm text-slate-500 mt-1">
            Reset daftar tugas SKU dari katalog master. Semua{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              resolvedOffices
            </code>{" "}
            akan dikosongkan.
          </p>

          <div className="flex flex-wrap gap-3 mt-4">
            <label className="form-control flex-1 min-w-[140px]">
              <span className="label-text text-xs text-slate-500 flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                Mulai Periode
              </span>
              <input
                type="date"
                className="input input-bordered input-sm bg-slate-50"
                value={startPeriod}
                onChange={(e) => setStartPeriod(e.target.value)}
              />
            </label>
            <label className="form-control flex-1 min-w-[140px]">
              <span className="label-text text-xs text-slate-500">
                Akhir Periode (opsional)
              </span>
              <input
                type="date"
                className="input input-bordered input-sm bg-slate-50"
                value={endPeriod}
                onChange={(e) => setEndPeriod(e.target.value)}
              />
            </label>
          </div>

          <div className="modal-action">
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                (
                  document.getElementById(
                    "open-new-period",
                  ) as HTMLDialogElement
                )?.close()
              }
            >
              Batal
            </button>
            <button
              disabled={startNewPeriodMutation.isPending}
              className="btn btn-sm bg-slate-100 text-slate-700 border-slate-100 hover:bg-slate-200"
              onClick={() => startNewPeriodMutation.mutate()}
            >
              {startNewPeriodMutation.isPending
                ? "Memproses..."
                : "Buka Periode Baru"}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit">close</button>
        </form>
      </dialog>
    </DocsShell>
  );
}
