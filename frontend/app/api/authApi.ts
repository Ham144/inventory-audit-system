import { toast } from "sonner";
import axiosInstance from "./axios-instance";

//login LDAP
export const loginLdap = async (body: any) => {
  const finalBody = {
    ...body,
    selectedOrg: {
      organizationName: "CATUR SUKSES INTERNASIONAL",
      _id: "688828ded953f48ff0fa7cba",
    },
  };
  const response = await axiosInstance.post(
    `/so/api/auth/login/ldap`,
    finalBody,
  );
  return response; // ✅ Return full response
};

export const loginApp = async (body: any) => {
  const finalBody = {
    ...body,
    selectedOrg: {
      organizationName: "CATUR SUKSES INTERNASIONAL",
      _id: "688828ded953f48ff0fa7cba",
    },
  };
  const response = await axiosInstance.post(
    `/so/api/auth/login/app`,
    finalBody,
  );
  return response; // ✅ Return full response
};

export const register = async (body: any) => {
  const response = await axiosInstance.post(
    "/so/api/auth/multi-tenant/register",
    body,
  );
  return response?.data;
};

export const createAppUser = async (body: any) => {
  const response = await axiosInstance.post("/so/api/auth/createAppUser", body);
  return response.data;
};

export const getUserInfo = async () => {
  try {
    const response = await axiosInstance.get(`/so/api/auth/getUserInfo`);
    return response?.data;
  } catch (error: any) {
    if (error.response?.status !== 401) {
      toast.error(JSON.stringify(error));
    }
    return null;
  }
};

//ini banyak yang gunain hati hati, edit update user saja
export const getAllAccount = async (searchKey: any) => {
  const params: Record<string, any> = {};
  if (typeof searchKey === "object" && searchKey !== null) {
    Object.keys(searchKey).forEach((key) => {
      params[`searchKey[${key}]`] = searchKey[key];
    });
  } else {
    params.searchKey = searchKey;
  }

  const response = await axiosInstance.get(`/so/api/auth/getAllAccount`, {
    params,
  });
  return response.data;
};

export const searchAccount = async ({ username }: { username: string }) => {
  const params = new URLSearchParams();
  params.append("username", username);
  const response = await axiosInstance.get(`/so/api/auth/searchAccount`, {
    params,
  });
  return response.data;
};

//mostly update role
export const updateUser = async (body: any) => {
  const response = await axiosInstance.put(`/so/api/auth/updateUser`, body);
  return response.data;
};

//update my profile
export const updateMyProfile = async (body: any) => {
  const response = await axiosInstance.put(
    `/so/api/auth/update/my-profile`,
    body,
  );
  return response.data;
};

export const getUserById = async (id: string | number) => {
  const response = await axiosInstance.get(`/so/api/auth/getUserById/${id}`);
  return response?.data;
};

export const takeOverUser = async (body: any) => {
  const res = await axiosInstance.put(`/so/api/auth/takeOverUser`, body);
  return res.data;
};

export const switchOrg = async (body: any) => {
  const res = await axiosInstance.post(`/so/api/auth/switchOrg`, body);
  return res.data;
};

export const resetPassword = async (body: any) => {
  const res = await axiosInstance.put(`/so/api/auth/resetPassword`, body);
  return res.data;
};

export const deleteAppUser = async (_id: string | number) => {
  const response = await axiosInstance.delete(
    `/so/api/auth/deleteAppUser/${_id}`,
  );
  return response.data;
};

export const verifyOTPwhatsapp = async (body: any) => {
  const response = await axiosInstance.post(
    `/so/api/auth/verify/whatsapp`,
    body,
  );
  return response.data;
};

export const resendOtpWhatsapp = async (body: any) => {
  const response = await axiosInstance.post(
    "/so/api/auth/resendOtpWhatsapp",
    body,
  );
  return response.data;
};

export const getStatus2Fa = async () => {
  const response = await axiosInstance.get("/so/api/auth/2fa/status");
  return response.data;
};

export const deactivate2Fa = async () => {
  const response = await axiosInstance.delete("/so/api/auth/2fa/deactivate");
  return response.data;
};

export const activate2Fa = async () => {
  const response = await axiosInstance.get("/so/api/auth/2fa/activate");
  return response.data;
};

export const verify2Fa = async ({ otp }: { otp: string }) => {
  const response = await axiosInstance.post("/so/api/auth/2fa/verify", { otp });
  return response.data;
};

export const complete2faLogin = async ({
  otp,
  pendingToken,
}: {
  otp: string;
  pendingToken: string;
}) => {
  const response = await axiosInstance.post("/so/api/auth/2fa/login-complete", {
    otp,
    pendingToken,
  });
  return response.data;
};

export const completeWhatsappOTPLogin = async ({
  otp,
  pendingToken,
}: {
  otp: string;
  pendingToken: string;
}) => {
  const response = await axiosInstance.post(
    "/so/api/auth/whatsapp-otp/login-complete",
    {
      otp,
      pendingToken,
    },
  );
  return response; // ✅ Return full response object, not just response.data
};

//whatsapp otp
export const testWhatsappOTP = async () => {
  const res = await axiosInstance.get("/so/api/auth/whatsapp-otp/test");
  return res.data;
};

export const whatsappActivateConfirm = async ({ otp }: { otp: string }) => {
  const res = await axiosInstance.post("/so/api/auth/whatsapp-otp/verify", {
    otp,
  });
  return res.data;
};

export const logout = async () => {
  const response = await axiosInstance.delete(`/so/api/auth/logout`);
  return response.data;
};
