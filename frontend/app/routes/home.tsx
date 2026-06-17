import React, { useState, useEffect } from "react";
import { Link, redirect, useNavigate } from "react-router";
import {
  ArrowLeft,
  MapPin,
  Search,
  CheckCircle2,
  Hash,
  X,
  FileText,
  AlertCircle,
} from "lucide-react";
import locationApi from "../api/LocationApi";
import ProductApi from "../api/product.api";
import { getUserInfo, logout } from "../api/authApi";
import axiosInstance from "../api/axios-instance";
import { useUserInfo } from "~/store";
import { useQuery } from "@tanstack/react-query";

interface LocationItem {
  code: string;
  name?: string;
  description?: string;
}

interface ProductItem {
  id?: string;
  sku?: string;
  name?: string;
  _id?: string;
  No?: string;
  Description?: string;
  Description_3?: string;
  physicalQty?: number;
  systemQty?: number;
}

function getProductSku(product: ProductItem): string {
  return (product.No || product.sku || "").trim();
}

interface ScanLogItem {
  sku: string;
  rak: number;
  locationCode?: string;
}

const LAST_LOCATION_KEY = "stok-opname-last-location";

function getSavedLocation(): string {
  if (typeof window === "undefined") return "";
  return (
    localStorage.getItem(LAST_LOCATION_KEY) ||
    localStorage.getItem("lastLocation") ||
    ""
  );
}

function saveLocation(locationCode: string) {
  if (typeof window === "undefined" || !locationCode) return;
  localStorage.setItem(LAST_LOCATION_KEY, locationCode);
}

function getRakStorageKey(sku: string, locationCode: string): string {
  return `rak-${sku}-${locationCode}`;
}

function getLastRakFromStorage(sku: string, locationCode: string): number {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(getRakStorageKey(sku, locationCode));
  if (raw === null || raw === "") return 0;
  const lastRak = Number(raw);
  return Number.isFinite(lastRak) && lastRak >= 1 ? lastRak : 0;
}

function getSuggestedNextRak(
  sku: string,
  locationCode: string,
  scans: ScanLogItem[],
): number {
  const lastFromStorage = getLastRakFromStorage(sku, locationCode);
  const maxFromDb =
    scans.length > 0 ? Math.max(...scans.map((s) => Number(s.rak) || 0)) : 0;
  const nextFromStorage = lastFromStorage > 0 ? lastFromStorage + 1 : 1;
  const nextFromDb = maxFromDb > 0 ? maxFromDb + 1 : 1;
  return Math.max(nextFromStorage, nextFromDb);
}

