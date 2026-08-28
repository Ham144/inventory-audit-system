import express, { type Response } from "express";
import axios from "axios";
import { canAccessAdmin, resolveAppUser } from "../utils/app-user.js";
import { resolveOfficeName } from "../utils/office-mapping.js";
import {
  filterHiddenProducts,
  readProductSkuFromItem,
} from "../utils/product-filter.js";
import {
  getReusableApiBase,
  getReusableApiHeaders,
} from "../utils/reusable-api.js";
import {
  getSkuReminderSummary,
  listSkuReminders,
  markSkuReminderResolved as markSkuReminderResolvedInStore,
  syncSkuReminderCatalog,
} from "../utils/sku-reminder-store.js";

const router = express.Router();

type ProductRecord = Record<string, unknown>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function parseBoolLike(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function isActiveProduct(item: ProductRecord): boolean {
  return (
    !parseBoolLike(item.Blocked) &&
    !parseBoolLike(item.Blocked_MA) &&
    !parseBoolLike(item.Blocked_Services)
  );
}

// periode baru
async function startNewPeriod(limit = 5000): Promise<string[]> {
  const response = await axios.get(
    `${getReusableApiBase()}/api/v1/product/list`,
    {
      params: { limit },
      headers: getReusableApiHeaders(),
      validateStatus: () => true,
    },
  );

  if (response.status >= 400) {
    throw new Error(
      `Gagal mengambil katalog SKU (${response.status}): ${
        typeof response.data?.message === "string"
          ? response.data.message
          : "upstream error"
      }`,
    );
  }

  const payload = response.data;
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  const productList = filterHiddenProducts(rawList as ProductRecord[]);
  const skuSet = new Set<string>();

  for (const item of productList) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (!isActiveProduct(item as ProductRecord)) continue;

    const sku = readProductSkuFromItem(item);
    if (sku) skuSet.add(sku);
  }

  return [...skuSet];
}

router.post("/collect-data", async (req: any, res: Response) => {
  try {
    const appUser = await resolveAppUser(req);
    if (!canAccessAdmin(appUser)) {
      return res.status(403).json({ message: "Akses ditolak" });
    }

    const { startPeriod, endPeriod, limit = 5000 } = req.body as {
      startPeriod?: string;
      endPeriod?: string;
      limit?: number;
    };

    const periodStart = startPeriod ? new Date(startPeriod) : new Date();
    const periodEnd = endPeriod ? new Date(endPeriod) : null;

    if (Number.isNaN(periodStart.getTime())) {
      return res.status(400).json({ message: "startPeriod tidak valid" });
    }
    if (periodEnd && Number.isNaN(periodEnd.getTime())) {
      return res.status(400).json({ message: "endPeriod tidak valid" });
    }
    if (periodEnd && periodEnd < periodStart) {
      return res.status(400).json({ message: "endPeriod harus >= startPeriod" });
    }

    const skus = await startNewPeriod(Number(limit) || 5000);
    if (!skus.length) {
      return res.status(400).json({ message: "SKU sumber kosong" });
    }

    await syncSkuReminderCatalog(skus, periodStart, periodEnd);

    return res.json({
      success: true,
      message: "Daftar tugas SKU berhasil dibuat ulang",
      totalSku: skus.length,
      startPeriod: periodStart.toISOString(),
      endPeriod: periodEnd?.toISOString() ?? null,
    });
  } catch (error: unknown) {
    return res.status(500).json({ message: errorMessage(error) });
  }
});

router.get("/unresolved", async (req: any, res: Response) => {
  try {
    const appUser = await resolveAppUser(req);
    if (!appUser?.username) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const officeInput =
      (req.query.office as string | undefined)?.trim() ||
      appUser.office?.trim() ||
      "";
    const isAllOffice = officeInput.toLowerCase() === "semua";
    const office = officeInput ? await resolveOfficeName(officeInput) : null;

    if (!isAllOffice && !office) {
      return res.status(400).json({
        message: "Office wajib diisi atau disetel pada akun.",
      });
    }

    const mode =
      (req.query.mode as string | undefined)?.toLowerCase() === "all"
        ? "all"
        : "unresolved";

    const unresolved = await listSkuReminders(
      isAllOffice ? undefined : (office as string),
      isAllOffice ? "all" : mode,
    );
    const summary = await getSkuReminderSummary(
      isAllOffice ? undefined : (office as string),
    );

    const periodRow = unresolved[0] ?? null;

    return res.json({
      success: true,
      office: isAllOffice ? "Semua" : office,
      total: unresolved.length,
      summary,
      period: {
        startPeriod: periodRow?.startPeriod ?? null,
        endPeriod: periodRow?.endPeriod ?? null,
      },
      data: unresolved,
    });
  } catch (error: unknown) {
    return res.status(500).json({ message: errorMessage(error) });
  }
});

export async function markSkuReminderResolved(sku: string, office: string) {
  await markSkuReminderResolvedInStore(sku, office);
}

export default router;
