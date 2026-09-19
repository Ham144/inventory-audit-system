import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  AlertCircle,
  ArrowLeft,
  Search,
  MapPin,
  Package,
  Layers,
  Calendar,
  PenLine,
  UserCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  DatabaseBackup,
  BarChart3,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Building2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DocsShell } from "~/components/DocsShell";
import { useUserInfo } from "~/store";
import { CompareApi, type NavCompareRow } from "~/api/compare.api";
import { getScans } from "~/api/opname.api";
import { listAppUsers } from "~/api/opnameUserApi";
import locationApi from "~/api/LocationApi";
import {
  compareOfficeScope,
  adminCanPickOffice,
  canAccessAdmin,
  userOffice,
} from "~/libs/user-access";
import {
  normalizeLocationList,
  resolveInitialPickedOffice,
  resolvePickedOffice,
  fetchAndCacheMappings,
  canonicalizeLocationList,
  toCanonicalOfficeName,
  isMatchingOffice,
  type LocationItem,
} from "~/libs/location";
import { getAdminDefaultOffice, setAdminDefaultOffice } from "~/libs/app-prefs";
import {
  listUnresolvedSkus,
  openPeriod,
  closePeriod,
  delegateSkuReminder,
  type SkuReminderItem,
  type OfficePeriodMode,
} from "~/api/skuReminder.api";

const PAGE_SIZES = [25, 50, 100, 200];

type ViewFilter = "all" | "selisih" | "belum_dikerjakan";

type SelisihTableRow =
  | { kind: "selisih"; row: NavCompareRow }
  | { kind: "belum_dikerjakan"; item: SkuReminderItem; office: string };

type NavRowWithDelegation = NavCompareRow & {
  delegatedTo?: string | null;
  delegatedBy?: string | null;
};

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

