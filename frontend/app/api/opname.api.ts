import axiosInstance from "./axios-instance";

export interface ScanLog {
  id: string;
  rak: number;
  sku: string;
  name: string;
  qty?: number;
  office?: string;
  createdAt: string;
  operator: string;
}

export async function getScans(params?: { office?: string; rak?: string }) {
  const response = await axiosInstance.get<ScanLog[]>("/api/opname/scans", {
    params: {
      office: params?.office,
      rak: params?.rak,
    },
  });
  return response.data;
}
