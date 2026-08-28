import axiosInstance from "./axios-instance";

export type SkuReminderItem = {
  id: string;
  sku: string;
  resolvedOffices: string[];
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

export async function startNewPeriod(payload?: {
  startPeriod?: string;
  endPeriod?: string;
  limit?: number;
}) {
  const response = await axiosInstance.post<{
    success: boolean;
    message: string;
    totalSku: number;
    startPeriod: string;
    endPeriod: string | null;
  }>("/api/sku-reminders/collect-data", payload ?? {});
  return response.data;
}

export async function listUnresolvedSkus(params?: {
  office?: string;
  mode?: "unresolved" | "all";
}) {
  const response = await axiosInstance.get<{
    success: boolean;
    office: string;
    total: number;
    summary: SkuReminderSummary;
    period: {
      startPeriod: string | null;
      endPeriod: string | null;
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
