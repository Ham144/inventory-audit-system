import { useEffect, useMemo, useState } from "react";
import { Link, redirect } from "react-router";
import {
  History,
  ArrowLeft,
  Search,
  MapPin,
  Hash,
  Calendar,
  Package,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DocsShell } from "~/components/DocsShell";
import { useUserInfo } from "~/store";
import { getScans } from "~/api/opname.api";
import locationApi from "~/api/LocationApi";
import {
  compareOfficeScope,
  isOwner,
  userSessionLabel,
} from "~/libs/user-access";
import { normalizeLocationList, type LocationItem } from "~/libs/location";

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

export default function MyLogsPage() {
  const { userInfo } = useUserInfo();
  const showOfficePicker = isOwner(userInfo);
  const [pickedOffice, setPickedOffice] = useState("Semua");
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRak, setSelectedRak] = useState("Semua");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const compareOffice = compareOfficeScope(
    userInfo,
    showOfficePicker ? pickedOffice : undefined,
  );

  const scansQuery = useQuery({
    queryKey: ["my-scans", compareOffice, selectedRak],
    queryFn: () =>
      getScans({
        office: compareOffice,
        rak: selectedRak !== "Semua" ? selectedRak : undefined,
      }),
    enabled: Boolean(userInfo?.username),
  });

  useEffect(() => {
    if (!userInfo?.username) {
      redirect("/login");
    }
  }, [userInfo]);

  useEffect(() => {
    if (!showOfficePicker) return;

    const fetchLocations = async () => {
      setIsLoadingLocations(true);
      try {
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

  const filteredLogs = useMemo(() => {
    const username = userInfo?.username?.trim().toLowerCase();
    if (!username) return [];

    const search = searchTerm.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;

    return (scansQuery.data ?? []).filter((row) => {
      if (row.operator?.trim().toLowerCase() !== username) return false;

      if (search) {
        const haystack = `${row.sku} ${row.name}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      if (fromMs !== null || toMs !== null) {
        const created = new Date(row.createdAt).getTime();
        if (fromMs !== null && created < fromMs) return false;
        if (toMs !== null && created > toMs) return false;
      }

      return true;
    });
  }, [scansQuery.data, userInfo?.username, searchTerm, dateFrom, dateTo]);

  const totalQty = useMemo(
    () => filteredLogs.reduce((sum, row) => sum + (row.qty ?? 0), 0),
    [filteredLogs],
  );

  const today = toDateInputValue(new Date());

  return (
    <DocsShell title="Riwayat Scan" subtitle="My Logs" showDocSidebar={false}>
      <div className="max-w-5xl space-y-6">
        <Link
          to="/input"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Kembali ke input scan
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-slate-100 text-slate-600">
              <History className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">
                Riwayat Scan Saya
              </h1>
              <p className="text-sm text-slate-500">
                {userSessionLabel(userInfo)}
              </p>
            </div>
          </div>

          <div className="flex gap-3 text-sm">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-2">
              <p className="text-[10px] font-bold uppercase text-slate-400">
                Baris
              </p>
              <p className="font-black text-slate-900">{filteredLogs.length}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-2">
              <p className="text-[10px] font-bold uppercase text-slate-400">
                Total Qty
              </p>
              <p className="font-black text-indigo-700">{totalQty}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5 min-w-[200px] flex-1">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Search className="h-3 w-3 text-indigo-500" />
                Cari SKU / Nama
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Ketik SKU atau nama barang..."
                className="input input-bordered input-sm w-full bg-slate-50 font-semibold"
              />
            </div>

            {showOfficePicker && (
              <div className="flex flex-col gap-1.5 min-w-[180px]">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-indigo-500" />
                  Wilayah
                </label>
                <select
                  value={pickedOffice}
                  onChange={(e) => {
                    setPickedOffice(e.target.value);
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
                        <option key={loc.code} value={loc.code}>
                          {loc.name || loc.description || loc.code}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1.5 min-w-[120px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Hash className="h-3 w-3 text-indigo-500" />
                Rak
              </label>
              <select
                value={selectedRak}
                onChange={(e) => setSelectedRak(e.target.value)}
                className="select select-bordered select-sm w-full bg-slate-50 font-semibold"
              >
                <option value="Semua">Semua</option>
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={String(n)}>
                    Rak {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5 min-w-[140px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="h-3 w-3 text-indigo-500" />
                Dari Tanggal
              </label>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || today}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input input-bordered input-sm w-full bg-slate-50 font-semibold"
              />
            </div>

            <div className="flex flex-col gap-1.5 min-w-[140px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="h-3 w-3 text-indigo-500" />
                Sampai Tanggal
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
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {scansQuery.isLoading ? (
            <div className="flex justify-center py-16">
              <span className="loading loading-spinner loading-lg text-indigo-500" />
            </div>
          ) : scansQuery.isError ? (
            <div className="p-8 text-center text-red-600 text-sm">
              Gagal memuat riwayat scan.
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="font-semibold text-slate-700">Belum ada riwayat</p>
              <p className="text-sm text-slate-400 mt-1">
                Scan barang di halaman input untuk melihat data di sini.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr className="text-slate-500 bg-slate-50">
                    <th>Waktu</th>
                    <th>SKU</th>
                    <th>Nama</th>
                    <th className="text-center">Rak</th>
                    <th className="text-right">Qty</th>
                    <th>Office</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="text-slate-600 whitespace-nowrap text-xs">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="font-mono font-semibold text-indigo-700">
                        {row.sku}
                      </td>
                      <td className="text-slate-700 max-w-[200px] truncate">
                        {row.name}
                      </td>
                      <td className="text-center font-semibold">{row.rak}</td>
                      <td className="text-right font-bold text-slate-900">
                        {row.qty ?? 0}
                      </td>
                      <td className="text-slate-600 text-xs">
                        {row.office ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DocsShell>
  );
}