export default function Scan() {
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [selectedLocation, setSelectedLocation] = useState(() =>
    getSavedLocation(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(
    null,
  );
  const { userInfo } = useUserInfo();

  const [qty, setQty] = useState("");
  const [rak, setRak] = useState(1);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const navigate = useNavigate();
  const [operatorName, setOperatorName] = useState(userInfo?.username);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  const selectedSku = selectedProduct ? getProductSku(selectedProduct) : "";

  const skuScansQuery = useQuery({
    queryKey: ["opname", "scans-for-rak", selectedLocation, selectedSku],
    queryFn: async () => {
      const res = await axiosInstance.get<ScanLogItem[]>("/api/opname/scans", {
        params: { locationCode: selectedLocation, rak: "Semua" },
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      return rows.filter((row) => row.sku === selectedSku);
    },
    enabled: Boolean(selectedLocation && selectedSku),
  });

  //initialization
  useEffect(() => {
    setSelectedLocation(getSavedLocation());
  }, [locations?.length]);

  useEffect(() => {
    if (!selectedProduct || !selectedLocation) return;
    const sku = getProductSku(selectedProduct);
    if (!sku) return;

    setRak(
      getSuggestedNextRak(sku, selectedLocation, skuScansQuery.data ?? []),
    );
  }, [selectedProduct, selectedLocation, skuScansQuery.data]);

  // Fetch operator user info on mount
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await getUserInfo();
        const user = res?.data || res;
        const name = user?.username || user?.name || user?.usernameLdap;
        if (name) {
          setOperatorName(name);
        }
      } catch (err) {
        console.error("Gagal mengambil info user:", err);
      }
    };
    fetchUser();
  }, []);

  // Fetch locations on mount
  useEffect(() => {
    const fetchLocations = async () => {
      setIsLoadingLocations(true);
      try {
        const res = await locationApi.getAllLocation("");
        // Support array of locations
        const resolveInitialLocation = (list: LocationItem[]) => {
          const saved = getSavedLocation();
          if (saved && list.some((loc) => loc.code === saved)) {
            return saved;
          }
          return list[0]?.code || "";
        };

        if (Array.isArray(res)) {
          setLocations(res);
          if (res.length > 0) {
            setSelectedLocation(resolveInitialLocation(res));
          }
        } else if (res && Array.isArray(res.data)) {
          setLocations(res.data);
          if (res.data.length > 0) {
            setSelectedLocation(resolveInitialLocation(res.data));
          }
        }
      } catch (err) {
        // Fallback mock locations
        setLocations([]);
      } finally {
        setIsLoadingLocations(false);
      }
    };
    fetchLocations();
  }, []);

  // Search products when query changes
  useEffect(() => {
    if (!searchQuery?.trim()) {
      setProducts([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setIsSearchingProducts(true);
      try {
        const res = await ProductApi.searchProducts(searchQuery, 1, 10);
        if (Array.isArray(res)) {
          setProducts(res);
        } else if (res && Array.isArray(res.data)) {
          setProducts(res.data);
        }
      } catch (err) {
        console.error("Gagal mencari produk:", err);
      } finally {
        setIsSearchingProducts(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  const showToast = (
    message: string,
    type: "success" | "error" | "info" = "success",
  ) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocation) {
      showToast("Pilih wilayah terlebih dahulu!", "error");
      return;
    }
    if (!selectedProduct) {
      showToast("Pilih barang yang ingin di-scan!", "error");
      return;
    }
    if (!rak || isNaN(Number(rak)) || Number(rak) <= 0) {
      showToast("Masukkan nomor rak yang valid (Angka)!", "error");
      return;
    }
    if (!qty || Number(qty) <= 0) {
      showToast("Masukkan Qty fisik yang valid!", "error");
      return;
    }

    // Save to Postgres Database instead of Local Storage
    try {
      const response = await axiosInstance.post("/api/opname/scan", {
        sku: selectedProduct.No || selectedProduct.sku || "",
        name:
          selectedProduct.Description ||
          selectedProduct.Description_3 ||
          selectedProduct.name ||
          "",
        rak: Number(rak),
        qty: Number(qty),
        operator: operatorName,
        locationCode: selectedLocation,
      });

      if (response.data) {
        showToast("Data scan berhasil disimpan ke database pusat!", "success");

        // Reset form fields except location
        setSelectedProduct(null);
        setSearchQuery("");
        setQty("");
        const sku = getProductSku(selectedProduct);
        if (typeof window !== "undefined") {
          localStorage.setItem(
            getRakStorageKey(sku, selectedLocation),
            String(Number(rak)),
          );
          saveLocation(selectedLocation);
        }
      }
    } catch (err) {
      showToast("Gagal menyimpan data scan ke server", "error");
    }
  };

  useEffect(() => {
    if (!userInfo?.username) {
      redirect("/login");
    }
  }, [userInfo]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans relative selection:bg-indigo-100">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-size-[4rem_4rem] mask-[radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-30 z-0" />

      {/* Header */}
      <header className="relative z-10 border-b border-slate-200/80 bg-white/80 backdrop-blur-md px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            to="/admin"
            className="p-2 hover:bg-slate-100 rounded-xl transition-all duration-200 text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-base font-bold text-slate-900">
              Input Hasil Scan
            </h1>
            <p className="text-[10px] text-slate-500 font-medium">
              Rekonsiliasi data fisik lapangan
            </p>
          </div>
        </div>
        <span className="text-[10px] px-3 py-1 rounded-full bg-red-50 border border-red-100 text-indigo-600 font-bold cursor-pointer">
          <button
            className="  text-red-600 hover:text-red-800 cursor-pointer"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            Logout
          </button>
        </span>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 max-w-lg w-full mx-auto px-4 py-8">
        {toast && (
          <div
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold animate-in fade-in duration-200 ${
              toast.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : toast.type === "error"
                  ? "bg-rose-50 border-rose-200 text-rose-800"
                  : "bg-indigo-50 border-indigo-200 text-indigo-800"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-600" />
            )}
            {toast.message}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <h2 className="text-sm font-extrabold tracking-wide text-slate-900 mb-6 uppercase flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-500" />
            Formulir Input Barang
          </h2>

          <form onSubmit={handleSaveScan} className="space-y-6">
            {/* Dropdown Wilayah */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Pilih Wilayah / Lokasi
              </label>
              <div className="relative">
                <MapPin className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                <select
                  value={selectedLocation}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedLocation(value);
                    if (value) saveLocation(value);
                  }}
                  disabled={isLoadingLocations}
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 text-xs font-bold text-slate-800 rounded-2xl pl-10 pr-4 py-3.5 appearance-none cursor-pointer outline-none transition-all duration-150"
                >
                  {isLoadingLocations ? (
                    <option>Memuat wilayah...</option>
                  ) : (
                    <>
                      <option key={null} value="">
                        Pilih Location Dulu
                      </option>
                      {locations.map((loc) => (
                        <option key={loc.code} value={loc.code}>
                          {loc.name || loc.description || loc.code}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none border-l border-slate-200 pl-2">
                  <div className="border-4 border-transparent border-t-slate-400 w-0 h-0" />
                </div>
              </div>
            </div>

            {/* Input Cari Data */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Cari Data (SKU / Nama Barang)
              </label>
              <div className="relative flex items-center">
                <Search className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Masukkan SKU atau Nama barang..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (selectedProduct) setSelectedProduct(null);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 text-xs font-semibold text-slate-800 rounded-2xl pl-10 pr-12 py-3.5 outline-none transition-all duration-150"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedProduct(null);
                      setProducts([]);
                    }}
                    className="absolute right-3.5 p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-all duration-150"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Product search suggestions dropdown */}
              {searchQuery && !selectedProduct && (
                <div className="border border-slate-200 rounded-2xl bg-white shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-100 z-20 relative">
                  {isSearchingProducts ? (
                    <div className="p-4 text-center text-xs text-slate-400 font-medium">
                      Mencari barang...
                    </div>
                  ) : products.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400 font-medium">
                      Barang tidak ditemukan
                    </div>
                  ) : (
                    products.map((p) => (
                      <button
                        key={p._id || p.No || p.id || p.sku}
                        type="button"
                        onClick={() => {
                          setSelectedProduct(p);
                          setSearchQuery(
                            p.Description || p.Description_3 || p.name || "",
                          );
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between text-xs"
                      >
                        <div className="pr-4">
                          <p className="font-bold text-slate-800 line-clamp-1">
                            {p.Description || p.Description_3 || p.name}
                          </p>
                          <span className="text-[10px] font-mono text-slate-500 font-medium">
                            SKU: {p.No || p.sku}
                          </span>
                        </div>
                        <Hash className="h-3.5 w-3.5 text-indigo-500 shrink-0 opacity-60" />
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Selected product banner */}
              {selectedProduct && (
                <div className="p-3 rounded-2xl bg-indigo-50/50 border border-indigo-150/80 flex items-center justify-between">
                  <div className="text-xs">
                    <p className="font-extrabold text-indigo-950 line-clamp-1">
                      {selectedProduct.Description ||
                        selectedProduct.Description_3 ||
                        selectedProduct.name}
                    </p>
                    <p className="text-[10px] font-mono text-indigo-600 font-bold mt-0.5">
                      SKU: {selectedProduct.No || selectedProduct.sku}
                    </p>
                  </div>
                  <span className="text-[9px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold border border-indigo-200">
                    Terpilih
                  </span>
                </div>
              )}
            </div>

            {/* Input RAK */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Nomor Rak (Lokasi Penyimpanan)
              </label>
              {selectedProduct && selectedLocation && (
                <p className="text-[10px] text-indigo-600 font-semibold">
                  Rak disarankan untuk SKU &amp; wilayah ini:{" "}
                  <span className="font-black">{rak}</span>
                  {getLastRakFromStorage(
                    getProductSku(selectedProduct),
                    selectedLocation,
                  ) > 0 && (
                    <span className="text-slate-500 font-medium">
                      {" "}
                      (terakhir: rak{" "}
                      {getLastRakFromStorage(
                        getProductSku(selectedProduct),
                        selectedLocation,
                      )}
                      )
                    </span>
                  )}
                </p>
              )}
              <div className="relative flex items-center">
                <MapPin className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="number"
                  placeholder="Masukkan Nomor Rak (contoh: 1, 2, 3)..."
                  value={rak}
                  onChange={(e) => setRak(Number(e.target.value))}
                  min={1}
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 text-xs font-semibold text-slate-800 rounded-2xl pl-10 pr-12 py-3.5 outline-none transition-all duration-150"
                />
                {rak && (
                  <button
                    type="button"
                    onClick={() => setRak(1)}
                    className="absolute right-3.5 p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-all duration-150"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Input QTY */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                QTY Fisik Lapangan (Jumlah)
              </label>
              <div className="relative flex items-center">
                <Hash className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="number"
                  placeholder="Masukkan QTY..."
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  min="1"
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 text-xs font-semibold text-slate-800 rounded-2xl pl-10 pr-12 py-3.5 outline-none transition-all duration-150"
                />
                {qty && (
                  <button
                    type="button"
                    onClick={() => setQty("")}
                    className="absolute right-3.5 p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-all duration-150"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Buttons */}
            <div className="pt-2 flex gap-3">
              <button
                onClick={() => {
                  setSelectedProduct(null);
                  setSearchQuery("");
                  setQty("");
                  setRak(1);
                }}
                className="flex-1 text-center py-3.5 border border-slate-200 hover:border-slate-300 bg-white text-slate-600 hover:text-slate-800 text-xs font-bold rounded-2xl transition-all duration-150 active:scale-98"
              >
                Clear Form
              </button>
              <button
                type="submit"
                className="flex-2 py-3.5 bg-linear-to-r from-indigo-500 to-indigo-650 hover:from-indigo-450 hover:to-indigo-600 text-white text-xs font-bold rounded-2xl shadow-lg shadow-indigo-500/10 transition-all duration-150 active:scale-98"
              >
                Simpan Hasil Scan
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
