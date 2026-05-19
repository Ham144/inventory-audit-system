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

// ==========================================
// Types & Interfaces
// ==========================================
interface ScanLog {
  id: string;
  rak: number;
  sku: string;
  name: string;
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
  updatedAt: string;
}

export default function Home() {
  const [selectedLocation, setSelectedLocation] = useState("Semua");
  const [locations, setLocations] = useState<any[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [selectedRak, setSelectedRak] = useState("Semua");
  const [searchTerm, setSearchTerm] = useState("");
  const [compareData, setCompareData] = useState<ProductCompare[]>([]);
  const [scanLogs, setScanLogs] = useState<ScanLog[]>([]);
  const [isSyncingWithSoT, setIsSyncingWithSoT] = useState(false);
  const [username, setUsername] = useState("");

  const { userInfo } = useUserInfo();

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

  // Main loader for comparison and scan log lists from PostgreSQL
  const loadDatabaseData = async () => {
    try {
      // Fetch comparison items from our backend
      const comparisonRes = await axiosInstance.get(
        `/so/api/opname/comparison?locationCode=${selectedLocation}`,
      );
      if (Array.isArray(comparisonRes.data)) {
        setCompareData(comparisonRes.data);
      }

      // Fetch scan logs from our backend
      const scansRes = await axiosInstance.get(
        `/so/api/opname/scans?locationCode=${selectedLocation}`,
      );
      if (Array.isArray(scansRes.data)) {
        setScanLogs(scansRes.data);
      }
    } catch (err) {
      console.error("Gagal memuat data dari database:", err);
    }
  };

  // Refetch when active location changes
  useEffect(() => {
    loadDatabaseData();
  }, [selectedLocation]);

  // Manual Trigger to Sync system stock with ERP / SOT
  const fetchQuantitiesFromSoT = async (forceToast = false) => {
    setIsSyncingWithSoT(true);
    try {
      const res = await axiosInstance.post("/so/api/opname/sync", {
        locationCode: selectedLocation,
      });
      if (Array.isArray(res.data)) {
        setCompareData(res.data);
        if (forceToast) {
          showToast(
            "Kuantitas sistem berhasil diperbarui dari Source of Truth!",
            "success",
          );
        }
      }
      // Refetch scan logs to keep everything perfectly in sync
      const scansRes = await axiosInstance.get(
        `/so/api/opname/scans?locationCode=${selectedLocation}`,
      );
      if (Array.isArray(scansRes.data)) {
        setScanLogs(scansRes.data);
      }
    } catch (err) {
      console.error("Gagal sync:", err);
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
        await loadDatabaseData();
        showToast(
          "State berhasil direset ke status awal. Scan database dibersihkan.",
          "info",
        );
      }
    } catch (err) {
      console.error("Gagal mereset state:", err);
    }
  };

  // Dynamic Unique Raks list compile from database scan logs
  const uniqueRaks = useMemo(() => {
    const raks = scanLogs.map((log) => String(log.rak));
    return Array.from(new Set(raks)).sort((a, b) => Number(a) - Number(b));
  }, [scanLogs]);

  // ==========================================
  // Filter Logic
  // ==========================================
  const filteredCompareData = useMemo(() => {
    return compareData.filter((item) => {
      // Filter by Rak
      if (selectedRak !== "Semua") {
        const hasRakScan = scanLogs.some(
          (log) => log.sku === item.sku && String(log.rak) === selectedRak,
        );
        if (!hasRakScan) return false;
      }
      // Filter by Search SKU / Name
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesSku = item.sku.toLowerCase().includes(term);
        const matchesName = item.name.toLowerCase().includes(term);
        if (!matchesSku && !matchesName) return false;
      }
      return true;
    });
  }, [compareData, selectedRak, searchTerm, scanLogs]);

  const filteredScanLogs = useMemo(() => {
    return scanLogs.filter((log) => {
      if (selectedRak !== "Semua") {
        if (String(log.rak) !== selectedRak) return false;
      }
      return true;
    });
  }, [selectedRak, scanLogs]);

  // Stats calculation
  const stats = useMemo(() => {
    const total = compareData.length;
    const sesuai = compareData.filter((i) => i.status === "sesuai").length;
    const selisih = compareData.filter((i) => i.status === "selisih").length;
    const belumCompare = compareData.filter(
      (i) => i.status === "belum_compare",
    ).length;
    return { total, sesuai, selisih, belumCompare };
  }, [compareData]);

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
            Input Hasil Scan
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
                  ? "bg-white border-amber-200/80 text-amber-955 shadow-amber-500/5"
                  : "bg-white border-indigo-200/80 text-indigo-955 shadow-indigo-500/5"
            }`}
          >
            <div
              className={`p-1.5 rounded-lg ${
                toast.type === "success"
                  ? "bg-emerald-50 text-emerald-500"
                  : toast.type === "warning"
                    ? "bg-amber-50 text-amber-500"
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
          <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/5 rounded-bl-full transform translate-x-2 -translate-y-2 group-hover:scale-125 transition-transform duration-300" />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Selisih (Discrepancies)
            </span>
            <span className="text-2xl font-black tracking-tight text-amber-500">
              {stats.selisih}{" "}
              <span className="text-xs font-medium text-amber-400">alerts</span>
            </span>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl border border-amber-100">
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>

        {/* Metric 3 */}
        <div className="bg-white border border-slate-200/85 rounded-2xl p-4.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-slate-300/80 transition-all duration-200">
          <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/5 rounded-bl-full transform translate-x-2 -translate-y-2 group-hover:scale-125 transition-transform duration-300" />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Sesuai (Match)
            </span>
            <span className="text-2xl font-black tracking-tight text-emerald-600">
              {stats.sesuai}{" "}
              <span className="text-xs font-medium text-slate-400">items</span>
            </span>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>

        {/* Metric 4 */}
        <div className="bg-white border border-slate-200/85 rounded-2xl p-4.5 flex items-center justify-between shadow-sm relative overflow-hidden group hover:border-slate-300/80 transition-all duration-200">
          <div className="absolute top-0 right-0 h-16 w-16 bg-slate-500/5 rounded-bl-full transform translate-x-2 -translate-y-2 group-hover:scale-125 transition-transform duration-300" />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Belum Compare
            </span>
            <span className="text-2xl font-black tracking-tight text-slate-500">
              {stats.belumCompare}{" "}
              <span className="text-xs font-medium text-slate-400">
                pending
              </span>
            </span>
          </div>
          <div className="p-3 bg-slate-100 text-slate-600 rounded-2xl border border-slate-200">
            <Clock className="h-5 w-5" />
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
                className="bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-sm text-slate-800 outline-none transition-all duration-200 min-w-[200px] shadow-inner font-semibold cursor-pointer"
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
                className="bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-sm text-slate-800 outline-none transition-all duration-200 min-w-[150px] shadow-inner font-semibold cursor-pointer"
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
        <section className="lg:col-span-1 bg-white/90 border border-slate-200 rounded-3xl flex flex-col h-[650px] shadow-sm">
          <div className="p-4 border-b border-slate-150 bg-slate-50/50 rounded-t-3xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-indigo-500 animate-spin-slow" />
              <h2 className="text-xs font-bold tracking-wider uppercase text-slate-700">
                Riwayat Scan
              </h2>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 font-bold border border-indigo-100 tracking-wide">
              {filteredScanLogs.length} Feed
            </span>
          </div>

          {/* List Scroll */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
            {filteredScanLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <SlidersHorizontal className="h-8 w-8 text-slate-300 mb-2" />
                <p className="text-xs font-semibold">
                  Belum ada scan di wilayah/rak ini
                </p>
              </div>
            ) : (
              filteredScanLogs.map((log) => (
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
        <section className="lg:col-span-3 bg-white/95 border border-slate-200 rounded-3xl flex flex-col h-[650px] overflow-hidden shadow-sm relative">
          {/* Section Header */}
          <div className="p-4 border-b border-slate-150 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <span className="text-xs font-black uppercase tracking-wider text-slate-700">
              Menunggu Compare & Hasil Audit ({filteredCompareData.length}{" "}
              Barang)
            </span>
          </div>

          {/* Grid Layout Container */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Table Header Row */}
            <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3.5 px-4 sticky top-0 z-10">
              <div className="col-span-1 flex items-center">
                <span className="h-4 w-4 rounded-full border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                  #
                </span>
              </div>
              <div className="col-span-4">Info Barang</div>
              <div className="col-span-3 border-l border-slate-200 pl-4">
                <span className="flex items-center gap-1.5 text-indigo-650">
                  <UserCheck className="h-3 w-3" /> Data Fisik vs Sistem
                </span>
              </div>
              <div className="col-span-2 border-l border-slate-200 pl-4">
                <span className="flex items-center gap-1.5 text-violet-650">
                  <Database className="h-3 w-3" /> Status
                </span>
              </div>
              <div className="col-span-2 border-l border-slate-200 pl-4">
                <span className="flex items-center gap-1.5 text-slate-655">
                  <Clock className="h-3 w-3" /> Last Reconciled
                </span>
              </div>
            </div>

            {/* Table Data list */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-150 bg-white">
              {filteredCompareData.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-12 text-slate-400 bg-white">
                  <CheckCircle2 className="h-12 w-12 text-slate-200 mb-3" />
                  <p className="text-sm font-bold text-slate-700">
                    Tidak ada data perbandingan
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Silakan lakukan scan barang atau lakukan "Refresh Data
                    Sistem".
                  </p>
                </div>
              ) : (
                filteredCompareData.map((item) => {
                  // Determine status highlight color schemes
                  let borderHighlight = "border-l-4 border-l-transparent";
                  let bgHighlight = "hover:bg-slate-50/50";
                  let badge = null;

                  if (item.status === "sesuai") {
                    borderHighlight = "border-l-4 border-l-emerald-500";
                    bgHighlight = "bg-emerald-50/20 hover:bg-emerald-50/40";
                    badge = (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        SESUAI
                      </span>
                    );
                  } else if (item.status === "selisih") {
                    borderHighlight = "border-l-4 border-l-amber-500";
                    bgHighlight = "bg-amber-50/20 hover:bg-amber-50/40";
                    badge = (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200">
                        SELISIH (
                        {item.physicalQty - item.systemQty >= 0 ? "+" : ""}
                        {item.physicalQty - item.systemQty})
                      </span>
                    );
                  } else if (item.status === "belum_compare") {
                    borderHighlight = "border-l-4 border-l-slate-400";
                    bgHighlight = "bg-slate-50/30 hover:bg-slate-50/50";
                    badge = (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200">
                        BELUM COMPARE
                      </span>
                    );
                  } else if (item.status === "loading") {
                    borderHighlight =
                      "border-l-4 border-l-indigo-400 animate-pulse";
                    bgHighlight = "bg-indigo-50/10 hover:bg-indigo-50/20";
                    badge = (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse">
                        SYNCING...
                      </span>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className={`grid grid-cols-12 py-3.5 px-4 items-center transition-all duration-150 ${borderHighlight} ${bgHighlight}`}
                    >
                      {/* Row Icon Indicator */}
                      <div className="col-span-1 flex items-center">
                        <span
                          className={`h-4 w-4 rounded-full border flex items-center justify-center text-[10px] ${
                            item.status === "sesuai"
                              ? "bg-emerald-50 border-emerald-200 text-emerald-500"
                              : item.status === "belum_compare"
                                ? "bg-slate-50 border-slate-200 text-slate-400"
                                : "bg-amber-50 border-amber-200 text-amber-500"
                          }`}
                        >
                          <div className="h-1.5 w-1.5 rounded-full bg-current" />
                        </span>
                      </div>

                      {/* Info Barang */}
                      <div className="col-span-4 pr-4">
                        <p className="text-xs font-bold text-slate-800 line-clamp-1 group-hover:text-indigo-955">
                          {item.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className="text-[10px] text-slate-505 font-mono tracking-wide font-medium bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                            SKU: {item.sku}
                          </span>
                        </div>
                      </div>

                      {/* Column Data Fisik vs Sistem */}
                      <div className="col-span-3 border-l border-slate-150 pl-4 py-1">
                        <div className="flex flex-col gap-1 text-[11px]">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-semibold">
                              Fisik (Scan):
                            </span>
                            <span className="text-xs font-black text-slate-800">
                              {item.physicalQty} pcs
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-semibold">
                              Sistem (ERP):
                            </span>
                            <span className="text-xs font-black text-slate-700">
                              {item.systemQty} pcs
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Column Status */}
                      <div className="col-span-2 border-l border-slate-150 pl-4 py-1">
                        {badge}
                      </div>

                      {/* Column Last Reconciled */}
                      <div className="col-span-2 border-l border-slate-150 pl-4 py-1 text-xs font-bold text-slate-500 font-mono">
                        {item.updatedAt
                          ? new Date(item.updatedAt).toLocaleTimeString(
                              "id-ID",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              },
                            )
                          : "-"}
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
