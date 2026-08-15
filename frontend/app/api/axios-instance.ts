import axios from "axios";
import type {
  AxiosResponse,
  AxiosError,
  InternalAxiosRequestConfig,
} from "axios";
import { BASE_URL } from "../libs/constant";

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const axiosInstance = axios.create({
  withCredentials: true,
  baseURL: import.meta.env.VITE_BACKEND_BASE_URL ?? BASE_URL,
});

let isRefreshing = false;
let refreshSubscribers: (() => void)[] = [];

function onRefreshed() {
  refreshSubscribers.forEach((cb) => cb());
  refreshSubscribers = [];
}

axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as CustomAxiosRequestConfig;

    // Check if it's a 401 error
    const is401 = error.response?.status === 401;
    const isRefreshEndpoint = originalRequest?.url?.includes(
      "/so/api/auth/refresh-token",
    );
    console.log(is401);
    if (is401 && !originalRequest._retry && !isRefreshEndpoint) {
      if (isRefreshing) {
        // Queue the request until refresh is done
        return new Promise((resolve) => {
          refreshSubscribers.push(() => {
            resolve(axiosInstance(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const res = await axios.post(
          `${import.meta.env.VITE_BACKEND_BASE_URL ?? BASE_URL}/so/api/auth/refresh-token`,
          {},
          { withCredentials: true },
        );

        if (res.status === 200) {
          onRefreshed();
          return axiosInstance(originalRequest); // retry original request
        }
      } catch (refreshError) {
        const axiosRefreshError = refreshError as AxiosError;
        // Jika refresh token gagal, redirect ke login (hindari loop di /login)
        const isOnLogin =
          typeof window !== "undefined" &&
          window.location.pathname === "/login";
        if (axiosRefreshError.response?.status === 401 && !isOnLogin) {
          try {
            window.location.href = "/login";
          } catch (_) {}
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default axiosInstance;
