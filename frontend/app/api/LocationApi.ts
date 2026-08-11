import axiosInstance from "./axios-instance";

const locationApi = {
  getAllLocation: async (searchKey: string) => {
    const response = await axiosInstance.get(
      `/so/api/v1/location/list${searchKey ? `?searchKey=${searchKey}` : ""}`,
    );
    return response.data;
  },
};

export default locationApi;
