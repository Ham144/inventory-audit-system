import axiosInstance from "./axios-instance";

export type CompareQueryParams = {
  office: string;
  rak?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type ScanCompareRow = {
  sku: string;
  name: string;
  rak: number;
  office: string;
  match: boolean;
  resolved: boolean;
  approvedQty: number | null;
  approvedScanId: string | null;
  approvedBy: string | null;
  scans: {
    id: string;
    qty: number;
    operator: string;
    createdAt: string;
  }[];
};

export type NavCompareRow = {
  id: string;
  sku: string;
  name: string;
  physicalQty: number;
  systemQty: number;
  status: string;
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
};

function toCompareParams(params: CompareQueryParams) {
  const base: Record<string, string> = {
    office: params.office,
    rak: params.rak ?? "Semua",
    search: params.search ?? "",
  };
  if (params.dateFrom) base.dateFrom = params.dateFrom;
  if (params.dateTo) base.dateTo = params.dateTo;
  return base;
}

export const CompareApi = {
  compareScan: async (
    params: CompareQueryParams,
  ): Promise<ScanCompareRow[]> => {
    const response = await axiosInstance.get<ScanCompareRow[]>(
      "/api/compare/scan",
      { params: toCompareParams(params) },
    );
    return response.data;
  },

  approveScanQty: async (scanLogId: string): Promise<ScanCompareRow | null> => {
    const response = await axiosInstance.post<ScanCompareRow | null>(
      "/api/compare/scan/approve",
      { scanLogId }
    );
    return response.data;
  },

  updateScanQty: async (
    scanLogId: string,
    qty: number,
  ): Promise<ScanCompareRow | null> => {
    const response = await axiosInstance.patch<ScanCompareRow | null>(
      `/api/compare/scan/${scanLogId}`,
      { qty },
    );
    return response.data;
  },

  deleteScanLog: async (scanLogId: string): Promise<ScanCompareRow | null> => {
    const response = await axiosInstance.delete<ScanCompareRow | null>(
      `/api/compare/scan/${scanLogId}`,
    );
    return response.data;
  },

  fetchNavCompareList: async (
    params: CompareQueryParams,
  ): Promise<NavCompareRow[]> => {
    const response = await axiosInstance.get<NavCompareRow[]>(
      "/api/compare/nav",
      { params: toCompareParams(params) },
    );
    return response.data;
  },

  // main
  checkNavItem: async (compareItemId: string): Promise<NavCompareRow> => {
    const response = await axiosInstance.post<NavCompareRow>(
      `/api/compare/nav/${compareItemId}/check`,
    );
    return response.data;
  },
  
  saveNavNote: async (
    compareItemId: string,
    note: string,
  ): Promise<NavCompareRow> => {
    const response = await axiosInstance.patch<NavCompareRow>(
      `/api/compare/nav/${compareItemId}/note`,
      { note },
    );
    return response.data;
  },

  // Final Correction: admin directly sets physicalQty, bypassing rak logic
  finalCorrection: async (
    compareItemId: string,
    physicalQty: number,
    rak?: number,
  ): Promise<NavCompareRow> => {
    const response = await axiosInstance.post<NavCompareRow>(
      `/api/compare/nav/${compareItemId}/final-correction`,
      { physicalQty, rak },
    );
    return response.data;
  },

  deleteFinalCorrection: async (
    compareItemId: string,
  ): Promise<NavCompareRow> => {
    const response = await axiosInstance.delete<NavCompareRow>(
      `/api/compare/nav/${compareItemId}/final-correction`,
    );
    return response.data;
  },

  // Delegation: admin assigns a user to re-check this SKU
  delegateSku: async (
    compareItemId: string,
    delegatedTo: string | null,
  ): Promise<NavCompareRow> => {
    const response = await axiosInstance.patch<NavCompareRow>(
      `/api/compare/nav/${compareItemId}/delegate`,
      { delegatedTo },
    );
    return response.data;
  },
};
