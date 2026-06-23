import express from "express";
import type { IncomingHttpHeaders } from "http";
import axios, { AxiosError } from "axios";
import { syncUserProfile } from "../utils/user-store.js";
import { filterProductListPayload } from "../utils/product-filter.js";

const router = express.Router();

const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
]);

const AUTH_PROFILE_PATHS = [
  "/auth/getUserInfo",
  "/auth/login/ldap",
  "/auth/login/app",
];

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

function buildForwardBody(req: express.Request, path: string): unknown {
  const isLdapLogin =
    req.method === "POST" && path.includes("/auth/login/ldap");

  if (!isLdapLogin || !process.env.BYPASS_TURNSTILE_KEY) {
    return req.body;
  }

  const baseBody =
    typeof req.body === "object" &&
    req.body !== null &&
    !Array.isArray(req.body)
      ? req.body
      : {};

  return {
    ...baseBody,
    BYPASS_TURNSTILE_KEY: process.env.BYPASS_TURNSTILE_KEY,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractAuthProfile(data: unknown): {
  username?: string;
  office?: string;
  description?: string;
} | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const root = data as Record<string, unknown>;
  const dataNode =
    typeof root.data === "object" &&
    root.data !== null &&
    !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : null;
  const userInfoNode =
    typeof root.userInfo === "object" &&
    root.userInfo !== null &&
    !Array.isArray(root.userInfo)
      ? (root.userInfo as Record<string, unknown>)
      : null;

  const username =
    readString(dataNode?.username) ??
    readString(userInfoNode?.username) ??
    readString(root.username) ??
    readString(dataNode?.name) ??
    readString(userInfoNode?.name) ??
    readString(root.name);

  if (!username) return null;

  return {
    username,
    office:
      readString(root.office) ??
      readString(dataNode?.office) ??
      readString(userInfoNode?.office) ??
      readString(root.location) ??
      readString(dataNode?.location) ??
      readString(userInfoNode?.location),
    description:
      readString(dataNode?.description) ??
      readString(userInfoNode?.description) ??
      readString(root.description),
  };
}

function mergeRoleIntoPayload(data: unknown, role: string | null): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }

  const root = { ...(data as Record<string, unknown>) };

  const applyRole = (target: Record<string, unknown>) => {
    target.role = role;
  };

  if (root.userInfo && typeof root.userInfo === "object") {
    applyRole(root.userInfo as Record<string, unknown>);
    return root;
  }

  if (root.user && typeof root.user === "object") {
    applyRole(root.user as Record<string, unknown>);
    return root;
  }

  if (root.data && typeof root.data === "object") {
    const nested = root.data as Record<string, unknown>;
    if (nested.userInfo && typeof nested.userInfo === "object") {
      applyRole(nested.userInfo as Record<string, unknown>);
      return root;
    }
    if (nested.user && typeof nested.user === "object") {
      applyRole(nested.user as Record<string, unknown>);
      return root;
    }
    applyRole(nested);
    return root;
  }

  applyRole(root);
  return root;
}

async function enrichAuthProfileResponse(
  path: string,
  status: number,
  data: unknown,
): Promise<unknown> {
  if (status < 200 || status >= 300) return data;
  if (!AUTH_PROFILE_PATHS.some((segment) => path.includes(segment))) {
    return data;
  }

  const profile = extractAuthProfile(data);
  if (!profile?.username) return data;

  try {
    const synced = await syncUserProfile({
      username: profile.username,
      office: profile.office ?? null,
      description: profile.description ?? null,
    });
    return mergeRoleIntoPayload(data, synced.role);
  } catch {
    return data;
  }
}

function shouldFilterProductList(path: string): boolean {
  return path.includes("/v1/product/list");
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
      url: process.env.DATABASE_CENTER + path,
      headers: buildForwardHeaders(req, hasJsonBody),
      data: hasJsonBody ? forwardBody : undefined,
      validateStatus: () => true,
    });

    if (shouldFilterProductList(path)) {
      response.data = filterProductListPayload(response.data);
    }

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

    const responseData = await enrichAuthProfileResponse(
      path,
      response.status,
      response.data,
    );

    return res.status(response.status).json(responseData);
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error("SO proxy error:", axiosError?.message);
    return res
      .status(500)
      .json({ message: "Gagal terhubung ke Backend Source of Truth (midcsi)" });
  }
});

export default router;
