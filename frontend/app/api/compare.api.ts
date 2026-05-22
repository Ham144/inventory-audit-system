import axiosInstance from "./axios-instance";

export type CompareQueryParams = {
  locationCode: string;
  rak?: string;
  search?: string;
};

export type ScanCompareRow = {
  sku: string;
  name: string;
  rak: number;
  locationCode: string;
  match: boolean;
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
  locationCode: string;
  updatedAt: string;
};

function toCompareParams(params: CompareQueryParams) {
  return {
    locationCode: params.locationCode,
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

  fetchNavCompareList: async (
    params: CompareQueryParams,
  ): Promise<NavCompareRow[]> => {
    const response = await axiosInstance.get<NavCompareRow[]>(
      "/api/compare/nav",
      { params: toCompareParams(params) },
    );
    return response.data;
  },
};
