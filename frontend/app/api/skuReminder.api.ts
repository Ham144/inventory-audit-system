import axiosInstance from "./axios-instance";

export type OfficePeriodMode = "FREE" | "OPNAME";

export type SkuReminderItem = {
  id: string;
  sku: string;
  resolvedOffices: string[];
  delegatedTo?: string | null;
  delegatedBy?: string | null;
  delegatedAt?: string | null;
  startPeriod: string | null;
  endPeriod: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SkuReminderSummary = {
  totalCatalog: number;
  unresolved: number;
  resolved: number;
  progressPercent: number;
};

/** @deprecated Gunakan closePeriod — cut-off tunggal diganti Buka/Tutup. */
export async function startNewPeriod(payload?: {
  office: string;
  limit?: number;
}) {
  return closePeriod(payload ?? { office: "" });
}

export async function openPeriod(payload: { office: string }) {
  const response = await axiosInstance.post<{
    success: boolean;
    message: string;
    office: string;
    mode: OfficePeriodMode;
    locationCode?: string | null;
    updatedSystemQty: number;
    failedSystemQty: number;
    positiveQtyCount?: number;
    hiddenZeroQty?: number;
    openedAt: string | null;
    startPeriod: string | null;
    endPeriod: string | null;
  }>("/api/sku-reminders/open-period", payload, {
    // Katalog penuh via SOAP bisa beberapa menit
    timeout: 10 * 60 * 1000,
  });
  return response.data;
}

export async function closePeriod(payload: {
  office: string;
  limit?: number;
}) {
  const response = await axiosInstance.post<{
    success: boolean;
    message: string;
    office: string;
    mode: OfficePeriodMode;
    totalSku: number;
    startPeriod: string | null;
    endPeriod: string | null;
    closedAt?: string | null;
  }>("/api/sku-reminders/close-period", payload);
  return response.data;
}

export async function listUnresolvedSkus(params?: {
  office?: string;
  mode?: "unresolved" | "all";
}) {
  const response = await axiosInstance.get<{
    success: boolean;
    office: string;
    mode: OfficePeriodMode;
    total: number;
    summary: SkuReminderSummary;
    period: {
      startPeriod: string | null;
      endPeriod: string | null;
      mode?: OfficePeriodMode;
      openedAt?: string | null;
      closedAt?: string | null;
    };
    data: SkuReminderItem[];
  }>("/api/sku-reminders/unresolved", {
    params: {
      office: params?.office,
      mode: params?.mode,
    },
  });
  return response.data;
}

export async function filterZeroQtySkus(payload: { office: string }) {
  const response = await axiosInstance.post<{
    success: boolean;
    office: string;
    locationCode: string;
    hiddenZeroQty: number;
    message: string;
  }>("/api/sku-reminders/filter-zero-qty", payload);
  return response.data;
}

export async function delegateSkuReminder(
  skuReminderId: string,
  payload: { office: string; delegatedTo: string | null },
) {
  const response = await axiosInstance.patch<SkuReminderItem>(
    `/api/sku-reminders/${skuReminderId}/delegate`,
    payload,
  );
  return response.data;
}
