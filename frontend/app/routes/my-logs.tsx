import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useNavigate } from "react-router";
import {
  History,
  ArrowLeft,
  Search,
  MapPin,
  Hash,
  Calendar,
  Package,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  BarChart3,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DocsShell } from "~/components/DocsShell";
import { useUserInfo } from "~/store";
import { traceLogs } from "~/api/opname.api";
import locationApi from "~/api/LocationApi";
import { compareOfficeScope, adminCanPickOffice, userOffice } from "~/libs/user-access";
import {
  normalizeLocationList,
  resolveInitialPickedOffice,
  resolvePickedOffice,
  fetchAndCacheMappings,
  type LocationItem,
} from "~/libs/location";
import { getAdminDefaultOffice, setAdminDefaultOffice } from "~/libs/app-prefs";

const PAGE_SIZES = [10, 25, 50, 100];

function formatDateTime(value: string) {
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

function toDateInputValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-5 py-3 min-w-[100px]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-xl font-black mt-0.5 ${accent ? "text-indigo-700" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}

export default function MyLogsPage() {
  const navigate = useNavigate();
  const { userInfo } = useUserInfo();
  const showOfficePicker = adminCanPickOffice(userInfo);

  const [pickedOffice, setPickedOffice] = useState("Semua");
  const officeDefaultApplied = useRef(false);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRak, setSelectedRak] = useState("Semua");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Pagination
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  const compareOffice = compareOfficeScope(
    userInfo,
    showOfficePicker ? pickedOffice : undefined,
  );

  const scansQuery = useQuery({
    queryKey: ["trace-logs", compareOffice, selectedRak, dateFrom, dateTo],
    queryFn: () =>
      traceLogs({
        office: compareOffice && compareOffice !== "Semua" ? compareOffice : undefined,
        rak: selectedRak !== "Semua" ? selectedRak : undefined,
        startDate: dateFrom || undefined,
        endDate: dateTo || undefined,
      }),
    enabled: Boolean(userInfo?.username),
    refetchInterval: 15000,
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
    if (!showOfficePicker || locations.length === 0 || officeDefaultApplied.current) return;
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

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedRak, dateFrom, dateTo, compareOffice]);

  // Client-side text search only (server handles the rest)
  const filteredLogs = useMemo(() => {
    const data = scansQuery.data ?? [];
    const search = searchTerm.trim().toLowerCase();
    const username = userInfo?.username?.trim().toLowerCase();

    return data.filter((row) => {
      if (!showOfficePicker && row.username?.trim().toLowerCase() !== username) return false;
      if (search && !row.sku.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [scansQuery.data, searchTerm, userInfo?.username, showOfficePicker]);

  const uniqueRaks = useMemo(() => {
    const raks = (scansQuery.data ?? []).map((log) => String(log.rak));
    return Array.from(new Set(raks)).sort((a, b) => Number(a) - Number(b));
  }, [scansQuery.data]);

  const totalQty = useMemo(
    () => filteredLogs.reduce((sum, row) => sum + (row.physicalQty ?? 0), 0),
    [filteredLogs],
  );

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedLogs = filteredLogs.slice((safePage - 1) * pageSize, safePage * pageSize);

  const hasActiveFilters =
    searchTerm || selectedRak !== "Semua" || dateFrom || dateTo;

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedRak("Semua");
    setDateFrom("");
    setDateTo("");
  };

  const today = toDateInputValue(new Date());

  if (userInfo === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <span className="loading loading-spinner loading-lg text-indigo-500" />
      </div>
    );
  }

  return (
    <DocsShell title="Riwayat Scan" subtitle="My Logs" showDocSidebar={false}>
      <div className="max-w-5xl space-y-5">
        {/* Back link */}
        <Link
          to="/input"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Kembali ke input scan
        </Link>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-200">
              <History className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Riwayat {showOfficePicker ? "Semua Operator" : "Saya"}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Data scan tersimpan dari sistem tracing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => scansQuery.refetch()}
              disabled={scansQuery.isFetching}
              title="Refresh data"
              className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <RefreshCw
                className={`h-4 w-4 ${scansQuery.isFetching ? "animate-spin text-indigo-500" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="flex flex-wrap gap-3">
          <StatCard label="Total Baris" value={filteredLogs.length} />
          <StatCard label="Total Qty Fisik" value={totalQty.toLocaleString("id-ID")} accent />
          <StatCard
            label="Halaman"
            value={`${safePage} / ${totalPages}`}
          />
          {scansQuery.isFetching && !scansQuery.isLoading && (
            <div className="flex items-center gap-2 text-xs text-indigo-500 font-semibold bg-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Memperbarui...
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <BarChart3 className="h-3.5 w-3.5 text-indigo-500" />
              Filter Data
            </div>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-700 transition-colors"
              >
                <X className="h-3 w-3" />
                Reset filter
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {/* Search */}
            <div className="flex flex-col gap-1.5 min-w-[180px] flex-1">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <Search className="h-3 w-3 text-indigo-500" />
                Cari SKU
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Ketik SKU..."
                  className="input input-bordered input-sm w-full pl-9 bg-slate-50 font-semibold focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>

            {/* Office picker (admin/owner only) */}
            {showOfficePicker && (
              <div className="flex flex-col gap-1.5 min-w-[175px]">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-indigo-500" />
                  Wilayah
                </label>
                <select
                  value={pickedOffice}
                  onChange={(e) => {
                    setPickedOffice(e.target.value);
                    setAdminDefaultOffice(e.target.value === "Semua" ? "" : e.target.value);
                    setSelectedRak("Semua");
                  }}
                  disabled={isLoadingLocations}
                  className="select select-bordered select-sm w-full bg-slate-50 font-semibold"
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

            {/* Rak filter */}
            <div className="flex flex-col gap-1.5 min-w-[110px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <Hash className="h-3 w-3 text-indigo-500" />
                Rak
              </label>
              <select
                value={selectedRak}
                onChange={(e) => setSelectedRak(e.target.value)}
                className="select select-bordered select-sm w-full bg-slate-50 font-semibold"
              >
                <option value="Semua">Semua</option>
                {uniqueRaks.map((rakNo) => (
                  <option key={rakNo} value={rakNo}>
                    Rak {rakNo}
                  </option>
                ))}
              </select>
            </div>

            {/* Date from */}
            <div className="flex flex-col gap-1.5 min-w-[135px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <Calendar className="h-3 w-3 text-indigo-500" />
                Dari
              </label>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || today}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input input-bordered input-sm w-full bg-slate-50 font-semibold"
              />
            </div>

            {/* Date to */}
            <div className="flex flex-col gap-1.5 min-w-[135px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <Calendar className="h-3 w-3 text-indigo-500" />
                Sampai
              </label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                max={today}
                onChange={(e) => setDateTo(e.target.value)}
                className="input input-bordered input-sm w-full bg-slate-50 font-semibold"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          {scansQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
              <span className="loading loading-spinner loading-lg text-indigo-500" />
              <p className="text-sm font-semibold">Memuat riwayat scan...</p>
            </div>
          ) : scansQuery.isError ? (
            <div className="p-10 text-center">
              <div className="text-4xl mb-3">⚠️</div>
              <p className="font-bold text-slate-700">Gagal memuat data</p>
              <p className="text-sm text-slate-400 mt-1 mb-4">Terjadi kesalahan saat mengambil riwayat scan.</p>
              <button
                onClick={() => scansQuery.refetch()}
                className="btn btn-sm btn-outline btn-error"
              >
                Coba lagi
              </button>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Package className="h-8 w-8 text-slate-400" />
              </div>
              <p className="font-bold text-slate-700 text-base">Belum ada riwayat</p>
              <p className="text-sm text-slate-400 mt-1.5">
                {hasActiveFilters
                  ? "Tidak ada data yang cocok dengan filter aktif."
                  : "Scan barang di halaman input untuk melihat data di sini."}
              </p>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="btn btn-sm btn-ghost mt-4 text-indigo-600">
                  Reset filter
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr className="text-slate-500 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 text-[11px] uppercase tracking-wider">
                      <th className="font-bold py-3 pl-5">#</th>
                      <th className="font-bold py-3">Waktu</th>
                      <th className="font-bold py-3">SKU</th>
                      <th className="font-bold py-3 text-center">Rak</th>
                      <th className="font-bold py-3 text-right">Qty Fisik</th>
                      <th className="font-bold py-3">Kantor</th>
                      {showOfficePicker && <th className="font-bold py-3">Operator</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {paginatedLogs.map((row, i) => (
                      <tr
                        key={row.id}
                        className="hover:bg-indigo-50/40 transition-colors group"
                      >
                        <td className="pl-5 pr-2 text-slate-400 text-xs font-mono">
                          {(safePage - 1) * pageSize + i + 1}
                        </td>
                        <td className="text-slate-500 whitespace-nowrap text-xs py-3">
                          {formatDateTime(row.createdat)}
                        </td>
                        <td className="py-3">
                          <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-lg text-xs group-hover:bg-indigo-100 transition-colors">
                            {row.sku}
                          </span>
                        </td>
                        <td className="text-center py-3">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 text-slate-700 font-bold text-xs">
                            {row.rak}
                          </span>
                        </td>
                        <td className="text-right py-3 pr-4">
                          <span className="font-black text-slate-900 text-sm">
                            {row.physicalQty.toLocaleString("id-ID")}
                          </span>
                        </td>
                        <td className="py-3">
                          <span className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                            {row.office ?? "—"}
                          </span>
                        </td>
                        {showOfficePicker && (
                          <td className="py-3">
                            <span className="text-xs font-semibold text-slate-600">
                              {row.username}
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-slate-100 bg-slate-50/50">
                {/* Page size picker */}
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold">Tampilkan</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="select select-bordered select-xs bg-white font-bold w-20"
                  >
                    {PAGE_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span>
                    baris &mdash; menampilkan{" "}
                    <strong className="text-slate-700">
                      {(safePage - 1) * pageSize + 1}–
                      {Math.min(safePage * pageSize, filteredLogs.length)}
                    </strong>{" "}
                    dari <strong className="text-slate-700">{filteredLogs.length}</strong>
                  </span>
                </div>

                {/* Page navigation */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={safePage === 1}
                    className="btn btn-xs btn-ghost btn-square disabled:opacity-30"
                  >
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="btn btn-xs btn-ghost btn-square disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>

                  {/* Page number buttons */}
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, idx) => {
                    let page: number;
                    if (totalPages <= 5) {
                      page = idx + 1;
                    } else if (safePage <= 3) {
                      page = idx + 1;
                    } else if (safePage >= totalPages - 2) {
                      page = totalPages - 4 + idx;
                    } else {
                      page = safePage - 2 + idx;
                    }
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`btn btn-xs btn-square ${
                          page === safePage
                            ? "btn-primary text-white shadow-sm"
                            : "btn-ghost text-slate-600"
                        }`}
                      >
                        {page}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="btn btn-xs btn-ghost btn-square disabled:opacity-30"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={safePage === totalPages}
                    className="btn btn-xs btn-ghost btn-square disabled:opacity-30"
                  >
                    <ChevronsRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </DocsShell>
  );
}
