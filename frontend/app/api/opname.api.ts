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

// Shape returned by GET /api/trace (TracingInput table)
export interface TraceLog {
  id: string;
  username: string;
  sku: string;
  rak: number;
  physicalQty: number;
  office: string;
  createdat: string; // Prisma field name (lowercase)
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

export async function traceLogs(params?: {
  office?: string;
  rak?: string;
  startDate?: string;
  endDate?: string;
}) {
  const response = await axiosInstance.get<{ success: boolean; data: TraceLog[] }>(
    "/api/trace",
    {
      params: {
        office: params?.office,
        rak: params?.rak,
        startDate: params?.startDate,
        endDate: params?.endDate,
      },
    },
  );
  return response.data.data ?? [];
}
