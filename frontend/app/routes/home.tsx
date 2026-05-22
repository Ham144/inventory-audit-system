import { useState, useMemo, useEffect } from "react";
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  Layers,
  Boxes,
  Database,
  Sparkles,
  Clock,
  AlertCircle,
  UserCheck,
  Undo2,
  Plus,
  MapPin,
} from "lucide-react";
import { Link } from "react-router";
import axiosInstance from "../api/axios-instance";
import locationApi from "../api/LocationApi";
import { useUserInfo } from "../store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CompareApi,
  type CompareQueryParams,
  type ScanCompareRow,
} from "~/api/compare.api";

// ==========================================
// Types & Interfaces
// ==========================================
interface ScanLog {
  id: string;
  rak: number;
  sku: string;
  name: string;
  qty?: number;
  locationCode?: string;
  createdAt: string;
  operator: string;
}

interface ProductCompare {
  id: string;
  sku: string;
  name: string;
  physicalQty: number;
  systemQty: number;
  status: "sesuai" | "selisih" | "belum_compare" | "loading";
  locationCode: string;
  updatedAt: string;
}

function normalizeNavStatus(status: string): ProductCompare["status"] {
  const s = status.toLowerCase();
  if (s === "sesuai" || s === "selisih" || s === "belum_compare") {
    return s;
  }
  return "belum_compare";
}

function mapNavCompareItem(raw: {
  id: string;
  sku: string;
  name: string;
  physicalQty: number;
  systemQty: number;
  status: string;
  locationCode: string;
  updatedAt: string;
}): ProductCompare {
  return {
    id: raw.id,
    sku: raw.sku,
    name: raw.name,
    physicalQty: raw.physicalQty,
    systemQty: raw.systemQty,
    status: normalizeNavStatus(raw.status),
    locationCode: raw.locationCode,
    updatedAt: raw.updatedAt,
  };
}

type UnifiedCompareRow = ScanCompareRow & {
  nav: ProductCompare | null;
};

function mergeCompareRows(
  scanRows: ScanCompareRow[],
  navRows: ProductCompare[],
): UnifiedCompareRow[] {
  const navByKey = new Map<string, ProductCompare>();
  for (const nav of navRows) {
    navByKey.set(`${nav.sku}|${nav.locationCode}`, nav);
  }
  return scanRows.map((scan) => ({
    ...scan,
    nav: navByKey.get(`${scan.sku}|${scan.locationCode}`) ?? null,
  }));
}

function ScanStatusBadge({ match }: { match: boolean }) {
  return match ? (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
      QTY SAMA
    </span>
  ) : (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-red-50 text-red-700 border border-red-200">
      QTY BEDA
    </span>
  );
}

function NavStatusBadge({ nav }: { nav: ProductCompare | null }) {
  if (!nav) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-slate-100 text-slate-500 border border-slate-200">
        BELUM ADA DATA
      </span>
    );
  }

  if (nav.status === "sesuai") {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200 w-fit">
          NAV SESUAI
        </span>
        <span className="text-[9px] text-slate-500 font-mono">
          {nav.physicalQty} / {nav.systemQty} ERP
        </span>
      </div>
    );
  }

  if (nav.status === "selisih") {
    const delta = nav.physicalQty - nav.systemQty;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200 w-fit">
          NAV SELISIH ({delta >= 0 ? "+" : ""}
          {delta})
        </span>
        <span className="text-[9px] text-slate-500 font-mono">
          {nav.physicalQty > 0 ? nav.physicalQty : "—"} / {nav.systemQty} ERP
        </span>
      </div>
    );
  }

  return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200">
      BELUM COMPARE
    </span>
  );
}

