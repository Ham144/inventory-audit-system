import { Router } from "express";
import { readJwtUsername } from "../utils/auth-profile.js";
import prisma from "../config/db.js";
import { resolveOfficeName } from "../utils/office-mapping.js";
import { resolveAppUser, canAccessAdmin } from "../utils/app-user.js";
function errorMessage(error) {
    return error instanceof Error ? error.message : "Unknown error";
}
const router = Router();
export async function traceInput(body) {
    try {
        await prisma.tracingInput.create({
            data: body,
        });
        return { success: true };
    }
    catch (error) {
        return { success: false, message: error };
    }
}
router.get("/", async (req, res) => {
    const { rak = "semua", office, startDate, endDate } = {
        ...req.body,
        ...req.query,
    };
    try {
        const appUser = await resolveAppUser(req);
        const isAdmin = canAccessAdmin(appUser);
        const whereClause = {};
        // Admin/owner can see all operators' traces; operators only see their own
        if (!isAdmin) {
            const targetUsername = readJwtUsername(req.user);
            whereClause.username = targetUsername;
        }
        // Normalize office: accepts both locationCode ("MNG2_JUAL") and officeName ("WL Mangga Dua")
        if (office && office.toString().toLowerCase() !== "semua") {
            const resolvedOffice = await resolveOfficeName(office);
            // resolvedOffice is null if unknown — fall through without filtering by office
            if (resolvedOffice) {
                whereClause.office = resolvedOffice;
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
            if (startDate)
                whereClause.createdat.gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
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
    }
    catch (error) {
        return res.status(500).json({ message: errorMessage(error) });
    }
});
export default router;
