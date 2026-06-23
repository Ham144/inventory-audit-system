import axiosInstance from "./axios-instance";
import { filterProductListResponse } from "~/libs/product-filter";

const ProductApi = {
  searchProducts: async (query?: string, page = 1, limit = 50) => {
    const skip = (Number(page) - 1) * Number(limit);
    const params = new URLSearchParams();
    if (query) params.set("searchKey", query);
    params.set("skip", String(skip));
    params.set("limit", String(limit));
    const res = await axiosInstance.get(
      `/so/api/v1/product/list?${params.toString()}`,
    );
    return filterProductListResponse(res.data);
  },
};

export default ProductApi;
