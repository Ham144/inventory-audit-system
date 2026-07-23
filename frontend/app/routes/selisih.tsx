import { useEffect, useMemo, useState, useRef } from "react";
import { Link, redirect, useNavigate } from "react-router";
import {
  AlertCircle,
  ArrowLeft,
  Search,
  MapPin,
  Package,
  Layers,
  Calendar,
  PenLine,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DocsShell } from "~/components/DocsShell";
import { useUserInfo } from "~/store";
import { CompareApi } from "~/api/compare.api";
import { getScans } from "~/api/opname.api";
import locationApi from "~/api/LocationApi";
import {
  compareOfficeScope,
  adminCanPickOffice,
  userOffice,
} from "~/libs/user-access";
import {
  normalizeLocationList,
  resolveInitialPickedOffice,
  resolvePickedOffice,
  fetchAndCacheMappings,
  type LocationItem,
} from "~/libs/location";
import { getAdminDefaultOffice, setAdminDefaultOffice } from "~/libs/app-prefs";

function toDateInputValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function SelisihPage() {
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
  const navigate = useNavigate();

  const compareOffice = compareOfficeScope(
    userInfo,
    showOfficePicker ? pickedOffice : undefined,
  );

  const navQuery = useQuery({
    queryKey: ["compare", "nav", compareOffice, selectedRak, dateFrom, dateTo],
    queryFn: () => CompareApi.fetchNavCompareList({ 
      office: compareOffice,
      rak: selectedRak !== "Semua" ? selectedRak : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    enabled: Boolean(userInfo?.username),
  });

  useEffect(() => {
    if (userInfo === null) {
      navigate("/login", { replace: true });
    }
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
    if (resolved !== pickedOffice) {
      setPickedOffice(resolved);
    }
  }, [showOfficePicker, locations, pickedOffice]);

  const scansQuery = useQuery({
    queryKey: ["my-scans", compareOffice],
    queryFn: () => getScans({ office: compareOffice }),
    enabled: Boolean(userInfo?.username),
  });

  const uniqueRaks = useMemo(() => {
    const data = scansQuery.data ?? [];
    const raks = data.map((row: any) => String(row.rak));
    return Array.from(new Set(raks)).sort((a, b) => Number(a) - Number(b));
  }, [scansQuery.data]);

  const filteredLogs = useMemo(() => {
    if (!userInfo?.username) return [];
    const search = searchTerm.trim().toLowerCase();

    return (navQuery.data ?? []).filter((row) => {
      // ONLY SHOW DISCREPANCIES!
      const statusLower = (row.status || "").toLowerCase();
      if (statusLower !== "selisih") return false;
      if (row.physicalQty === row.systemQty) return false;
      if (row.pendingRakCount > 0) return false;

      if (search) {
        const haystack = `${row.sku} ${row.name}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  }, [navQuery.data, userInfo?.username, searchTerm]);

  if (userInfo === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <span className="loading loading-spinner loading-lg text-indigo-500" />
      </div>
    );
  }

  const today = toDateInputValue(new Date());

  return (
    <DocsShell
      title="Daftar Selisih"
      subtitle="Cek Ulang"
      showDocSidebar={false}
    >
      <div className="max-w-6xl space-y-6">
        <Link
          to="/input"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Kembali ke input scan
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-red-100 text-red-600">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">
                Daftar Selisih (Cek Ulang)
              </h1>
              <p className="text-sm text-slate-500">
                SKU berikut tidak sesuai dengan stok sistem (NAV).
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

            <div className="flex flex-col gap-1.5 min-w-[120px]">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="h-3 w-3 text-indigo-500" />
                No Rak
              </label>
              <select
                value={selectedRak}
                onChange={(e) => setSelectedRak(e.target.value)}
                className="select select-bordered select-sm w-full bg-slate-50 font-semibold"
              >
                <option value="Semua">Semua Rak</option>
                {uniqueRaks.map((r) => (
                  <option key={r} value={String(r)}>
                    Rak {r}
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

            {showOfficePicker && (
              <div className="flex flex-col gap-1.5 min-w-[180px]">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-indigo-500" />
                  Wilayah
                </label>
                <select
                  value={pickedOffice}
                  onChange={(e) => {
                    const value = e.target.value;
                    setPickedOffice(value);
                    setAdminDefaultOffice(value === "Semua" ? "" : value);
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
          </div>
        </div>

        {/* Table */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {navQuery.isLoading ? (
            <div className="flex justify-center py-16">
              <span className="loading loading-spinner loading-lg text-indigo-500" />
            </div>
          ) : navQuery.isError ? (
            <div className="p-8 text-center text-red-600 text-sm">
              Gagal memuat data selisih.
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="h-10 w-10 text-emerald-300 mx-auto mb-3" />
              <p className="font-semibold text-emerald-700">Tidak ada selisih</p>
              <p className="text-sm text-slate-400 mt-1">
                Wah, sepertinya belum ada atau tidak ada lagi SKU yang selisih.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr className="text-slate-500 bg-slate-50">
                    <th>SKU</th>
                    <th>Nama</th>
                    <th className="text-right">Total Fisik (Scan)</th>
                    <th>Status</th>
                    <th>Office</th>
                    <th className="text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80 group">
                      <td className="font-mono font-semibold text-indigo-700">
                        {row.sku}
                      </td>
                      <td className="text-slate-700 max-w-[200px] truncate">
                        {row.name}
                      </td>
                      <td className="text-right font-black text-slate-900">
                        {row.physicalQty ?? 0}
                      </td>
                      <td className="text-xs">
                        <span className="bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded border border-red-200">
                          SELISIH
                        </span>
                      </td>
                      <td className="text-slate-600 text-xs">
                        {row.office ?? "—"}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => navigate(`/input?sku=${row.sku}`)}
                          className="btn btn-xs btn-primary bg-indigo-600 hover:bg-indigo-700 border-none rounded-lg text-[10px] font-bold opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                        >
                          <PenLine className="h-3 w-3" />
                          Input
                        </button>
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
