import express from "express";
import axios, { AxiosError } from "axios";

const router = express.Router();

// Forward semua request ke Source of Truth (SO)
router.all(/.*/, async (req, res) => {
  try {
    const path = req.originalUrl.replace(/^\/so\/api/, "/api");

    // Kirim ke backend SO pakai axios
    const response = await axios({
      method: req.method,
      url: `${process.env.DATABASE_CENTER || "http://192.168.169.12:7047"}${path}`,
      headers: {
        ...req.headers,
        host: undefined, // jangan kirim header host
      },
      data: req.body, // body ikut diteruskan
      validateStatus: () => true, // biar status error tetap diteruskan
    });

    // Ambil token dari body level atas atau bersarang (jika dibungkus objek data)
    const refresh_token =
      response?.data?.refresh_token || response?.data?.data?.refresh_token;
    const access_token =
      response?.data?.access_token || response?.data?.data?.access_token;

    const isProd = process.env.NODE_ENV === "production";

    // Check if this is logout request
    const isLogout =
      req.method === "DELETE" && req.originalUrl.includes("/logout");

    if (isLogout) {
      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: isProd,
        path: "/",
      });
      res.clearCookie("access_token", {
        httpOnly: true,
        secure: isProd,
        path: "/",
      });
    } else {
      // Set cookie hanya jika token valid string
      if (typeof refresh_token === "string" && refresh_token.trim() !== "") {
        res.cookie("refresh_token", refresh_token, {
          httpOnly: true,
          secure: isProd,
          path: "/",
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
      }
      if (typeof access_token === "string" && access_token.trim() !== "") {
        res.cookie("access_token", access_token, {
          httpOnly: true,
          secure: isProd,
          path: "/",
          maxAge: 5 * 60 * 1000,
        });
      }
    }

    // Teruskan status dan data ke frontend
    return res.status(response.status).json(response.data);
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error("SO proxy error:", axiosError?.message);
    return res
      .status(500)
      .json({ message: "Gagal terhubung ke Backend Source of Truth (midcsi)" });
  }
});

export default router;
