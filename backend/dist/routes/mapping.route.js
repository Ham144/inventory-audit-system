import express from "express";
import { prisma } from "../config/db.js";
import { resolveAppUser, canAccessAdmin } from "../utils/app-user.js";
import { getMappings, clearMappingsCache } from "../utils/office-mapping.js";
const router = express.Router();
async function assertAdmin(req, res, next) {
    try {
        const appUser = await resolveAppUser(req);
        if (!canAccessAdmin(appUser)) {
            return res
                .status(403)
                .json({ error: "Akses ditolak. Hanya admin/owner yang diizinkan." });
        }
        next();
    }
    catch (error) {
        return res.status(500).json({ error: "Gagal memverifikasi hak akses." });
    }
}
// 1. GET all mappings
router.get("/", assertAdmin, async (req, res) => {
    try {
        const mappings = await prisma.officeMapping.findMany({
            orderBy: { officeName: "asc" },
        });
        return res.json(mappings);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
// 2. POST create a mapping
router.post("/", assertAdmin, async (req, res) => {
    try {
        const { officeName, locationCode } = req.body;
        if (!officeName?.trim() || !locationCode?.trim()) {
            return res
                .status(400)
                .json({ error: "Nama office dan kode lokasi wajib diisi." });
        }
        const mapping = await prisma.officeMapping.create({
            data: {
                officeName: officeName.trim(),
                locationCode: locationCode.trim().toUpperCase(),
            },
        });
        clearMappingsCache();
        await getMappings();
        return res.json(mapping);
    }
    catch (error) {
        if (error.code === "P2002") {
            return res.status(400).json({ error: "Kode lokasi sudah terdaftar." });
        }
        return res.status(500).json({ error: error.message });
    }
});
// 3. PUT update a mapping
router.put("/:id", assertAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { officeName, locationCode } = req.body;
        if (!officeName?.trim() || !locationCode?.trim()) {
            return res
                .status(400)
                .json({ error: "Nama office dan kode lokasi wajib diisi." });
        }
        const mapping = await prisma.officeMapping.update({
            where: { id: id[0] },
            data: {
                officeName: officeName.trim(),
                locationCode: locationCode.trim().toUpperCase(),
            },
        });
        clearMappingsCache();
        await getMappings();
        return res.json(mapping);
    }
    catch (error) {
        if (error.code === "P2002") {
            return res.status(400).json({ error: "Kode lokasi sudah terdaftar." });
        }
        return res.status(500).json({ error: error.message });
    }
});
// 4. DELETE a mapping
router.delete("/:id", assertAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.officeMapping.delete({
            where: { id: id[0] },
        });
        clearMappingsCache();
        await getMappings();
        return res.json({ success: true, message: "Mapping berhasil dihapus." });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
export default router;
