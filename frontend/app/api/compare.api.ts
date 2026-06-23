import axiosInstance from "./axios-instance";

export type CompareQueryParams = {
  office: string;
  rak?: string;
  search?: string;
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
};

function toCompareParams(params: CompareQueryParams) {
  return {
    office: params.office,
    rak: params.rak ?? "Semua",
    search: params.search ?? "",
  };
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
      { scanLogId },
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

  checkNavItem: async (compareItemId: string): Promise<NavCompareRow> => {
    const response = await axiosInstance.post<NavCompareRow>(
      `/api/compare/nav/${compareItemId}/check`,
    );
    return response.data;
  },
};
