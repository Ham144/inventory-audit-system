import { Router } from "express";
import { readJwtUsername } from "../utils/auth-profile.js";
import prisma from "../config/db.js";
import { Prisma } from "@prisma/client";
import { resolveOfficeAliases } from "../utils/office-mapping.js";
import { resolveAppUser, canAccessAdmin } from "../utils/app-user.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const router = Router();

export async function traceInput(body: Prisma.TracingInputCreateInput) {
  try {
    await prisma.tracingInput.create({
      data: body,
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, message: error };
  }
}

router.get("/", async (req: any, res: any) => {
  const { rak = "semua", office, startDate, endDate } = {
    ...req.body,
    ...req.query,
  };

  try {
    const appUser = await resolveAppUser(req);
    const isAdmin = canAccessAdmin(appUser);

    const whereClause: Prisma.TracingInputWhereInput = {};

    // Operator: hanya log miliknya. Admin/owner: semua operator.
    if (!isAdmin) {
      const targetUsername = readJwtUsername(req.user) as string;
      whereClause.username = targetUsername;
    }

    const requestedOffice =
      typeof office === "string" ? office.trim() : "";
    const wantsAllOffices =
      !requestedOffice || requestedOffice.toLowerCase() === "semua";

    if (!isAdmin) {
      // Operator terkunci ke outlet profilnya (tidak boleh browse outlet lain)
      const operatorOffice = appUser?.office?.trim();
      if (operatorOffice) {
        const aliases = await resolveOfficeAliases(operatorOffice);
        if (aliases.length > 0) {
          whereClause.office = { in: aliases };
        }
      }
    } else if (!wantsAllOffices) {
      // Admin/owner bebas pilih outlet; cocokkan semua alias mapping
      const aliases = await resolveOfficeAliases(requestedOffice);
      if (aliases.length > 0) {
        whereClause.office = { in: aliases };
      } else {
        whereClause.office = requestedOffice;
      }
    }

    // Rak filter: skip if "semua" or not a valid number
    if (rak && rak.toString().toLowerCase() !== "semua") {
      const rakNum = Number(rak);
      if (!isNaN(rakNum)) {
        whereClause.rak = rakNum;
      }
    }

    // Date range filter
    if (startDate || endDate) {
      whereClause.createdat = {};
      if (startDate) whereClause.createdat.gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        whereClause.createdat.lte = end;
      }
    }

    const resultData = await prisma.tracingInput.findMany({
      where: whereClause,
      orderBy: { createdat: "desc" },
    });

    return res.status(200).json({
      success: true,
      data: resultData,
    });
  } catch (error: unknown) {
    return res.status(500).json({ message: errorMessage(error) });
  }
});

export default router;
