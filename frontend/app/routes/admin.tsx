import { useState, useMemo, useEffect, useRef } from "react";
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  SlidersHorizontal,
  Boxes,
  Database,
  Sparkles,
  AlertCircle,
  MapPin,
  ChevronDown,
  ChevronRight,
  RefreshCcw,
  RotateCcw,
  X,
  Calendar,
  Download,
  StickyNote,
  Pencil,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router";
import axiosInstance from "../api/axios-instance";
import locationApi from "../api/LocationApi";
import { useUserInfo } from "../store";
import {
  canAccessAdmin,
  compareOfficeScope,
  adminCanPickOffice,
  isAdmin,
  userOffice,
  userSessionLabel,
} from "~/libs/user-access";
import { getAdminDefaultOffice, setAdminDefaultOffice } from "~/libs/app-prefs";
import {
  normalizeLocationList,
  resolveInitialPickedOffice,
  resolvePickedOffice,
  fetchAndCacheMappings,
  canonicalizeLocationList,
  toCanonicalOfficeName,
  type LocationItem,
} from "~/libs/location";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { listUnresolvedSkus } from "~/api/skuReminder.api";
import {
  CompareApi,
  type CompareQueryParams,
  type NavCompareRow,
  type ScanCompareRow,
} from "~/api/compare.api";
import { AppNavigation } from "~/components/AppNavigation";
import { UserSessionBadge } from "~/components/UserSessionBadge";
import {
  buildBulkCompareCsv,
  downloadCsv,
  formatRakNames,
  type BulkCompareResultRow,
} from "~/libs/compare-csv";
import type { AxiosError } from "axios";

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function defaultDateTo(): string {
  return new Date().toISOString().split("T")[0];
}

function extractApiError(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ error?: string; message?: string }>;
  const apiMsg =
    axiosErr.response?.data?.error ?? axiosErr.response?.data?.message;
  if (typeof apiMsg === "string" && apiMsg.trim()) return apiMsg;
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

function resolveDateRangeError(
  dateFrom: string,
  dateTo: string,
): string | null {
  if (!dateFrom || !dateTo) {
    return "Tanggal dari dan sampai wajib diisi";
  }
  if (dateFrom > dateTo) {
    return "Tanggal dari tidak boleh lebih besar dari tanggal sampai";
  }
  return null;
}

// ==========================================
// Types & Interfaces
// ==========================================
interface ScanLog {
  id: string;
  rak: number;
  sku: string;
  name: string;
  qty?: number;
  office?: string;
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
  office: string;
  updatedAt: string;
  resolvedRakCount: number;
  pendingRakCount: number;
  note: string | null;
  finalCorrectionQty?: number | null;
  finalCorrectionBy?: string | null;
  finalCorrectionAt?: string | null;
  finalCorrectionRak?: number | null;
  delegatedTo?: string | null;
  delegatedBy?: string | null;
  delegatedAt?: string | null;
}

type NavStatusFilter =
  "all" | "pending_rak" | "selisih" | "sesuai" | "belum_compare";

type SortBy = "default" | "name_asc" | "selisih_desc" | "pending_desc";

const NAV_STATUS_FILTERS: { value: NavStatusFilter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "pending_rak", label: "Pending Rak" },
  { value: "selisih", label: "Selisih" },
  { value: "sesuai", label: "Sesuai" },
  { value: "belum_compare", label: "Belum Compare" },
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "name_asc", label: "Nama A-Z" },
  { value: "selisih_desc", label: "Selisih terbesar" },
  { value: "pending_desc", label: "Pending terbanyak" },
];

function normalizeNavStatus(status: string): ProductCompare["status"] {
  const s = status.toLowerCase();
  if (s === "sesuai" || s === "selisih" || s === "belum_compare") {
    return s;
  }
  return "belum_compare";
}

function mapNavCompareItem(raw: NavCompareRow): ProductCompare {
  return {
    id: raw.id,
    sku: raw.sku,
    name: raw.name,
    physicalQty: raw.physicalQty,
    systemQty: raw.systemQty,
    status: normalizeNavStatus(raw.status),
    office: raw.office,
    updatedAt: raw.updatedAt,
    resolvedRakCount: raw.resolvedRakCount,
    pendingRakCount: raw.pendingRakCount,
    note: raw.note ?? null,
    finalCorrectionQty: raw.finalCorrectionQty ?? null,
    finalCorrectionBy: raw.finalCorrectionBy ?? null,
    finalCorrectionAt: raw.finalCorrectionAt ?? null,
    finalCorrectionRak: raw.finalCorrectionRak ?? null,
    delegatedTo: raw.delegatedTo ?? null,
    delegatedBy: raw.delegatedBy ?? null,
    delegatedAt: raw.delegatedAt ?? null,
  };
}

function skuLocationKey(sku: string, office: string) {
  return `${sku}|${office}`;
}

function navDelta(nav: ProductCompare): number | null {
  if (nav.status === "belum_compare") return null;
  return nav.physicalQty - nav.systemQty;
}

function applyNavStatusFilter(
  rows: ProductCompare[],
  filter: NavStatusFilter,
): ProductCompare[] {
  if (filter === "all") return rows;
  if (filter === "pending_rak") {
    return rows.filter((r) => r.pendingRakCount > 0);
  }
  return rows.filter((r) => r.status === filter);
}

function sortNavRows(rows: ProductCompare[], sortBy: SortBy): ProductCompare[] {
  const sorted = [...rows];
  switch (sortBy) {
    case "name_asc":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "selisih_desc":
      return sorted.sort((a, b) => {
        const da = Math.abs(navDelta(a) ?? 0);
        const db = Math.abs(navDelta(b) ?? 0);
        return db - da;
      });
    case "pending_desc":
      return sorted.sort((a, b) => b.pendingRakCount - a.pendingRakCount);
    default:
      return sorted;
  }
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className="badge badge-ghost badge-sm font-bold text-slate-400">
        —
      </span>
    );
  }
  if (delta === 0) {
    return <span className="badge badge-success badge-sm font-bold">0</span>;
  }
  return (
    <span className="badge badge-warning badge-sm font-bold">
      {delta >= 0 ? "+" : ""}
      {delta}
    </span>
  );
}

function RakProgressBadge({
  resolved,
  pending,
}: {
  resolved: number;
  pending: number;
}) {
  const total = resolved + pending;
  if (total === 0) {
    return (
      <span className="badge badge-ghost badge-sm font-bold text-slate-400">
        —
      </span>
    );
  }
  return (
    <span
      className={`badge badge-sm font-bold ${
        pending > 0 ? "badge-warning" : "badge-success"
      }`}
    >
      {resolved}/{total}
    </span>
  );
}

function NavTableSkeleton() {
  return (
    <>
      {/* Mobile skeleton */}
      <div className="lg:hidden space-y-3 p-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`mobile-${i}`}
            className="rounded-2xl border border-slate-200 p-4 space-y-3"
          >
            <div className="flex gap-2">
              <div className="skeleton h-4 w-4 shrink-0 rounded" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-2 w-2/3 rounded" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="skeleton h-10 rounded-lg" />
              <div className="skeleton h-10 rounded-lg" />
              <div className="skeleton h-10 rounded-lg" />
            </div>
            <div className="skeleton h-8 w-full rounded-lg" />
          </div>
        ))}
      </div>

      {/* Desktop skeleton */}
      <div className="hidden lg:contents">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-12 py-3 px-4 items-center gap-2 border-b border-slate-100"
          >
            <div className="col-span-3 flex gap-2">
              <div className="skeleton h-4 w-4 shrink-0 rounded" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-2 w-2/3 rounded" />
              </div>
            </div>
            <div className="col-span-2 pl-3">
              <div className="skeleton h-4 w-10 rounded" />
            </div>
            <div className="col-span-1 pl-3">
              <div className="skeleton h-4 w-8 rounded" />
            </div>
            <div className="col-span-1 pl-3">
              <div className="skeleton h-5 w-8 rounded-full" />
            </div>
            <div className="col-span-2 pl-3">
              <div className="skeleton h-5 w-12 rounded-full" />
            </div>
            <div className="col-span-2 pl-3">
              <div className="skeleton h-5 w-20 rounded-full" />
            </div>
            <div className="col-span-1 pl-3">
              <div className="skeleton h-6 w-10 rounded" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function navRowAccentClass(nav: ProductCompare) {
  if (nav.pendingRakCount > 0) {
    return "border-l-amber-500 bg-amber-50/10";
  }
  if (nav.status === "selisih") {
    return "border-l-red-400 bg-red-50/10";
  }
  if (nav.status === "sesuai") {
    return "border-l-emerald-500 bg-emerald-50/10";
  }
  return "border-l-slate-300";
}

