import express from "express";
import type { IncomingHttpHeaders } from "http";
import axios, { AxiosError } from "axios";

const router = express.Router();

const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
]);

function buildForwardHeaders(
  req: express.Request,
  hasJsonBody: boolean,
): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};

  for (const [key, value] of Object.entries(req.headers)) {
    if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    headers[key] = value;
  }

  if (hasJsonBody) {
    headers["content-type"] = "application/json";
  }

  return headers;
}

function buildForwardBody(
  req: express.Request,
  path: string,
): unknown {
  const isLdapLogin =
    req.method === "POST" && path.includes("/auth/login/ldap");

  if (!isLdapLogin || !process.env.BYPASS_TURNSTILE_KEY) {
    return req.body;
  }

  const baseBody =
    typeof req.body === "object" && req.body !== null && !Array.isArray(req.body)
      ? req.body
      : {};

  return {
    ...baseBody,
    BYPASS_TURNSTILE_KEY: process.env.BYPASS_TURNSTILE_KEY,
  };
}

// Forward semua request ke Source of Truth (SO)
router.all(/.*/, async (req, res) => {
  try {
    const path = req.originalUrl.replace(/^\/so\/api/, "/api");
    const forwardBody = buildForwardBody(req, path);
    const hasJsonBody =
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      forwardBody !== undefined &&
      forwardBody !== null;

    const response = await axios({
      method: req.method,
      url: `${process.env.DATABASE_CENTER || "http://192.168.169.12:7047"}${path}`,
      headers: buildForwardHeaders(req, hasJsonBody),
      data: hasJsonBody ? forwardBody : undefined,
      validateStatus: () => true,
    });

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
          secure: false,
          path: "/",
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
      }
      if (typeof access_token === "string" && access_token.trim() !== "") {
        res.cookie("access_token", access_token, {
          httpOnly: true,
          secure: false,
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
