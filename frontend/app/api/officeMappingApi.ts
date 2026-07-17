import axiosInstance from "./axios-instance";

export type OfficeMappingRecord = {
  id: string;
  officeName: string;
  locationCode: string;
  createdAt: string;
  updatedAt: string;
};

export async function listOfficeMappings() {
  const response = await axiosInstance.get<OfficeMappingRecord[]>("/api/mappings");
  return response.data;
}

export async function createOfficeMapping(payload: {
  officeName: string;
  locationCode: string;
}) {
  const response = await axiosInstance.post<OfficeMappingRecord>("/api/mappings", payload);
  return response.data;
}

export async function updateOfficeMapping(
  id: string,
  payload: {
    officeName: string;
    locationCode: string;
  },
) {
  const response = await axiosInstance.put<OfficeMappingRecord>(
    `/api/mappings/${encodeURIComponent(id)}`,
    payload,
  );
  return response.data;
}

export async function deleteOfficeMapping(id: string) {
  const response = await axiosInstance.delete<{ success: boolean; message: string }>(
    `/api/mappings/${encodeURIComponent(id)}`,
  );
  return response.data;
}