function NavRowExpandedPanel({
  rakDetails,
  onApprove,
  isApproving,
  approvingScanId,
  onUpdateQty,
  onDeleteScan,
  isMutatingScan,
  mutatingScanId,
  compact = false,
  isNavSesuai = false,
  onFinalCorrectionRak,
  onDeleteFinalCorrection,
  isFinalCorrecting,
  isDeletingFinalCorrection,
  finalCorrectionRak,
}: {
  rakDetails: ScanCompareRow[];
  onApprove: (scanLogId: string) => void;
  isApproving: boolean;
  approvingScanId?: string;
  onUpdateQty: (scanLogId: string, qty: number) => void;
  onDeleteScan: (scanLogId: string) => void;
  isMutatingScan: boolean;
  mutatingScanId?: string;
  compact?: boolean;
  isNavSesuai?: boolean;
  onFinalCorrectionRak: (rak: number, physicalQty: number) => void;
  onDeleteFinalCorrection: () => void;
  isFinalCorrecting: boolean;
  isDeletingFinalCorrection: boolean;
  finalCorrectionRak?: number | null;
}) {
  return (
    <div
      className={`px-3 sm:px-4 pb-4 pt-1 bg-slate-50/60 border-t border-slate-100 ${compact ? "" : "lg:px-4"}`}
    >
      <p
        className={`text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-3 ${compact ? "pl-0" : "pl-0 lg:pl-6"}`}
      >
        Rincian Penetapan per Rak
      </p>
      {rakDetails.length === 0 ? (
        <p className={`text-xs text-slate-400 ${compact ? "" : "lg:pl-6"}`}>
          Belum ada scan untuk SKU ini di lokasi ini.
        </p>
      ) : (
        <div
          className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 ${compact ? "" : "lg:pl-6"}`}
        >
          {rakDetails.map((rakRow) => (
            <RakDetailRow
              key={`${rakRow.sku}-${rakRow.rak}-${rakRow.office}`}
              item={rakRow}
              onApprove={onApprove}
              isApproving={isApproving}
              approvingScanId={approvingScanId}
              onUpdateQty={onUpdateQty}
              onDeleteScan={onDeleteScan}
              isMutatingScan={isMutatingScan}
              mutatingScanId={mutatingScanId}
              isNavSesuai={isNavSesuai}
              onFinalCorrectionRak={onFinalCorrectionRak}
              onDeleteFinalCorrection={onDeleteFinalCorrection}
              isFinalCorrecting={isFinalCorrecting}
              isDeletingFinalCorrection={isDeletingFinalCorrection}
              isCurrentFinalCorrectionRak={finalCorrectionRak === rakRow.rak}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NavNoteButton({
  sku,
  note,
  isSaving,
  onSave,
  showLabel = false,
}: {
  sku: string;
  note: string | null;
  isSaving: boolean;
  onSave: (note: string) => void;
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? "");

  const openModal = () => {
    setDraft(note ?? "");
    setOpen(true);
  };

  const hasNote = Boolean(note?.trim());

  return (
    <>
      <button
        type="button"
        className={`btn btn-xs btn-ghost shrink-0 gap-1 ${hasNote ? "text-amber-600" : "text-slate-500"}`}
        onClick={openModal}
        title={hasNote ? note! : "Tambah catatan"}
        aria-label="Catatan"
      >
        <StickyNote
          className={`h-3.5 w-3.5 ${hasNote ? "fill-amber-100" : ""}`}
        />
        {showLabel && (
          <span className="text-[10px] font-bold">
            {hasNote ? "Catatan" : "Note"}
          </span>
        )}
      </button>
      {open && (
        <dialog className="modal modal-open z-50">
          <div className="modal-box max-w-sm bg-white">
            <h3 className="font-bold text-sm text-slate-800">Catatan</h3>
            <p className="text-[10px] font-mono text-slate-500 mt-0.5">{sku}</p>
            <textarea
              className="textarea textarea-bordered w-full mt-3 text-sm min-h-25 bg-white text-slate-800 border-slate-200"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Tulis catatan untuk barang ini..."
              maxLength={500}
            />
            <div className="modal-action mt-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setOpen(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={isSaving}
                onClick={() => {
                  onSave(draft);
                  setOpen(false);
                }}
              >
                {isSaving ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Tutup"
            onClick={() => setOpen(false)}
          />
        </dialog>
      )}
    </>
  );
}

function NavCompareItem({
  nav,
  rakDetails,
  isExpanded,
  onToggleExpand,
  onCompareNav,
  isComparePending,
  onSaveNote,
  isSavingNote,
  onApprove,
  isApproving,
  approvingScanId,
  onUpdateQty,
  onDeleteScan,
  isMutatingScan,
  mutatingScanId,
  onFinalCorrection,
  isFinalCorrecting,
  onFinalCorrectionRak,
  onDeleteFinalCorrection,
  isDeletingFinalCorrection,
  periodAllowsNavCompare = true,
}: {
  nav: ProductCompare;
  rakDetails: ScanCompareRow[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onCompareNav: () => void;
  isComparePending: boolean;
  onSaveNote: (note: string) => void;
  isSavingNote: boolean;
  onApprove: (scanLogId: string) => void;
  isApproving: boolean;
  approvingScanId?: string;
  onUpdateQty: (scanLogId: string, qty: number) => void;
  onDeleteScan: (scanLogId: string) => void;
  isMutatingScan: boolean;
  mutatingScanId?: string;
  onFinalCorrection: (physicalQty: number) => void;
  isFinalCorrecting: boolean;
  onFinalCorrectionRak: (rak: number, physicalQty: number) => void;
  onDeleteFinalCorrection: () => void;
  isDeletingFinalCorrection: boolean;
  periodAllowsNavCompare?: boolean;
}) {
  const delta = navDelta(nav);
  const canCompareNav =
    periodAllowsNavCompare &&
    (nav.pendingRakCount === 0 || nav.finalCorrectionQty !== null);
  const accent = navRowAccentClass(nav);
  const compareBlockedTitle = !periodAllowsNavCompare
    ? "Gudang masih mode Free — tekan Buka periode di Cek Selisih untuk ambil source of truth dulu"
    : nav.status === "sesuai"
      ? "Sudah sesuai dengan snapshot periode"
      : !canCompareNav
        ? "Selesaikan penetapan semua rak terlebih dahulu"
        : "Bandingkan fisik vs systemQty hasil Buka periode";

  return (
    <div className="bg-white">
      {/* Mobile card */}
      <div className={`lg:hidden border-l-4 ${accent} p-4 space-y-3`}>
        <div className="flex items-start gap-2">
          <button
            type="button"
            className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
            onClick={onToggleExpand}
            aria-label={isExpanded ? "Tutup rincian" : "Buka rincian"}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 text-sm leading-snug">
              {nav.name}
            </p>
            <p className="text-xs font-mono text-slate-600 mt-0.5">{nav.sku}</p>
            <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded-md border border-slate-200 font-mono mt-1.5 inline-block">
              {nav.office}
            </span>
            {nav.delegatedTo?.trim() && (
              <span
                className="text-[10px] font-bold text-sky-800 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200 mt-1.5 ml-1.5 inline-block"
                title={
                  nav.delegatedBy
                    ? `Didelegasikan oleh ${nav.delegatedBy}`
                    : "SKU didelegasikan untuk hitungan ulang (step 2)"
                }
              >
                Delegasi → {nav.delegatedTo}
              </span>
            )}
            {nav.note?.trim() && (
              <p
                className="text-xs text-amber-800 mt-1.5 line-clamp-2 leading-snug"
                title={nav.note}
              >
                {nav.note}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-2 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Fisik
            </p>
            <p className="text-base font-bold text-slate-900 tabular-nums">
              {nav.physicalQty}
            </p>
            {nav.pendingRakCount > 0 && nav.finalCorrectionQty === null && (
              <p className="text-[10px] text-amber-700 font-semibold mt-0.5">
                belum lengkap
              </p>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-2 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Initial SOT
            </p>
            <p className="text-base font-bold text-slate-900 tabular-nums">
              {nav.systemQty}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-2 py-2.5 flex flex-col items-center justify-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Selisih
            </p>
            <DeltaBadge delta={delta} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Rak
            </span>
            <RakProgressBadge
              resolved={nav.resolvedRakCount}
              pending={nav.pendingRakCount}
            />
          </div>
          <NavStatusBadge nav={nav} />
        </div>

        <div className="flex gap-2">
          <NavNoteButton
            sku={nav.sku}
            note={nav.note}
            isSaving={isSavingNote}
            onSave={onSaveNote}
            showLabel
          />
          <button
            type="button"
            className="btn btn-sm btn-outline btn-primary flex-1"
            disabled={
              !canCompareNav || isComparePending || nav.status === "sesuai"
            }
            title={compareBlockedTitle}
            onClick={onCompareNav}
          >
            {isComparePending ? "Memproses..." : "Cek Selisih Periode"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline border-violet-300 text-violet-700 hover:bg-violet-50"
            disabled={isFinalCorrecting}
            onClick={() => {
              const input = prompt(
                `Koreksi akhir untuk ${nav.sku} (${nav.name}).\nMasukkan angka total fisik akhir (tanpa logika rak):`,
                String(nav.physicalQty),
              );
              if (input === null) return;
              const qty = Number(input);
              if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
                alert("Masukkan angka bulat non-negatif.");
                return;
              }
              onFinalCorrection(qty);
            }}
            title="Koreksi akhir: tetapkan total fisik tanpa logika rak"
          >
            {isFinalCorrecting ? "..." : "Koreksi Akhir"}
          </button>
        </div>
      </div>

      {/* Desktop row */}
      <div
        className={`hidden lg:grid grid-cols-12 py-3.5 px-4 items-center text-xs border-l-4 transition-colors hover:bg-slate-50 ${accent}`}
      >
        <div className="col-span-3 pr-2 flex items-start gap-2">
          <button
            type="button"
            className="mt-0.5 shrink-0 text-slate-500 hover:text-slate-700 transition-colors"
            onClick={onToggleExpand}
            aria-label={isExpanded ? "Tutup rincian" : "Buka rincian"}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 text-sm line-clamp-1">
              {nav.name}
            </p>
            <p className="text-xs font-mono text-slate-600 mt-0.5">{nav.sku}</p>
            <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded-md border border-slate-200 font-mono mt-1 inline-block">
              {nav.office}
            </span>
            {nav.delegatedTo?.trim() && (
              <span
                className="text-[10px] font-bold text-sky-800 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200 mt-1 ml-1.5 inline-block"
                title={
                  nav.delegatedBy
                    ? `Didelegasikan oleh ${nav.delegatedBy}`
                    : "SKU didelegasikan untuk hitungan ulang (step 2)"
                }
              >
                Delegasi → {nav.delegatedTo}
              </span>
            )}
            {nav.note?.trim() && (
              <p
                className="text-xs text-amber-800 mt-1 line-clamp-1"
                title={nav.note}
              >
                {nav.note}
              </p>
            )}
          </div>
        </div>
        <div className="col-span-2 border-l border-slate-200 pl-3">
          <span className="font-bold text-slate-900 text-sm tabular-nums">
            {nav.physicalQty}
          </span>
          {nav.pendingRakCount > 0 && nav.finalCorrectionQty === null && (
            <p className="text-[11px] text-amber-700 font-semibold mt-0.5">
              belum lengkap
            </p>
          )}
        </div>
        <div className="col-span-1 border-l border-slate-200 pl-3 font-bold text-slate-900 text-sm tabular-nums">
          {nav.systemQty}
        </div>
        <div className="col-span-1 border-l border-slate-200 pl-3">
          <DeltaBadge delta={delta} />
        </div>
        <div className="col-span-2 border-l border-slate-200 pl-3">
          <RakProgressBadge
            resolved={nav.resolvedRakCount}
            pending={nav.pendingRakCount}
          />
        </div>
        <div className="col-span-1 border-l border-slate-200 pl-3">
          <NavStatusBadge nav={nav} />
        </div>
        <div className="col-span-1 border-l border-slate-200 pl-3">
          <NavNoteButton
            sku={nav.sku}
            note={nav.note}
            isSaving={isSavingNote}
            onSave={onSaveNote}
            showLabel
          />
        </div>
        <div className="col-span-1 border-l border-slate-200 pl-3 flex flex-col gap-1">
          <button
            type="button"
            className="btn btn-sm h-8 min-h-8 btn-outline btn-primary w-full text-[11px]"
            disabled={
              !canCompareNav || isComparePending || nav.status === "sesuai"
            }
            title={compareBlockedTitle}
            onClick={onCompareNav}
          >
            {isComparePending ? "..." : "Cek Selisih"}
          </button>
        </div>
      </div>

      {isExpanded && (
        <NavRowExpandedPanel
          rakDetails={rakDetails}
          onApprove={onApprove}
          isApproving={isApproving}
          approvingScanId={approvingScanId}
          onUpdateQty={onUpdateQty}
          onDeleteScan={onDeleteScan}
          isMutatingScan={isMutatingScan}
          mutatingScanId={mutatingScanId}
          compact
          isNavSesuai={nav.status === "sesuai"}
          onFinalCorrectionRak={onFinalCorrectionRak}
          onDeleteFinalCorrection={onDeleteFinalCorrection}
          isFinalCorrecting={isFinalCorrecting}
          isDeletingFinalCorrection={isDeletingFinalCorrection}
          finalCorrectionRak={nav.finalCorrectionRak}
        />
      )}
    </div>
  );
}

function RakDetailRow({
  item,
  onApprove,
  isApproving,
  approvingScanId,
  onUpdateQty,
  onDeleteScan,
  isMutatingScan,
  mutatingScanId,
  isNavSesuai = false,
  onFinalCorrectionRak,
  onDeleteFinalCorrection,
  isFinalCorrecting,
  isDeletingFinalCorrection,
  isCurrentFinalCorrectionRak = false,
}: {
  item: ScanCompareRow;
  onApprove: (scanLogId: string) => void;
  isApproving: boolean;
  approvingScanId?: string;
  onUpdateQty: (scanLogId: string, qty: number) => void;
  onDeleteScan: (scanLogId: string) => void;
  isMutatingScan: boolean;
  mutatingScanId?: string;
  isNavSesuai?: boolean;
  onFinalCorrectionRak: (rak: number, physicalQty: number) => void;
  onDeleteFinalCorrection: () => void;
  isFinalCorrecting: boolean;
  isDeletingFinalCorrection: boolean;
  isCurrentFinalCorrectionRak?: boolean;
}) {
  const [editingScan, setEditingScan] = useState<{
    id: string;
    operator: string;
    qty: number;
  } | null>(null);
  const [draftQty, setDraftQty] = useState("");

  const openEdit = (scan: { id: string; operator: string; qty: number }) => {
    setEditingScan(scan);
    setDraftQty(String(scan.qty));
  };

  const submitEdit = () => {
    if (!editingScan) return;
    const qty = Number(draftQty);
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) return;
    onUpdateQty(editingScan.id, qty);
    setEditingScan(null);
  };

  const handleDelete = (scanId: string, operator: string) => {
    const ok = window.confirm(
      `Hapus scan ${operator}? Tindakan ini tidak dapat dibatalkan.`,
    );
    if (ok) onDeleteScan(scanId);
  };

  return (
    <div
      className={`rounded-xl border p-2.5 sm:p-3 transition-all ${
        isCurrentFinalCorrectionRak
          ? "border-violet-300 bg-violet-50/20 ring-2 ring-violet-100"
          : !item.match
            ? item.resolved
              ? "border-emerald-200 bg-emerald-50/20"
              : "border-amber-200 bg-amber-50/20"
            : "border-emerald-200 bg-emerald-50/30"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-700 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
            Rak {item.rak}
          </span>
          {item.scans.some((s) => (s.step ?? 1) >= 2) && (
            <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
              Step 2 (ulang)
            </span>
          )}
          <ScanStatusBadge row={item} />
          {isCurrentFinalCorrectionRak && (
            <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded border border-violet-200">
              Koreksi Akhir
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {item.approvedQty !== null && (
            <div className="flex items-center">
              {isCurrentFinalCorrectionRak ? (
                <button
                  type="button"
                  className="btn btn-[9px] h-5 min-h-5 px-1.5 bg-violet-600 hover:bg-violet-700 border-none text-white font-bold rounded"
                  disabled={isDeletingFinalCorrection}
                  onClick={onDeleteFinalCorrection}
                >
                  {isDeletingFinalCorrection ? "..." : "Reset"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-[9px] h-5 min-h-5 px-1.5 bg-white hover:bg-violet-50 border border-violet-200 text-violet-700 font-bold rounded"
                  disabled={isFinalCorrecting}
                  onClick={() =>
                    onFinalCorrectionRak(item.rak, item.approvedQty!)
                  }
                  title="Gunakan rak ini saja sebagai fisik SKU ini"
                >
                  {isFinalCorrecting ? "..." : "Final Correction"}
                </button>
              )}
            </div>
          )}
          <div className="text-right">
            <span className="text-xs font-black text-slate-800">
              {item.approvedQty ?? "—"} pcs
            </span>
            {item.approvedBy && (
              <p className="text-[10px] text-slate-400">
                oleh {item.approvedBy}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {item.scans.map((scan) => {
          const isApproved = item.approvedScanId === scan.id;
          const showApprove = !item.match;
          return (
            <div
              key={scan.id}
              className={`flex items-center justify-between gap-2 text-[11px] rounded-lg px-2 py-1.5 border ${
                isApproved
                  ? "border-emerald-300 bg-emerald-50"
                  : item.match
                    ? "border-slate-150 bg-white"
                    : "border-red-200 bg-red-50/80"
              }`}
            >
              <span className="text-slate-600 font-semibold truncate flex items-center gap-1.5 min-w-0">
                <span className="truncate">{scan.operator}</span>
                {(scan.step ?? 1) >= 2 ? (
                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded">
                    S{scan.step}
                  </span>
                ) : (
                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500 bg-slate-50 border border-slate-200 px-1 py-0.5 rounded">
                    S1
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <span
                  className={`text-xs font-black ${
                    item.match ? "text-slate-800" : "text-red-700"
                  }`}
                >
                  {scan.qty} pcs
                </span>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost text-slate-500"
                  disabled={
                    (isMutatingScan && mutatingScanId === scan.id) ||
                    isNavSesuai
                  }
                  onClick={() => openEdit(scan)}
                  title={
                    isNavSesuai
                      ? "Sudah sesuai NAV, tidak dapat diubah"
                      : "Edit qty"
                  }
                  aria-label="Edit qty"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost text-red-500"
                  disabled={
                    (isMutatingScan && mutatingScanId === scan.id) ||
                    isNavSesuai
                  }
                  onClick={() => handleDelete(scan.id, scan.operator)}
                  title={
                    isNavSesuai
                      ? "Sudah sesuai NAV, tidak dapat diubah"
                      : "Hapus scan"
                  }
                  aria-label="Hapus scan"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                {showApprove && (
                  <button
                    type="button"
                    className={`btn btn-xs ${isApproved ? "btn-success" : "btn-primary"}`}
                    disabled={
                      (isApproving && approvingScanId === scan.id) ||
                      isNavSesuai
                    }
                    title={
                      isNavSesuai
                        ? "Sudah sesuai NAV, tidak dapat diubah"
                        : undefined
                    }
                    onClick={() => onApprove(scan.id)}
                  >
                    {isApproved ? "Terpilih" : "Tetapkan"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {editingScan && (
        <dialog className="modal modal-open z-50">
          <div className="modal-box max-w-xs bg-white">
            <h3 className="font-bold text-sm text-slate-800">Edit Qty Scan</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {editingScan.operator} · Rak {item.rak}
            </p>
            <input
              type="number"
              min={0}
              step={1}
              className="input input-bordered input-sm w-full mt-3 bg-white text-slate-800 border-slate-200"
              value={draftQty}
              onChange={(e) => setDraftQty(e.target.value)}
            />
            <div className="modal-action mt-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditingScan(null)}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={isMutatingScan && mutatingScanId === editingScan.id}
                onClick={submitEdit}
              >
                {isMutatingScan && mutatingScanId === editingScan.id
                  ? "Menyimpan..."
                  : "Simpan"}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Tutup"
            onClick={() => setEditingScan(null)}
          />
        </dialog>
      )}
    </div>
  );
}

function ScanStatusBadge({ row }: { row: ScanCompareRow }) {
  const base =
    "px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide border";

  if (!row.match && row.resolved) {
    return (
      <span
        className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}
      >
        DITETAPKAN
      </span>
    );
  }
  if (row.resolved) {
    return (
      <span
        className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}
      >
        RESOLVED
      </span>
    );
  }
  if (!row.match) {
    return (
      <span className={`${base} bg-red-50 text-red-700 border-red-200`}>
        QTY BEDA
      </span>
    );
  }
  return (
    <span className={`${base} bg-amber-50 text-amber-700 border-amber-200`}>
      BELUM DITETAPKAN
    </span>
  );
}

function NavStatusBadge({ nav }: { nav: ProductCompare | null }) {
  const base =
    "px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide border";

  if (!nav) {
    return (
      <span className={`${base} bg-slate-100 text-slate-500 border-slate-200`}>
        BELUM ADA DATA
      </span>
    );
  }

  if (nav.status === "sesuai") {
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200 w-fit`}
        >
          NAV SESUAI
        </span>
        <span className="text-[11px] text-slate-600 font-mono">
          {nav.physicalQty} / {nav.systemQty} SOT
        </span>
      </div>
    );
  }

  if (nav.status === "selisih") {
    const delta = nav.physicalQty - nav.systemQty;
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className={`${base} bg-amber-50 text-amber-700 border-amber-200 w-fit`}
        >
          NAV SELISIH ({delta >= 0 ? "+" : ""}
          {delta})
        </span>
        <span className="text-[11px] text-slate-600 font-mono">
          {nav.physicalQty > 0 ? nav.physicalQty : "—"} / {nav.systemQty} SOT
        </span>
      </div>
    );
  }

  return (
    <span className={`${base} bg-slate-100 text-slate-600 border-slate-200`}>
      BELUM COMPARE
    </span>
  );
}

export default function AdminPage() {
  const navigate = useNavigate();
  const { userInfo } = useUserInfo();

  useEffect(() => {
    if (userInfo && !canAccessAdmin(userInfo)) {
      navigate("/input", { replace: true });
    }
  }, [userInfo, navigate]);

  const showOfficePicker = adminCanPickOffice(userInfo);
  const [pickedOffice, setPickedOffice] = useState("Semua");
  const officeDefaultApplied = useRef(false);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const compareOfficeRaw = compareOfficeScope(
    userInfo,
    showOfficePicker ? pickedOffice : undefined,
  );
  const compareOffice = toCanonicalOfficeName(compareOfficeRaw);

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
  const [selectedRak, setSelectedRak] = useState("Semua");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [navStatusFilter, setNavStatusFilter] =
    useState<NavStatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("default");
  const [isSyncingWithSoT, setIsSyncingWithSoT] = useState(false);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [isBulkComparing, setIsBulkComparing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [expandedNavKeys, setExpandedNavKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedNavKeys, setCollapsedNavKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const dateRangeError = resolveDateRangeError(dateFrom, dateTo);
  const isDateRangeValid = dateRangeError === null;

  const compareFilters: CompareQueryParams = useMemo(
    () => ({
      office: compareOffice,
      rak: selectedRak,
      search: debouncedSearch,
      dateFrom,
      dateTo,
    }),
    [compareOffice, selectedRak, debouncedSearch, dateFrom, dateTo],
  );

  const scanCompareQuery = useQuery({
    queryKey: ["compare", "scan", compareFilters],
    queryFn: () => CompareApi.compareScan(compareFilters),
    enabled: isDateRangeValid,
  });

  const navCompareQuery = useQuery({
    queryKey: ["compare", "nav", compareFilters],
    queryFn: async () => {
      const items = await CompareApi.fetchNavCompareList(compareFilters);
      return items.map(mapNavCompareItem);
    },
    enabled: isDateRangeValid,
  });

  const periodModeQuery = useQuery({
    queryKey: ["sku-reminders", "period-mode", compareOffice],
    queryFn: () =>
      listUnresolvedSkus({
        office: compareOffice,
        mode: "unresolved",
      }),
    enabled:
      Boolean(userInfo?.username) &&
      compareOffice !== "Semua" &&
      compareOffice.trim().length > 0,
  });

  const periodAllowsNavCompare =
    compareOffice !== "Semua" &&
    (periodModeQuery.data?.mode ??
      periodModeQuery.data?.period?.mode ??
      "FREE") === "OPNAME";

  const periodClosedAt = periodModeQuery.data?.period?.closedAt ?? null;
  const periodMode =
    periodModeQuery.data?.mode ??
    periodModeQuery.data?.period?.mode ??
    "FREE";

  // Setelah Tutup periode: tarik filter ke hari tutup supaya kerja lama tidak numpang di default
  const periodFilterApplied = useRef("");
  useEffect(() => {
    if (compareOffice === "Semua" || !periodClosedAt) return;
    if (periodMode !== "FREE") return;
    const key = `${compareOffice}|${periodClosedAt}`;
    if (periodFilterApplied.current === key) return;
    periodFilterApplied.current = key;
    const closedDay = periodClosedAt.slice(0, 10);
    setDateFrom(closedDay);
    setDateTo(defaultDateTo());
  }, [compareOffice, periodClosedAt, periodMode]);

  const scanLogsAllQuery = useQuery({
    queryKey: ["opname", "scans", compareOffice, "Semua"],
    queryFn: async () => {
      const res = await axiosInstance.get<ScanLog[]>("/api/opname/scans", {
        params: { office: compareOffice, rak: "Semua" },
      });
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const scanCompareRows = scanCompareQuery.data ?? [];
  const navCompareRows = navCompareQuery.data ?? [];

  const filteredNavRows = useMemo(() => {
    const statusFiltered = applyNavStatusFilter(
      navCompareRows,
      navStatusFilter,
    );
    return sortNavRows(statusFiltered, sortBy);
  }, [navCompareRows, navStatusFilter, sortBy]);

  const hasActiveFilters =
    (showOfficePicker && pickedOffice !== "Semua") ||
    selectedRak !== "Semua" ||
    debouncedSearch !== "" ||
    navStatusFilter !== "all" ||
    sortBy !== "default" ||
    dateFrom !== defaultDateFrom() ||
    dateTo !== defaultDateTo();

  const resetFilters = () => {
    setPickedOffice("Semua");
    setSelectedRak("Semua");
    setSearchTerm("");
    setDebouncedSearch("");
    setNavStatusFilter("all");
    setSortBy("default");
    setDateFrom(defaultDateFrom());
    setDateTo(defaultDateTo());
    setExpandedNavKeys(new Set());
    setCollapsedNavKeys(new Set());
  };

  const scanBySkuLocation = useMemo(() => {
    const map = new Map<string, ScanCompareRow[]>();
    for (const row of scanCompareRows) {
      const key = skuLocationKey(row.sku, row.office);
      const existing = map.get(key) ?? [];
      existing.push(row);
      map.set(key, existing);
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => a.rak - b.rak);
    }
    return map;
  }, [scanCompareRows]);

  const toggleNavExpand = (key: string, currentlyExpanded: boolean) => {
    if (currentlyExpanded) {
      setExpandedNavKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setCollapsedNavKeys((prev) => new Set(prev).add(key));
    } else {
      setCollapsedNavKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setExpandedNavKeys((prev) => new Set(prev).add(key));
    }
  };

  const expandAllRows = () => {
    setExpandedNavKeys(
      new Set(filteredNavRows.map((n) => skuLocationKey(n.sku, n.office))),
    );
    setCollapsedNavKeys(new Set());
  };

  const collapseAllRows = () => {
    setExpandedNavKeys(new Set());
    setCollapsedNavKeys(
      new Set(filteredNavRows.map((n) => skuLocationKey(n.sku, n.office))),
    );
  };

  const isNavRowExpanded = (navKey: string, pendingRakCount: number) => {
    if (collapsedNavKeys.has(navKey)) return false;
    if (expandedNavKeys.has(navKey)) return true;
    return pendingRakCount > 0;
  };

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "warning" | "info";
  } | null>(null);

  const showToast = (
    message: string,
    type: "success" | "warning" | "info" = "success",
  ) => {
    setToast({ message, type });
  };

  const invalidateCompareQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["compare", "scan"] });
    queryClient.invalidateQueries({ queryKey: ["compare", "nav"] });
  };

  const approveScanMutation = useMutation({
    mutationFn: (scanLogId: string) => CompareApi.approveScanQty(scanLogId),
    onSuccess: () => {
      invalidateCompareQueries();
      showToast("Qty operator berhasil ditetapkan", "success");
    },
    onError: (err) => {
      showToast(
        extractApiError(err, "Gagal menetapkan qty operator"),
        "warning",
      );
    },
  });

  const updateScanMutation = useMutation({
    mutationFn: ({ scanLogId, qty }: { scanLogId: string; qty: number }) =>
      CompareApi.updateScanQty(scanLogId, qty),
    onSuccess: () => {
      invalidateCompareQueries();
      showToast("Qty scan diperbarui", "success");
    },
    onError: (err) => {
      showToast(extractApiError(err, "Gagal memperbarui qty scan"), "warning");
    },
  });

  const deleteScanMutation = useMutation({
    mutationFn: (scanLogId: string) => CompareApi.deleteScanLog(scanLogId),
    onSuccess: () => {
      invalidateCompareQueries();
      showToast("Scan dihapus", "success");
    },
    onError: (err) => {
      showToast(extractApiError(err, "Gagal menghapus scan"), "warning");
    },
  });

  const isMutatingScan =
    updateScanMutation.isPending || deleteScanMutation.isPending;
  const mutatingScanId =
    updateScanMutation.variables?.scanLogId ?? deleteScanMutation.variables;

  const checkNavMutation = useMutation({
    mutationFn: (compareItemId: string) =>
      CompareApi.checkNavItem(compareItemId),
    onSuccess: () => {
      invalidateCompareQueries();
      showToast("Cek selisih periode selesai", "success");
    },
    onError: (err) => {
      showToast(JSON.stringify(err), "warning");
    },
  });

  const saveNoteMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      CompareApi.saveNavNote(id, note),
    onSuccess: () => {
      invalidateCompareQueries();
      showToast("Catatan disimpan", "success");
    },
    onError: () => {
      showToast("Gagal menyimpan catatan", "warning");
    },
  });

  const finalCorrectionMutation = useMutation({
    mutationFn: ({
      id,
      physicalQty,
      rak,
    }: {
      id: string;
      physicalQty: number;
      rak?: number;
    }) => CompareApi.finalCorrection(id, physicalQty, rak),
    onSuccess: () => {
      invalidateCompareQueries();
      showToast("Koreksi akhir berhasil diterapkan", "success");
    },
    onError: (err) => {
      showToast(
        extractApiError(err, "Gagal menerapkan koreksi akhir"),
        "warning",
      );
    },
  });

  const deleteFinalCorrectionMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      CompareApi.deleteFinalCorrection(id),
    onSuccess: () => {
      invalidateCompareQueries();
      showToast("Koreksi akhir berhasil dibatalkan", "success");
    },
    onError: (err) => {
      showToast(
        extractApiError(err, "Gagal membatalkan koreksi akhir"),
        "warning",
      );
    },
  });

  const invalidateOpnameQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["opname", "scans"] });
    invalidateCompareQueries();
  };

  const refreshScanCompare = async () => {
    const result = await scanCompareQuery.refetch();
    if (result.isError) {
      showToast("Gagal memuat perbandingan scan", "warning");
      return;
    }
    showToast("Data scan diperbarui", "success");
  };

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
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const runBulkCompareNav = async () => {
    if (isBulkComparing) return;

    if (!periodAllowsNavCompare) {
      showToast(
        "Gudang masih mode Free. Buka periode di Cek Selisih untuk ambil source of truth dulu.",
        "warning",
      );
      return;
    }

    const rangeErr = resolveDateRangeError(dateFrom, dateTo);
    if (rangeErr) {
      showToast(rangeErr, "warning");
      return;
    }

    setIsBulkComparing(true);
    setBulkProgress(null);

    try {
      const rawItems = await CompareApi.fetchNavCompareList({
        ...compareFilters,
        dateFrom,
        dateTo,
      });
      const allRows = rawItems.map(mapNavCompareItem);

      const eligible = allRows.filter(
        (r) => r.pendingRakCount === 0 && r.status !== "sesuai",
      );
      const skipped = allRows.filter(
        (r) => r.pendingRakCount > 0 || r.status === "sesuai",
      );

      setBulkProgress({ current: 0, total: eligible.length });

      const csvRows: BulkCompareResultRow[] = [];
      const rakNamesFor = (sku: string, office: string) =>
        formatRakNames(
          (scanBySkuLocation.get(skuLocationKey(sku, office)) ?? []).map(
            (r) => r.rak,
          ),
        );

      for (let i = 0; i < eligible.length; i++) {
        const nav = eligible[i];
        setBulkProgress({ current: i + 1, total: eligible.length });
        try {
          const result = await CompareApi.checkNavItem(nav.id);
          csvRows.push({
            sku: result.sku,
            name: result.name,
            office: result.office,
            physicalQty: result.physicalQty,
            systemQty: result.systemQty,
            status: result.status,
            rakNames: rakNamesFor(result.sku, result.office),
            resolvedRakCount: result.resolvedRakCount,
            pendingRakCount: result.pendingRakCount,
            note: result.note ?? nav.note ?? "",
            hasil: "dibandingkan",
            keterangan: "",
          });
        } catch (err: unknown) {
          csvRows.push({
            sku: nav.sku,
            name: nav.name,
            office: nav.office,
            physicalQty: nav.physicalQty,
            systemQty: nav.systemQty,
            status: nav.status,
            rakNames: rakNamesFor(nav.sku, nav.office),
            resolvedRakCount: nav.resolvedRakCount,
            pendingRakCount: nav.pendingRakCount,
            note: nav.note ?? "",
            hasil: "gagal",
            keterangan: extractApiError(err, "Gagal terhubung ke server"),
          });
        }
      }

      for (const nav of skipped) {
        csvRows.push({
          sku: nav.sku,
          name: nav.name,
          office: nav.office,
          physicalQty: nav.physicalQty,
          systemQty: nav.systemQty,
          status: nav.status,
          rakNames: rakNamesFor(nav.sku, nav.office),
          resolvedRakCount: nav.resolvedRakCount,
          pendingRakCount: nav.pendingRakCount,
          note: nav.note ?? "",
          hasil: "dilewati_pending_rak",
          keterangan: `${nav.pendingRakCount} rak belum ditetapkan`,
        });
      }

      invalidateCompareQueries();

      const gagal = csvRows.filter((r) => r.hasil === "gagal").length;
      showToast(
        `Bulk selesai: ${eligible.length} dibandingkan, ${skipped.length} dilewati${gagal > 0 ? `, ${gagal} gagal` : ""}`,
        gagal > 0 ? "warning" : "success",
      );
    } catch (err: unknown) {
      showToast(
        extractApiError(err, "Gagal menjalankan bulk compare"),
        "warning",
      );
    } finally {
      setIsBulkComparing(false);
      setBulkProgress(null);
    }
  };

  const exportToCsv = () => {
    const csvRows: BulkCompareResultRow[] = filteredNavRows.map((nav) => {
      const rakDetails =
        scanBySkuLocation.get(skuLocationKey(nav.sku, nav.office)) ?? [];
      return {
        sku: nav.sku,
        name: nav.name,
        office: nav.office,
        physicalQty: nav.physicalQty,
        systemQty: nav.systemQty,
        status: nav.status,
        rakNames: formatRakNames(rakDetails.map((r) => r.rak)),
        resolvedRakCount: nav.resolvedRakCount,
        pendingRakCount: nav.pendingRakCount,
        note: nav.note ?? "",
        hasil: "laporan" as const,
        keterangan:
          nav.status === "belum_compare" ? "belum compare" : "sudah compare",
      };
    });

    const csvContent = buildBulkCompareCsv(csvRows, dateFrom, dateTo);
    downloadCsv(`laporan-opname-${dateFrom}_${dateTo}.csv`, csvContent);
  };

  // Manual Trigger to Sync system stock with ERP / SOT
  const fetchQuantitiesFromSoT = async (forceToast = false) => {
    if (!periodAllowsNavCompare) {
      if (forceToast) {
        showToast(
          "Gudang masih mode Free. Buka periode di Cek Selisih dulu.",
          "warning",
        );
      }
      return;
    }
    setIsSyncingWithSoT(true);
    try {
      const res = await axiosInstance.post("/so/api/opname/sync", {
        office: compareOffice,
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

  const scanLogsAll = scanLogsAllQuery.data ?? [];

  const uniqueRaks = useMemo(() => {
    const raks = scanLogsAll.map((log) => String(log.rak));
    return Array.from(new Set(raks)).sort((a, b) => Number(a) - Number(b));
  }, [scanLogsAll]);

  const stats = useMemo(() => {
    const totalSkuLocation = navCompareRows.length;
    const rakPending = navCompareRows.reduce(
      (sum, n) => sum + n.pendingRakCount,
      0,
    );
    const navSesuai = navCompareRows.filter(
      (i) => i.status === "sesuai",
    ).length;
    const navSelisih = navCompareRows.filter(
      (i) => i.status === "selisih",
    ).length;
    return {
      totalSkuLocation,
      rakPending,
      navSesuai,
      navSelisih,
    };
  }, [navCompareRows]);

  if (userInfo === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <span className="loading loading-spinner loading-lg text-slate-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6f9] text-slate-900 flex flex-col font-sans selection:bg-sky-100 selection:text-slate-900">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(14,165,233,0.08),transparent),linear-gradient(to_right,#e8edf4_1px,transparent_1px),linear-gradient(to_bottom,#e8edf4_1px,transparent_1px)] bg-size-[auto,3.5rem_3.5rem,3.5rem_3.5rem] opacity-70" />

      <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/90 backdrop-blur-xl px-3 sm:px-6 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-[0_1px_0_0_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-white p-1 ring-1 ring-slate-200 shadow-sm">
            <img
              src="/logo.png"
              alt="Stok Opname CSI"
              width={40}
              height={40}
              className="rounded-lg"
            />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              Stok Opname
              <span className="inline-flex items-center rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Beta
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 font-medium">
              Dashboard rekonsiliasi & audit stok
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-stretch md:self-auto">
          <AppNavigation className="max-w-full" />
          <UserSessionBadge />
        </div>
      </header>

      {/* ==========================================
          TOAST ALERT ( Frosted Floating Glass )
          ========================================== */}
      {toast && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 transform translate-y-0 transition-all duration-300">
          <div
            className={`flex items-center gap-3 px-5 py-4 rounded-2xl border backdrop-blur-xl shadow-xl ${
              toast.type === "success"
                ? "bg-white border-emerald-200/80 text-emerald-955 shadow-emerald-500/5"
                : toast.type === "warning"
                  ? "bg-white border-red-200/80 text-red-955 shadow-red-500/5"
                  : "bg-white border-slate-200/80 text-slate-955 shadow-slate-500/5"
            }`}
          >
            <div
              className={`p-1.5 rounded-lg ${
                toast.type === "success"
                  ? "bg-emerald-50 text-emerald-500"
                  : toast.type === "warning"
                    ? "bg-red-50 text-red-500"
                    : "bg-slate-50 text-slate-500"
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

      <section className="relative z-10 px-3 sm:px-6 pt-4 sm:pt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5 flex items-center justify-between shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">
              Total SKU / Lokasi
            </span>
            <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {stats.totalSkuLocation}{" "}
              <span className="text-xs font-medium text-slate-500">item</span>
            </span>
          </div>
          <div className="hidden sm:flex p-2.5 bg-slate-100 text-slate-600 rounded-xl shrink-0">
            <Boxes className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5 flex items-center justify-between shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-rose-200">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">
              Rak Pending
            </span>
            <span className="text-2xl font-bold tracking-tight text-rose-600 tabular-nums">
              {stats.rakPending}{" "}
              <span className="text-xs font-medium text-rose-500/80">rak</span>
            </span>
          </div>
          <div className="hidden sm:flex p-2.5 bg-rose-50 text-rose-600 rounded-xl shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5 flex items-center justify-between shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-amber-200">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">
              NAV Selisih
            </span>
            <span className="text-2xl font-bold tracking-tight text-amber-600 tabular-nums">
              {stats.navSelisih}{" "}
              <span className="text-xs font-medium text-amber-500/80">erp</span>
            </span>
          </div>
          <div className="hidden sm:flex p-2.5 bg-amber-50 text-amber-600 rounded-xl shrink-0">
            <Database className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5 flex items-center justify-between shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-emerald-200">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">
              NAV Sesuai
            </span>
            <span className="text-2xl font-bold tracking-tight text-emerald-600 tabular-nums">
              {stats.navSesuai}{" "}
              <span className="text-xs font-medium text-emerald-600/70">sku</span>
            </span>
          </div>
          <div className="hidden sm:flex p-2.5 bg-emerald-50 text-emerald-600 rounded-xl shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>
      </section>

      <section className="relative z-10 px-3 sm:px-6 pt-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 sm:gap-4">
            <div className="flex flex-col gap-1.5 w-full sm:min-w-45 sm:w-auto">
              <label className="text-[11px] text-slate-600 font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-slate-500" />
                Wilayah / Gudang
              </label>
              {showOfficePicker ? (
                <select
                  value={pickedOffice}
                  onChange={(e) => {
                    const value = e.target.value;
                    setPickedOffice(value);
                    setAdminDefaultOffice(value === "Semua" ? "" : value);
                    setSelectedRak("Semua");
                  }}
                  disabled={isLoadingLocations}
                  className="select select-bordered select-sm w-full bg-white border-slate-200 text-slate-800 font-medium"
                >
                  {isLoadingLocations ? (
                    <option value="Semua">Memuat wilayah...</option>
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
              ) : (
                <div className="select select-bordered select-sm w-full bg-slate-50 border-slate-200 text-slate-800 font-medium flex items-center px-3">
                  {isAdmin(userInfo) || compareOffice === "Semua"
                    ? "Semua Wilayah"
                    : compareOffice || "—"}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5 w-full sm:min-w-35 sm:w-auto">
              <label className="text-[11px] text-slate-600 font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
                Nomor Rak
              </label>
              <select
                value={selectedRak}
                onChange={(e) => setSelectedRak(e.target.value)}
                className="select select-bordered select-sm w-full bg-white border-slate-200 text-slate-800 font-medium"
              >
                <option value="Semua">Semua Rak</option>
                {uniqueRaks.map((rakNo) => (
                  <option key={rakNo} value={rakNo}>
                    Rak {rakNo}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5 w-full sm:flex-1 sm:min-w-50">
              <label className="text-[11px] text-slate-600 font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5 text-slate-500" />
                Cari SKU / Nama
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Cari SKU atau nama barang..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input input-bordered input-sm w-full pl-9 bg-white border-slate-200 text-slate-800 font-medium placeholder:text-slate-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                {searchTerm && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle"
                    onClick={() => setSearchTerm("")}
                    aria-label="Hapus pencarian"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 w-full sm:w-auto">
              <label className="text-[11px] text-slate-600 font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-slate-500" />
                Tanggal Scan
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={`input input-bordered input-sm bg-white border-slate-200 text-slate-800 font-medium w-35 ${dateRangeError ? "input-error" : ""}`}
                />
                <span className="text-xs text-slate-500 font-semibold shrink-0">
                  s/d
                </span>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={`input input-bordered input-sm bg-white border-slate-200 text-slate-800 font-medium w-35 ${dateRangeError ? "input-error" : ""}`}
                />
              </div>
              {dateRangeError && (
                <p className="text-xs text-red-600 font-medium">{dateRangeError}</p>
              )}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                className="btn btn-ghost btn-sm gap-1.5 text-slate-700"
                onClick={resetFilters}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset filter
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
            <span className="text-[11px] text-slate-600 font-semibold uppercase tracking-wide shrink-0">
              Status NAV
            </span>
            <div className="flex flex-wrap gap-1.5">
              {NAV_STATUS_FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`btn btn-sm h-8 min-h-8 rounded-lg text-xs font-semibold ${
                    navStatusFilter === value
                      ? "btn-primary"
                      : "btn-ghost border border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => setNavStatusFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="h-5 w-px bg-slate-200 hidden sm:block" />

            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-600 font-semibold uppercase tracking-wide shrink-0">
                Urutkan
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="select select-bordered select-sm bg-white border-slate-200 text-slate-800 font-medium"
              >
                {SORT_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <main className="relative z-10 flex-1 px-3 sm:px-6 py-4 sm:py-5">
        <section className="bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:h-[min(68vh,720px)]">
          <div className="shrink-0 p-3.5 sm:p-4 border-b border-slate-200 bg-slate-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">
                Perbandingan NAV (per SKU + Lokasi)
              </p>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Total fisik = jumlah qty ditetapkan per rak. Tetapkan qty
                operator di rincian rak.
              </p>
              {isDateRangeValid && (
                <p className="text-xs text-slate-700 font-semibold mt-1.5">
                  Scan {dateFrom} s/d {dateTo} · {filteredNavRows.length} SKU
                  {hasActiveFilters &&
                  navCompareRows.length > filteredNavRows.length
                    ? ` (filter: ${filteredNavRows.length}/${navCompareRows.length})`
                    : ""}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                className="btn btn-ghost btn-sm text-slate-700"
                onClick={expandAllRows}
              >
                Buka semua
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-slate-700"
                onClick={collapseAllRows}
              >
                Tutup semua
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm gap-1.5"
                onClick={runBulkCompareNav}
                disabled={
                  !isDateRangeValid ||
                  isBulkComparing ||
                  !periodAllowsNavCompare
                }
                title={
                  !periodAllowsNavCompare
                    ? "Gudang masih mode Free — tekan Buka periode untuk ambil source of truth dulu"
                    : (dateRangeError ?? undefined)
                }
              >
                {isBulkComparing ? (
                  <>
                    <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                    {bulkProgress
                      ? `Memproses ${bulkProgress.current}/${bulkProgress.total}...`
                      : "Memuat..."}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Bulk Cek Periode
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={exportToCsv}
                disabled={
                  !isDateRangeValid ||
                  isBulkComparing ||
                  filteredNavRows.length === 0
                }
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
              <button
                type="button"
                className="btn btn-neutral btn-sm gap-1.5"
                onClick={() => refreshScanCompare()}
                disabled={scanCompareQuery.isFetching}
              >
                <RefreshCcw
                  className={`h-3.5 w-3.5 ${scanCompareQuery.isFetching ? "animate-spin" : ""}`}
                />
                {scanCompareQuery.isFetching ? "Memuat..." : "Perbarui"}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {/* Sticky header must be a direct sibling of rows inside the scroll container */}
            <div className="hidden lg:grid grid-cols-12 sticky top-0 z-20 min-w-225 bg-slate-100/95 backdrop-blur-sm border-b border-slate-200 text-[11px] font-bold uppercase tracking-wide text-slate-700 py-3 px-4 shadow-[0_1px_0_0_rgba(15,23,42,0.06)]">
              <div className="col-span-3">Info Barang</div>
              <div className="col-span-2 border-l border-slate-300/70 pl-3">
                Fisik (sum)
              </div>
              <div className="col-span-1 border-l border-slate-300/70 pl-3">
                Initial SOT
              </div>
              <div className="col-span-1 border-l border-slate-300/70 pl-3">
                Selisih
              </div>
              <div className="col-span-2 border-l border-slate-300/70 pl-3">
                Rak
              </div>
              <div className="col-span-1 border-l border-slate-300/70 pl-3">
                Status NAV
              </div>
              <div className="col-span-1 border-l border-slate-300/70 pl-3">
                Catatan
              </div>
              <div className="col-span-1 border-l border-slate-300/70 pl-3">
                NAV
              </div>
            </div>

            <div className="divide-y divide-slate-100 lg:min-w-225">
              {navCompareQuery.isLoading ? (
                <NavTableSkeleton />
              ) : dateRangeError ? (
                <div className="flex flex-col items-center justify-center text-center p-12 text-slate-500">
                  <AlertTriangle className="h-12 w-12 text-red-300 mb-3" />
                  <p className="text-sm font-bold text-slate-800">
                    Rentang tanggal tidak valid
                  </p>
                  <p className="text-xs text-red-600 mt-1">{dateRangeError}</p>
                </div>
              ) : navCompareQuery.isError ? (
                <div className="flex flex-col items-center justify-center text-center p-12 text-slate-500">
                  <AlertTriangle className="h-12 w-12 text-red-300 mb-3" />
                  <p className="text-sm font-bold text-slate-800">
                    Gagal memuat data perbandingan
                  </p>
                  <p className="text-xs text-red-600 mt-1">
                    {extractApiError(
                      navCompareQuery.error,
                      "Gagal memuat data perbandingan",
                    )}
                  </p>
                </div>
              ) : filteredNavRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center p-12 text-slate-500">
                  {navCompareRows.length > 0 ? (
                    <>
                      <SlidersHorizontal className="h-12 w-12 text-slate-300 mb-3" />
                      <p className="text-sm font-bold text-slate-800">
                        Tidak ada hasil untuk filter ini
                      </p>
                      <p className="text-xs text-slate-600 mt-1 mb-4">
                        Coba ubah filter status, rak, tanggal, atau kata kunci
                        pencarian
                      </p>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm gap-1.5"
                        onClick={resetFilters}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset filter
                      </button>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-12 w-12 text-slate-300 mb-3" />
                      <p className="text-sm font-bold text-slate-800">
                        Tidak ada scan dalam rentang tanggal ini
                      </p>
                      <p className="text-xs text-slate-600 mt-1">
                        Ubah rentang tanggal atau mulai scan di halaman Input
                        Barang
                      </p>
                    </>
                  )}
                </div>
              ) : (
                filteredNavRows.map((nav) => {
                  const navKey = skuLocationKey(nav.sku, nav.office);
                  const rakDetails = scanBySkuLocation.get(navKey) ?? [];
                  const isExpanded = isNavRowExpanded(
                    navKey,
                    nav.pendingRakCount,
                  );

                  return (
                    <NavCompareItem
                      key={nav.id}
                      nav={nav}
                      rakDetails={rakDetails}
                      isExpanded={isExpanded}
                      onToggleExpand={() => toggleNavExpand(navKey, isExpanded)}
                      onCompareNav={() => checkNavMutation.mutate(nav.id)}
                      isComparePending={
                        checkNavMutation.isPending &&
                        checkNavMutation.variables === nav.id
                      }
                      periodAllowsNavCompare={periodAllowsNavCompare}
                      onSaveNote={(note) =>
                        saveNoteMutation.mutate({ id: nav.id, note })
                      }
                      isSavingNote={
                        saveNoteMutation.isPending &&
                        saveNoteMutation.variables?.id === nav.id
                      }
                      onApprove={(id) => approveScanMutation.mutate(id)}
                      isApproving={approveScanMutation.isPending}
                      approvingScanId={approveScanMutation.variables}
                      onUpdateQty={(scanLogId, qty) =>
                        updateScanMutation.mutate({ scanLogId, qty })
                      }
                      onDeleteScan={(scanLogId) =>
                        deleteScanMutation.mutate(scanLogId)
                      }
                      isMutatingScan={isMutatingScan}
                      mutatingScanId={mutatingScanId}
                      onFinalCorrection={(physicalQty) =>
                        finalCorrectionMutation.mutate({
                          id: nav.id,
                          physicalQty,
                        })
                      }
                      isFinalCorrecting={
                        finalCorrectionMutation.isPending &&
                        finalCorrectionMutation.variables?.id === nav.id &&
                        finalCorrectionMutation.variables?.rak === undefined
                      }
                      onFinalCorrectionRak={(rak, physicalQty) =>
                        finalCorrectionMutation.mutate({
                          id: nav.id,
                          physicalQty,
                          rak,
                        })
                      }
                      onDeleteFinalCorrection={() =>
                        deleteFinalCorrectionMutation.mutate({ id: nav.id })
                      }
                      isDeletingFinalCorrection={
                        deleteFinalCorrectionMutation.isPending &&
                        deleteFinalCorrectionMutation.variables?.id === nav.id
                      }
                    />
                  );
                })
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-slate-200 bg-white/70 px-6 py-3.5 flex items-center justify-between text-xs text-slate-600 font-medium mt-auto">
        <p>&copy; 2026 CSI Stok Opname System. All rights reserved.</p>
        <p className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-sky-500" />
          Audit Control
        </p>
      </footer>
    </div>
  );
}