export default function Home() {
  const [selectedLocation, setSelectedLocation] = useState("Semua");
  const [locations, setLocations] = useState<any[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [selectedRak, setSelectedRak] = useState("Semua");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSyncingWithSoT, setIsSyncingWithSoT] = useState(false);
  const [username, setUsername] = useState("");

  const { userInfo } = useUserInfo();
  const queryClient = useQueryClient();

  const compareFilters: CompareQueryParams = {
    locationCode: selectedLocation,
    rak: selectedRak,
    search: searchTerm,
  };

  const scanCompareQuery = useQuery({
    queryKey: ["compare", "scan", compareFilters],
    queryFn: () => CompareApi.compareScan(compareFilters),
  });

  const navCompareQuery = useQuery({
    queryKey: ["compare", "nav", compareFilters],
    queryFn: async () => {
      const items = await CompareApi.fetchNavCompareList(compareFilters);
      return items.map(mapNavCompareItem);
    },
  });

  const scanLogsAllQuery = useQuery({
    queryKey: ["opname", "scans", selectedLocation, "Semua"],
    queryFn: async () => {
      const res = await axiosInstance.get<ScanLog[]>("/api/opname/scans", {
        params: { locationCode: selectedLocation, rak: "Semua" },
      });
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const scanLogsFeedQuery = useQuery({
    queryKey: ["opname", "scans", selectedLocation, selectedRak],
    queryFn: async () => {
      const res = await axiosInstance.get<ScanLog[]>("/api/opname/scans", {
        params: { locationCode: selectedLocation, rak: selectedRak },
      });
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const scanCompareRows = scanCompareQuery.data ?? [];
  const navCompareRows = navCompareQuery.data ?? [];
  const unifiedCompareRows = useMemo(
    () => mergeCompareRows(scanCompareRows, navCompareRows),
    [scanCompareRows, navCompareRows],
  );
  const scanLogsFeed = scanLogsFeedQuery.data ?? [];
  const isLoadingCompare =
    scanCompareQuery.isFetching || navCompareQuery.isFetching;

  const invalidateOpnameQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["opname", "scans"] });
    queryClient.invalidateQueries({ queryKey: ["compare"] });
  };

  const runCompareAll = async () => {
    const [scanResult, navResult] = await Promise.all([
      scanCompareQuery.refetch(),
      navCompareQuery.refetch(),
    ]);
    if (scanResult.isError || navResult.isError) {
      showToast("Sebagian perbandingan gagal dimuat", "warning");
      return;
    }
    showToast("Perbandingan scan & NAV selesai", "success");
  };

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "warning" | "info";
  } | null>(null);

  // Custom Toast handler
  const showToast = (
    message: string,
    type: "success" | "warning" | "info" = "success",
  ) => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Sync state username with store userInfo
  useEffect(() => {
    if (userInfo) {
      const name =
        userInfo.displayName ||
        userInfo.username ||
        userInfo.name ||
        userInfo.usernameLdap;
      if (name) {
        setUsername(name);
      }
    }
  }, [userInfo]);

  // Load locations and user info on mount
  useEffect(() => {
    const fetchLocations = async () => {
      setIsLoadingLocations(true);
      try {
        const res = await locationApi.getAllLocation("");
        let fetchedLocs: any[] = [];
        if (Array.isArray(res)) {
          fetchedLocs = res;
        } else if (res && Array.isArray(res.data)) {
          fetchedLocs = res.data;
        }
        setLocations(fetchedLocs);
      } catch (err) {
        setLocations([]);
      } finally {
        setIsLoadingLocations(false);
      }
    };
    fetchLocations();
  }, [userInfo]);

  // Manual Trigger to Sync system stock with ERP / SOT
  const fetchQuantitiesFromSoT = async (forceToast = false) => {
    setIsSyncingWithSoT(true);
    try {
      const res = await axiosInstance.post("/so/api/opname/sync", {
        locationCode: selectedLocation,
      });
      if (Array.isArray(res.data)) {
        invalidateOpnameQueries();
        if (forceToast) {
          showToast(
            "Kuantitas sistem berhasil diperbarui dari Source of Truth!",
            "success",
          );
        }
      }
    } catch {
      if (forceToast) {
        showToast("Gagal terhubung ke Source of Truth (midcsi)", "warning");
      }
    } finally {
      setIsSyncingWithSoT(false);
    }
  };

  // Reset active session state
  const resetAllReconciled = async () => {
    try {
      const res = await axiosInstance.post("/so/api/opname/reset", {
        locationCode: selectedLocation,
      });
      if (res.data) {
        invalidateOpnameQueries();
        showToast(
          "State berhasil direset ke status awal. Scan database dibersihkan.",
          "info",
        );
      }
    } catch {
      showToast("Gagal mereset state", "warning");
    }
  };

  const scanLogsAll = scanLogsAllQuery.data ?? [];

  const uniqueRaks = useMemo(() => {
    const raks = scanLogsAll.map((log) => String(log.rak));
    return Array.from(new Set(raks)).sort((a, b) => Number(a) - Number(b));
  }, [scanLogsAll]);

  const stats = useMemo(() => {
    const total = unifiedCompareRows.length;
    const scanSesuai = unifiedCompareRows.filter((i) => i.match).length;
    const scanSelisih = unifiedCompareRows.filter((i) => !i.match).length;
    const navSesuai = unifiedCompareRows.filter(
      (i) => i.nav?.status === "sesuai",
    ).length;
    const navSelisih = unifiedCompareRows.filter(
      (i) => i.nav?.status === "selisih",
    ).length;
    return {
      total,
      scanSesuai,
      scanSelisih,
      navSesuai,
      navSelisih,
    };
  }, [unifiedCompareRows]);

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-800 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Subtle Dot Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-size-[4rem_4rem] mask-[radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-40 z-0" />

      {/* ==========================================
          HEADER SECTION ( Frosted White Glass )
          ========================================== */}
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur-xl sticky top-0 z-30 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm shadow-slate-100/50">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-linear-to-tr from-indigo-500 to-violet-500 rounded-2xl shadow-md shadow-indigo-500/10 ring-1 ring-white">
            <Layers className="h-6 w-6 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
              Stok Opname - Catur Sukses Internasional
            </h1>
            <p className="text-xs text-slate-500 font-semibold">
              Reconciliation Dashboard & Audit Control Room
            </p>
          </div>
        </div>

        {/* Global Toolbar */}
        <div className="flex items-center gap-3 self-end md:self-auto">
          {/* Refresh Source of Truth trigger button */}
          <button
            onClick={() => fetchQuantitiesFromSoT(true)}
            disabled={isSyncingWithSoT}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-205 text-xs font-bold text-indigo-650 hover:text-indigo-800 bg-white hover:bg-slate-50 transition-all duration-200 shadow-sm cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isSyncingWithSoT ? "animate-spin" : ""}`}
            />
            {isSyncingWithSoT ? "Syncing..." : "Refresh Data Sistem"}
          </button>

          <Link
            to="/scan"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-indigo-200 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-all duration-200 shadow-sm cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Input Barang
          </Link>

          <button
            onClick={resetAllReconciled}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:text-slate-900 hover:border-slate-350 bg-white hover:bg-slate-50 transition-all duration-200 shadow-sm cursor-pointer"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Reset State
          </button>

          <div className="h-6 w-px bg-slate-200" />
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold tracking-wider uppercase border border-emerald-200 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
            Live Sync
          </span>

          {username && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-750 text-[10px] font-bold tracking-wider border border-indigo-150 shadow-sm">
              <UserCheck className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
              <span>Opr: {username}</span>
            </span>
          )}
        </div>
      </header>

      {/* ==========================================
          TOAST ALERT ( Frosted Floating Glass )
          ========================================== */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 transform translate-y-0 transition-all duration-300">
          <div
            className={`flex items-center gap-3 px-5 py-4 rounded-2xl border backdrop-blur-xl shadow-xl ${
              toast.type === "success"
                ? "bg-white border-emerald-200/80 text-emerald-955 shadow-emerald-500/5"
                : toast.type === "warning"
                  ? "bg-white border-red-200/80 text-red-955 shadow-red-500/5"
                  : "bg-white border-indigo-200/80 text-indigo-955 shadow-indigo-500/5"
            }`}
          >
            <div
              className={`p-1.5 rounded-lg ${
                toast.type === "success"
                  ? "bg-emerald-50 text-emerald-500"
                  : toast.type === "warning"
                    ? "bg-red-50 text-red-500"
                    : "bg-indigo-50 text-indigo-500"
              }`}
            >
              {toast.type === "success" ? (
                <CheckCircle2 className="h-5 w-5 shrink-0" />
              ) : toast.type === "warning" ? (
                <AlertTriangle className="h-5 w-5 shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 shrink-0" />
              )}
            </div>
            <p className="text-sm font-bold tracking-wide">{toast.message}</p>
          </div>
        </div>
      )}

      {/* ==========================================
          METRICS & ANALYTICS BAR ( Clean White Cards )
          ========================================== */}
      <section className="relative z-10 px-6 pt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="bg-white border border-slate-200/85 rounded-2xl p-4.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-slate-300/80 transition-all duration-200">
          <div className="absolute top-0 right-0 h-16 w-16 bg-indigo-500/5 rounded-bl-full transform translate-x-2 -translate-y-2 group-hover:scale-125 transition-transform duration-300" />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Total Data
            </span>
            <span className="text-2xl font-black tracking-tight text-slate-800">
              {stats.total}{" "}
              <span className="text-xs font-medium text-slate-400">items</span>
            </span>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl border border-indigo-100">
            <Boxes className="h-5 w-5" />
          </div>
        </div>

        {/* Metric 2 */}
        <div className="bg-white border border-slate-200/85 rounded-2xl p-4.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-slate-300/80 transition-all duration-200">
          <div className="absolute top-0 right-0 h-16 w-16 bg-red-500/5 rounded-bl-full transform translate-x-2 -translate-y-2 group-hover:scale-125 transition-transform duration-300" />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Qty Operator Beda
            </span>
            <span className="text-2xl font-black tracking-tight text-red-500">
              {stats.scanSelisih}{" "}
              <span className="text-xs font-medium text-red-400">scan</span>
            </span>
          </div>
          <div className="p-3 bg-red-50 text-red-600 rounded-2xl border border-red-100">
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>

        {/* Metric 3 */}
        <div className="bg-white border border-slate-200/85 rounded-2xl p-4.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-slate-300/80 transition-all duration-200">
          <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/5 rounded-bl-full transform translate-x-2 -translate-y-2 group-hover:scale-125 transition-transform duration-300" />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              NAV Selisih
            </span>
            <span className="text-2xl font-black tracking-tight text-amber-500">
              {stats.navSelisih}{" "}
              <span className="text-xs font-medium text-amber-400">erp</span>
            </span>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl border border-amber-100">
            <Database className="h-5 w-5" />
          </div>
        </div>

        {/* Metric 4 */}
        <div className="bg-white border border-slate-200/85 rounded-2xl p-4.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-slate-300/80 transition-all duration-200">
          <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/5 rounded-bl-full transform translate-x-2 -translate-y-2 group-hover:scale-125 transition-transform duration-300" />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Keduanya Sesuai
            </span>
            <span className="text-2xl font-black tracking-tight text-emerald-600">
              {stats.scanSesuai}{" "}
              <span className="text-xs font-medium text-slate-400">
                scan · {stats.navSesuai} nav
              </span>
            </span>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>
      </section>

      {/* ==========================================
          CONTROL BAR & FILTERS PANEL ( Clean Elegant Glass )
          ========================================== */}
      <section className="relative z-10 px-6 pt-6">
        <div className="bg-white border border-slate-200/85 rounded-3xl p-5 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          {/* Left: Interactive Filters */}
          <div className="flex flex-wrap items-center gap-6">
            {/* Dropdown Wilayah / Lokasi */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-indigo-500" />
                Pilih Wilayah / Gudang
              </label>
              <select
                value={selectedLocation}
                onChange={(e) => {
                  setSelectedLocation(e.target.value);
                  setSelectedRak("Semua"); // reset rak filter on location change
                }}
                disabled={isLoadingLocations}
                className="bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-sm text-slate-800 outline-none transition-all duration-200  shadow-inner font-semibold cursor-pointer"
              >
                {isLoadingLocations ? (
                  <option>Memuat wilayah...</option>
                ) : (
                  <>
                    <option value="Semua">Semua Wilayah</option>
                    {locations.map((loc) => (
                      <option key={loc.code} value={loc.code}>
                        {loc.name || loc.description || loc.code}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            {/* Dropdown "Pilih Rak" (Dynamic based on scans) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <SlidersHorizontal className="h-3 w-3 text-indigo-500" />
                Filter Nomor Rak
              </label>
              <select
                value={selectedRak}
                onChange={(e) => {
                  setSelectedRak(e.target.value);
                  showToast(
                    `Filter rak diubah ke: ${e.target.value === "Semua" ? "Semua Rak" : `Rak ${e.target.value}`}`,
                    "info",
                  );
                }}
                className="bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-sm text-slate-800 outline-none transition-all duration-200  shadow-inner font-semibold cursor-pointer"
              >
                <option value="Semua">Semua Rak</option>
                {uniqueRaks.map((rakNo) => (
                  <option key={rakNo} value={rakNo}>
                    Rak {rakNo}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Right: Real-time Search */}
          <div className="flex items-center gap-3 w-full xl:w-80 self-end xl:self-center">
            <div className="relative w-full">
              <input
                type="text"
                placeholder="Cari SKU atau nama barang..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition-all duration-200 shadow-inner"
              />
              <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
            </div>
          </div>
        </div>
      </section>

      {/* ==========================================
          MAIN AREA: SIDEBAR LOG & SPLIT COMPARE GRID
          ========================================== */}
      <main className="relative z-10 flex-1 px-6 py-6 grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* ==========================================
            LEFT SIDEBAR: REAL-TIME SCAN FEEDS ( Frosted Glass Light )
            ========================================== */}
        <section className="lg:col-span-1 bg-white/90 border border-slate-200 rounded-3xl flex flex-col shadow-sm">
          <div className="p-4 border-b border-slate-150 bg-slate-50/50 rounded-t-3xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-indigo-500 animate-spin-slow" />
              <h2 className="text-xs font-bold tracking-wider uppercase text-slate-700">
                Riwayat Scan
              </h2>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 font-bold border border-indigo-100 tracking-wide">
              {scanLogsFeed.length} Feed
            </span>
          </div>

          {/* List Scroll */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
            {scanLogsFeed.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <SlidersHorizontal className="h-8 w-8 text-slate-300 mb-2" />
                <p className="text-xs font-semibold">
                  Belum ada scan di wilayah/rak ini
                </p>
              </div>
            ) : (
              scanLogsFeed.map((log) => (
                <div
                  key={log.id}
                  className="p-3.5 rounded-2xl border border-slate-150 bg-white hover:bg-slate-50/50 hover:-translate-y-px transition-all duration-200 group relative shadow-sm"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-600 text-[10px] font-bold border border-indigo-100/80 tracking-wider">
                      Rak {log.rak}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {new Date(log.createdAt).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <p className="text-xs font-bold text-slate-800 mb-1 leading-relaxed group-hover:text-indigo-955 transition-colors duration-150">
                    {log.name}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-semibold tracking-wider font-mono bg-slate-50 px-1.5 py-0.5 rounded border border-slate-150 text-slate-700">
                      SKU: {log.sku}
                    </span>
                    <span className="flex items-center gap-1 font-medium text-slate-400">
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      Opr: {log.operator}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ==========================================
            CENTER AREA: TAB-FREE RECONCILIATION TABLE
            ========================================== */}
        <section className="lg:col-span-3 bg-white/95 border border-slate-200 rounded-3xl flex flex-col overflow-hidden shadow-sm relative">
          {/* Section Header */}
          <div className="p-4 border-b border-slate-150 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-xs font-bold text-slate-600">
              Perbandingan scan operator &amp; stok NAV (ERP)
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => runCompareAll()}
              disabled={isLoadingCompare}
            >
              {isLoadingCompare ? "Membandingkan..." : "Compare Nav"}
            </button>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3.5 px-4 sticky top-0 z-10">
              <div className="col-span-1 flex items-center">
                <span className="h-4 w-4 rounded-full border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                  #
                </span>
              </div>
              <div className="col-span-3">Info Barang</div>
              <div className="col-span-3 border-l border-slate-200 pl-4">
                <span className="flex items-center gap-1.5 text-indigo-650">
                  <UserCheck className="h-3 w-3" /> Qty per Operator
                </span>
              </div>
              <div className="col-span-2 border-l border-slate-200 pl-4">
                <span className="flex items-center gap-1.5 text-red-600">
                  <UserCheck className="h-3 w-3" /> Status Scan
                </span>
              </div>
              <div className="col-span-2 border-l border-slate-200 pl-4">
                <span className="flex items-center gap-1.5 text-violet-650">
                  <Database className="h-3 w-3" /> Status NAV
                </span>
              </div>
              <div className="col-span-1 border-l border-slate-200 pl-4">
                <span className="flex items-center gap-1.5 text-slate-655">
                  <MapPin className="h-3 w-3" /> Lokasi
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-150 bg-white">
              {unifiedCompareRows.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-12 text-slate-400 bg-white">
                  <CheckCircle2 className="h-12 w-12 text-slate-200 mb-3" />
                  <p className="text-sm font-bold text-slate-700">
                    Belum ada data perbandingan
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Lakukan scan barang lalu klik &quot;Jalankan Compare&quot;.
                  </p>
                </div>
              ) : (
                unifiedCompareRows.map((item) => {
                  const hasIssue =
                    !item.match || item.nav?.status === "selisih";
                  const borderHighlight = hasIssue
                    ? "border-l-4 border-l-amber-500"
                    : "border-l-4 border-l-emerald-500";
                  const bgHighlight = hasIssue
                    ? "bg-amber-50/15 hover:bg-amber-50/30"
                    : "bg-emerald-50/15 hover:bg-emerald-50/40";

                  return (
                    <div
                      key={`${item.sku}-${item.rak}-${item.locationCode}`}
                      className={`grid grid-cols-12 py-3.5 px-4 items-center transition-all duration-150 ${borderHighlight} ${bgHighlight}`}
                    >
                      <div className="col-span-1 flex items-center">
                        <span
                          className={`h-4 w-4 rounded-full border flex items-center justify-center text-[10px] ${
                            hasIssue
                              ? "bg-amber-50 border-amber-200 text-amber-500"
                              : "bg-emerald-50 border-emerald-200 text-emerald-500"
                          }`}
                        >
                          <div className="h-1.5 w-1.5 rounded-full bg-current" />
                        </span>
                      </div>
                      <div className="col-span-3 pr-4">
                        <p className="text-xs font-bold text-slate-800 line-clamp-1">
                          {item.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className="text-[10px] text-slate-505 font-mono tracking-wide font-medium bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                            SKU: {item.sku}
                          </span>
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                            Rak {item.rak}
                          </span>
                        </div>
                      </div>
                      <div className="col-span-3 border-l border-slate-150 pl-4 py-1">
                        <div className="flex flex-col gap-1.5">
                          {item.scans.map((scan) => (
                            <div
                              key={scan.id}
                              className={`flex items-center justify-between text-[11px] rounded-lg px-2 py-1 border ${
                                item.match
                                  ? "border-slate-150 bg-white"
                                  : "border-red-200 bg-red-50/80"
                              }`}
                            >
                              <span className="text-slate-500 font-semibold truncate max-w-[55%]">
                                {scan.operator}
                              </span>
                              <span
                                className={`text-xs font-black ${
                                  item.match ? "text-slate-800" : "text-red-700"
                                }`}
                              >
                                {scan.qty} pcs
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="col-span-2 border-l border-slate-150 pl-4 py-1">
                        <ScanStatusBadge match={item.match} />
                      </div>
                      <div className="col-span-2 border-l border-slate-150 pl-4 py-1">
                        <NavStatusBadge nav={item.nav} />
                      </div>
                      <div className="col-span-1 border-l border-slate-150 pl-4 py-1">
                        <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 font-mono block truncate">
                          {item.locationCode}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ==========================================
          FOOTER
          ========================================== */}
      <footer className="relative z-10 border-t border-slate-200/80 bg-white/40 px-6 py-4 flex items-center justify-between text-xs text-slate-400 font-medium mt-auto">
        <p>&copy; 2026 CSI Stok Opname System. All rights reserved.</p>
        <p className="flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5 text-indigo-500 animate-pulse" />
          Designed with Premium Performance
        </p>
      </footer>
    </div>
  );
}