export default function SelisihPage() {
  const { userInfo } = useUserInfo();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = canAccessAdmin(userInfo);
  const showOfficePicker = adminCanPickOffice(userInfo);
  const officeDefaultApplied = useRef(false);

  const [pickedOffice, setPickedOffice] = useState("Semua");
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRak, setSelectedRak] = useState("Semua");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "warning" | "info";
  } | null>(null);

  const compareOfficeRaw = compareOfficeScope(
    userInfo,
    showOfficePicker ? pickedOffice : undefined,
  );
  const compareOffice = toCanonicalOfficeName(compareOfficeRaw);

  const canLoadReminders =
    Boolean(userInfo?.username) &&
    compareOffice !== "Semua" &&
    compareOffice.trim().length > 0;

  const remindersQuery = useQuery({
    queryKey: ["sku-reminders", compareOffice],
    queryFn: () =>
      listUnresolvedSkus({
        office: compareOffice,
        mode: "unresolved",
      }),
    enabled: canLoadReminders,
  });

  const navQuery = useQuery({
    queryKey: [
      "compare",
      "nav",
      isAdmin ? compareOffice : "Semua",
      selectedRak,
      dateFrom,
      dateTo,
    ],
    queryFn: () =>
      CompareApi.fetchNavCompareList({
        office: isAdmin ? compareOffice : "Semua",
        rak: selectedRak !== "Semua" ? selectedRak : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
    enabled: Boolean(userInfo?.username),
  });

  const usersQuery = useQuery({
    queryKey: ["app-users"],
    queryFn: listAppUsers,
    enabled: isAdmin,
  });

  const canManagePeriod =
    isAdmin && compareOffice !== "Semua" && compareOffice.trim().length > 0;

  const periodMode: OfficePeriodMode =
    remindersQuery.data?.mode ??
    remindersQuery.data?.period?.mode ??
    "FREE";

  const openPeriodMutation = useMutation({
    mutationFn: () => openPeriod({ office: compareOffice }),
    onSuccess: async (data) => {
      const hidden =
        typeof data.hiddenZeroQty === "number" && data.hiddenZeroQty > 0
          ? ` · ${data.hiddenZeroQty} SKU qty < 1 disembunyikan`
          : "";
      setToast({
        message: `${data.message}. Source of truth ditimpa: ${data.updatedSystemQty} SKU${hidden}`,
        type: "info",
      });
      await Promise.all([
        remindersQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["compare"] }),
      ]);
    },
    onError: (error: unknown) => {
      const axiosErr = error as {
        response?: { data?: { message?: string } };
      };
      const message =
        axiosErr.response?.data?.message ?? "Gagal membuka periode.";
      setToast({ message, type: "warning" });
    },
  });

  const closePeriodMutation = useMutation({
    mutationFn: () => closePeriod({ office: compareOffice }),
    onSuccess: async (data) => {
      setToast({
        message: `${data.message}. Sesi kerja ditutup. Riwayat lama bisa dilihat lewat filter tanggal.`,
        type: "info",
      });
      await Promise.all([
        remindersQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["compare"] }),
        queryClient.invalidateQueries({ queryKey: ["opname"] }),
        queryClient.invalidateQueries({ queryKey: ["trace-logs"] }),
        queryClient.invalidateQueries({ queryKey: ["sku-reminders-period"] }),
      ]);
      (
        document.getElementById("close-period-modal") as HTMLDialogElement
      )?.close();
    },
    onError: (error: unknown) => {
      const axiosErr = error as {
        response?: { data?: { message?: string } };
      };
      const message =
        axiosErr.response?.data?.message ?? "Gagal menutup periode.";
      setToast({ message, type: "warning" });
    },
  });

  const periodBusy =
    openPeriodMutation.isPending || closePeriodMutation.isPending;
  const delegateMutation = useMutation({
    mutationFn: ({
      id,
      delegatedTo,
    }: {
      id: string;
      delegatedTo: string | null;
    }) => CompareApi.delegateSku(id, delegatedTo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compare"] });
      setToast({ message: "Delegasi berhasil diterapkan", type: "success" });
    },
    onError: () => {
      setToast({ message: "Gagal mendelegasikan pengecekan", type: "warning" });
    },
  });

  const delegateReminderMutation = useMutation({
    mutationFn: ({
      id,
      office,
      delegatedTo,
    }: {
      id: string;
      office: string;
      delegatedTo: string | null;
    }) => delegateSkuReminder(id, { office, delegatedTo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sku-reminders"] });
      setToast({ message: "Delegasi berhasil diterapkan", type: "success" });
    },
    onError: () => {
      setToast({ message: "Gagal mendelegasikan pengecekan", type: "warning" });
    },
  });

  useEffect(() => {
    if (userInfo === null) navigate("/login", { replace: true });
  }, [userInfo, navigate]);

  useEffect(() => {
    if (!showOfficePicker) return;
    const fetchLocations = async () => {
      setIsLoadingLocations(true);
      try {
        await fetchAndCacheMappings();
        const res = await locationApi.getAllLocation("");
        setLocations(canonicalizeLocationList(normalizeLocationList(res)));
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
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, viewFilter, compareOffice, pageSize, selectedRak, dateFrom, dateTo]);

  const scansQuery = useQuery({
    queryKey: ["my-scans", compareOffice],
    queryFn: () => getScans({ office: compareOffice }),
    enabled: Boolean(userInfo?.username),
  });

  const uniqueRaks = useMemo(() => {
    const data = scansQuery.data ?? [];
    const raks = data.map((row: { rak: number }) => String(row.rak));
    return Array.from(new Set(raks)).sort((a, b) => Number(a) - Number(b));
  }, [scansQuery.data]);

  const selisihRows = useMemo(() => {
    if (!userInfo?.username) return [];
    const search = searchTerm.trim().toLowerCase();

    return (navQuery.data ?? []).filter((row) => {
      const statusLower = (row.status || "").toLowerCase();
      if (statusLower !== "selisih") return false;
      if (row.physicalQty === row.systemQty) return false;
      if (row.pendingRakCount > 0) return false;
      if (!isAdmin && row.delegatedTo !== userInfo.username) return false;
      if (search) {
        const haystack = `${row.sku} ${row.name}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [navQuery.data, userInfo?.username, searchTerm, isAdmin]);

  const belumDikerjakanItems = useMemo(() => {
    if (!canLoadReminders) return [];
    const search = searchTerm.trim().toLowerCase();
    const selisihSkuSet = new Set(
      selisihRows.map((row) => row.sku.trim().toUpperCase()),
    );

    return (remindersQuery.data?.data ?? []).filter((item) => {
      const skuKey = item.sku.trim().toUpperCase();
      if (selisihSkuSet.has(skuKey)) return false;
      if (search && !item.sku.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [canLoadReminders, remindersQuery.data?.data, selisihRows, searchTerm]);

  const summary = remindersQuery.data?.summary;
  const officeLabel = remindersQuery.data?.office ?? compareOffice;

  const tableRows = useMemo((): SelisihTableRow[] => {
    const selisih: SelisihTableRow[] = selisihRows.map((row) => ({
      kind: "selisih",
      row,
    }));
    const belum: SelisihTableRow[] = belumDikerjakanItems.map((item) => ({
      kind: "belum_dikerjakan",
      item,
      office: officeLabel,
    }));

    if (viewFilter === "selisih") return selisih;
    if (viewFilter === "belum_dikerjakan") return belum;
    // Admin: selisih dulu agar kolom delegasi langsung terlihat di halaman awal
    return isAdmin ? [...selisih, ...belum] : [...belum, ...selisih];
  }, [
    selisihRows,
    belumDikerjakanItems,
    viewFilter,
    officeLabel,
    isAdmin,
  ]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = tableRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  const hasActiveFilters =
    Boolean(searchTerm) ||
    viewFilter !== "all" ||
    selectedRak !== "Semua" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const operatorUsers = useMemo(
    () => (usersQuery.data ?? []).filter((u) => u.role === "operator"),
    [usersQuery.data],
  );

  const isLoading =
    navQuery.isLoading || (canLoadReminders && remindersQuery.isLoading);

  if (userInfo === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <span className="loading loading-spinner loading-lg text-slate-500" />
      </div>
    );
  }

  const today = toDateInputValue(new Date());

  return (
    <DocsShell title="Cek Selisih" subtitle="Stok Opname" showDocSidebar={false}>
      <div className="max-w-6xl space-y-5">
        <Link
          to="/input"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Kembali ke input scan
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-red-500 to-indigo-600 text-white shadow-lg shadow-red-100">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Cek Selisih & Tugas SKU
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Selisih ERP dan SKU belum dikerjakan — {officeLabel}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canManagePeriod && (
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  periodMode === "OPNAME"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-slate-100 text-slate-600 border border-slate-200"
                }`}
              >
                {periodMode === "OPNAME" ? "Opname" : "Free"}
              </span>
            )}
            {isAdmin && (
              <>
                <button
                  onClick={() => openPeriodMutation.mutate()}
                  disabled={
                    periodBusy || !canManagePeriod || periodMode === "OPNAME"
                  }
                  title={
                    !canManagePeriod
                      ? "Pilih gudang spesifik untuk buka periode"
                      : periodMode === "OPNAME"
                        ? "Periode sudah dibuka. Tutup dulu jika ingin buka ulang."
                        : `Ambil source of truth (systemQty) dari NAV untuk ${compareOffice}. Hanya sekali per periode.`
                  }
                  className="btn btn-sm bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 gap-1.5 disabled:opacity-50"
                >
                  <DatabaseBackup className="h-4 w-4" />
                  {openPeriodMutation.isPending
                    ? "Mengambil SoT..."
                    : "Buka periode"}
                </button>
                <button
                  onClick={() =>
                    (
                      document.getElementById(
                        "close-period-modal",
                      ) as HTMLDialogElement
                    )?.showModal()
                  }
                  disabled={
                    periodBusy || !canManagePeriod || periodMode !== "OPNAME"
                  }
                  title={
                    !canManagePeriod
                      ? "Pilih gudang spesifik untuk tutup periode"
                      : periodMode !== "OPNAME"
                        ? "Buka periode dulu sebelum tutup"
                        : `Tutup periode ${compareOffice}: reset katalog SkuReminder`
                  }
                  className="btn btn-sm bg-slate-700 text-white border-slate-700 hover:bg-slate-800 gap-1.5 disabled:opacity-50"
                >
                  <Clock className="h-4 w-4" />
                  {closePeriodMutation.isPending
                    ? "Menutup..."
                    : "Tutup periode"}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <StatCard
            label="Total Katalog"
            value={(summary?.totalCatalog ?? 0).toLocaleString("id-ID")}
          />
          <StatCard
            label="Belum Dikerjakan"
            value={belumDikerjakanItems.length.toLocaleString("id-ID")}
            accent
          />
          <StatCard
            label="Selisih ERP"
            value={selisihRows.length.toLocaleString("id-ID")}
          />
          <StatCard
            label="Progress"
            value={`${summary?.progressPercent ?? 0}%`}
            sub={compareOffice !== "Semua" ? `di ${officeLabel}` : undefined}
          />
          <StatCard
            label="Mode Gudang"
            value={canManagePeriod || canLoadReminders ? (periodMode === "OPNAME" ? "Opname" : "Free") : "-"}
          />
          <StatCard label="Halaman" value={`${safePage} / ${totalPages}`} />
        </div>

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
                  setViewFilter("all");
                  setSelectedRak("Semua");
                  setDateFrom("");
                  setDateTo("");
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-700"
              >
                <X className="h-3 w-3" />
                Reset filter
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5 min-w-[130px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <ClipboardList className="h-3 w-3" />
                Tampilan
              </label>
              <select
                value={viewFilter}
                onChange={(e) => setViewFilter(e.target.value as ViewFilter)}
                className="select select-bordered select-sm bg-slate-50 font-semibold"
              >
                <option value="all">Semua</option>
                <option value="belum_dikerjakan">Belum dikerjakan</option>
                <option value="selisih">Selisih NAV</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5 min-w-[200px] flex-1">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <Search className="h-3 w-3" />
                Cari SKU / Nama
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Ketik SKU atau nama..."
                  className="input input-bordered input-sm w-full pl-9 bg-slate-50 font-semibold"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 min-w-[110px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <Layers className="h-3 w-3" />
                Rak
              </label>
              <select
                value={selectedRak}
                onChange={(e) => setSelectedRak(e.target.value)}
                className="select select-bordered select-sm bg-slate-50 font-semibold"
              >
                <option value="Semua">Semua</option>
                {uniqueRaks.map((r) => (
                  <option key={r} value={r}>
                    Rak {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5 min-w-[140px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Dari
              </label>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || today}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input input-bordered input-sm bg-slate-50 font-semibold"
              />
            </div>

            <div className="flex flex-col gap-1.5 min-w-[140px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                Sampai
              </label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                max={today}
                onChange={(e) => setDateTo(e.target.value)}
                className="input input-bordered input-sm bg-slate-50 font-semibold"
              />
            </div>

            {showOfficePicker && (
              <div className="flex flex-col gap-1.5 min-w-[175px]">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  Wilayah
                  {canManagePeriod && (
                    <span
                      className={`ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        periodMode === "OPNAME"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {periodMode === "OPNAME" ? "Opname" : "Free"}
                    </span>
                  )}
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

        {compareOffice === "Semua" && isAdmin && (
          <div className="alert alert-warning py-2 text-sm shadow-sm">
            <span>
              Pilih wilayah spesifik untuk melihat SKU yang belum dikerjakan
              sama sekali dan stat progress per gudang.
            </span>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm ">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-slate-700">
              Daftar Tugas & Selisih
            </span>
            <span className="text-xs text-slate-500">
              Menampilkan {paginatedRows.length} dari {tableRows.length} baris
            </span>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <span className="loading loading-spinner loading-lg text-slate-500" />
            </div>
          ) : navQuery.isError ? (
            <div className="p-8 text-center text-red-600 text-sm">
              Gagal memuat data selisih.
            </div>
          ) : tableRows.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="h-10 w-10 text-emerald-300 mx-auto mb-3" />
              <p className="font-semibold text-emerald-700">
                Tidak ada tugas tersisa
              </p>
              <p className="text-sm text-slate-400 mt-1">
                Tidak ada selisih NAV maupun SKU belum dikerjakan untuk filter
                ini.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="w-12">No</th>
                      <th>SKU</th>
                      <th>Nama</th>
                      <th>Status</th>
                      {isAdmin && (
                        <th className="min-w-[200px] bg-slate-50">Delegasi</th>
                      )}
                      <th>Office</th>
                      <th>Diupdate</th>
                      <th className="text-right sticky right-0 bg-slate-50 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]">
                        Aksi
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((entry, index) => {
                      if (entry.kind === "belum_dikerjakan") {
                        const item = entry.item;
                        const isDelegating =
                          delegateReminderMutation.isPending &&
                          delegateReminderMutation.variables?.id === item.id;

                        return (
                          <tr
                            key={`belum-${item.id}`}
                            className="hover:bg-amber-50/40 bg-amber-50/20"
                          >
                            <td className="text-slate-400 font-medium">
                              {(safePage - 1) * pageSize + index + 1}
                            </td>
                            <td className="font-mono font-bold text-slate-800">
                              {item.sku}
                            </td>
                            <td className="text-slate-500 text-xs italic">
                              Belum pernah di-scan
                            </td>
                            <td>
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                                <Clock className="h-3 w-3" />
                                BELUM
                              </span>
                            </td>
                            {isAdmin && (
                              <td>
                                <div className="flex items-center gap-1.5 min-w-[180px]">
                                  <select
                                    className="select select-bordered select-xs font-semibold bg-white w-full max-w-[160px]"
                                    value={item.delegatedTo ?? ""}
                                    disabled={isDelegating}
                                    onChange={(e) => {
                                      delegateReminderMutation.mutate({
                                        id: item.id,
                                        office: entry.office,
                                        delegatedTo: e.target.value || null,
                                      });
                                    }}
                                  >
                                    <option value="">
                                      — Belum didelegasikan —
                                    </option>
                                    {operatorUsers
                                      .filter(
                                        (u) =>
                                          !u.office ||
                                          u.office.trim().toUpperCase() ===
                                            "IT" ||
                                          isMatchingOffice(
                                            u.office,
                                            entry.office,
                                          ),
                                      )
                                      .map((u) => (
                                        <option
                                          key={u.username}
                                          value={u.username}
                                        >
                                          {u.username}
                                        </option>
                                      ))}
                                  </select>
                                  {item.delegatedTo && (
                                    <span className="badge badge-xs badge-info font-bold gap-0.5 shrink-0">
                                      <UserCheck className="h-2.5 w-2.5" />
                                      {item.delegatedTo}
                                    </span>
                                  )}
                                </div>
                              </td>
                            )}
                            <td className="text-xs text-slate-600">
                              {toCanonicalOfficeName(entry.office)}
                            </td>
                            <td className="text-xs text-slate-500 whitespace-nowrap">
                              {formatDateTime(item.updatedAt)}
                            </td>
                            <td className="text-right sticky right-0 bg-amber-50/90 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)]">
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(`/input?sku=${item.sku}`)
                                }
                                className="btn btn-xs bg-amber-600 hover:bg-amber-700 text-white border-none rounded-lg text-[10px] font-bold"
                              >
                                <PenLine className="h-3 w-3" />
                                Input
                              </button>
                            </td>
                          </tr>
                        );
                      }

                      const row = entry.row;
                      const rowExt = row as NavRowWithDelegation;
                      const isDelegating =
                        delegateMutation.isPending &&
                        delegateMutation.variables?.id === row.id;

                      return (
                        <tr key={row.id} className="hover:bg-slate-50/80 group">
                          <td className="text-slate-400 font-medium">
                            {(safePage - 1) * pageSize + index + 1}
                          </td>
                          <td className="font-mono font-bold text-slate-800">
                            {row.sku}
                          </td>
                          <td className="text-slate-700 max-w-[180px] truncate">
                            {row.name}
                          </td>
                          <td>
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                              <AlertCircle className="h-3 w-3" />
                              SELISIH
                            </span>
                          </td>
                          {isAdmin && (
                            <td>
                              <div className="flex items-center gap-1.5 min-w-[180px]">
                                <select
                                  className="select select-bordered select-xs font-semibold bg-white w-full max-w-[160px]"
                                  value={rowExt.delegatedTo ?? ""}
                                  disabled={isDelegating}
                                  onChange={(e) => {
                                    delegateMutation.mutate({
                                      id: row.id,
                                      delegatedTo: e.target.value || null,
                                    });
                                  }}
                                >
                                  <option value="">
                                    — Belum didelegasikan —
                                  </option>
                                  {operatorUsers
                                    .filter(
                                      (u) =>
                                        !u.office ||
                                        u.office.trim().toUpperCase() ===
                                          "IT" ||
                                        (row.office
                                          ? isMatchingOffice(
                                              u.office,
                                              row.office,
                                            )
                                          : false),
                                    )
                                    .map((u) => (
                                      <option
                                        key={u.username}
                                        value={u.username}
                                      >
                                        {u.username}
                                      </option>
                                    ))}
                                </select>
                                {rowExt.delegatedTo && (
                                  <span className="badge badge-xs badge-info font-bold gap-0.5 shrink-0">
                                    <UserCheck className="h-2.5 w-2.5" />
                                    {rowExt.delegatedTo}
                                  </span>
                                )}
                              </div>
                            </td>
                          )}
                          <td className="text-xs text-slate-600">
                            {row.office
                              ? toCanonicalOfficeName(row.office)
                              : "—"}
                          </td>
                          <td className="text-xs text-slate-500 whitespace-nowrap">
                            {formatDateTime(row.updatedAt)}
                          </td>
                          <td className="text-right sticky right-0 bg-white z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)] group-hover:bg-slate-50">
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/input?sku=${row.sku}`)
                              }
                              className="btn btn-xs bg-slate-600 hover:bg-slate-700 text-white border-none rounded-lg text-[10px] font-bold"
                            >
                              <PenLine className="h-3 w-3" />
                              Input
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

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
            </>
          )}
        </div>
      </div>

      <dialog id="close-period-modal" className="modal">
        <div className="modal-box max-w-md">
          <h3 className="font-bold text-lg">Tutup periode {compareOffice}</h3>
          <p className="text-sm text-slate-500 mt-1">
            Menutup kerja gudang <strong>{compareOffice}</strong>: mode kembali
            ke Free, snapshot Initial SOT dibersihkan, dan katalog tugas SKU
            di-reset untuk siklus berikutnya.
          </p>
          <p className="text-sm text-slate-500 mt-2">
            Scan historis tidak dihapus — lihat lewat filter tanggal (Dari /
            Sampai).
          </p>
          {!canManagePeriod && (
            <p className="text-sm text-amber-600 mt-2">
              Pilih gudang spesifik di filter Wilayah sebelum menutup periode.
            </p>
          )}
          {periodMode !== "OPNAME" && canManagePeriod && (
            <p className="text-sm text-amber-600 mt-2">
              Gudang ini masih mode Free. Buka periode dulu sebelum menutup.
            </p>
          )}
          <div className="modal-action">
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                (
                  document.getElementById(
                    "close-period-modal",
                  ) as HTMLDialogElement
                )?.close()
              }
            >
              Batal
            </button>
            <button
              disabled={
                closePeriodMutation.isPending ||
                !canManagePeriod ||
                periodMode !== "OPNAME"
              }
              className="btn btn-sm bg-slate-700 text-white border-slate-700 hover:bg-slate-800 disabled:opacity-50"
              onClick={() => closePeriodMutation.mutate()}
            >
              {closePeriodMutation.isPending
                ? "Menutup..."
                : "Ya, tutup periode"}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit">close</button>
        </form>
      </dialog>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div
            className={`flex items-center gap-3 px-5 py-4 rounded-2xl border backdrop-blur-xl shadow-xl ${
              toast.type === "success"
                ? "bg-white border-emerald-200/80 text-emerald-900"
                : toast.type === "info"
                  ? "bg-white border-indigo-200/80 text-indigo-900"
                  : "bg-white border-red-200/80 text-red-900"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : toast.type === "info" ? (
              <DatabaseBackup className="h-5 w-5 text-indigo-500" />
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
