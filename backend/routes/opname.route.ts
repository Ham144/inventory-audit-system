import express, { type Request, type Response } from "express";
import axios from "axios";
import { prisma } from "../config/db.js";

type SessionScopeWhere =
  | { sessionId: string }
  | { sessionId: { in: string[] } };
import {
  tryAutoApproveUnanimousGroup,
  deleteScanQtyApprovals,
} from "../utils/scan-approval.js";
import {
  parseCatalogList,
  resolveStockQty,
  toCompareItemSeed,
  type StockResponse,
} from "../types/catalog.js";

const router = express.Router();

const databaseCenter = () =>
  process.env.DATABASE_CENTER ?? "http://192.168.169.12:7047";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

async function fetchCatalogProducts() {
  const response = await axios.get(
    `${databaseCenter()}/api/v1/product/list?limit=50`,
  );
  return parseCatalogList(response.data);
}

async function seedSessionCatalog(sessionId: string) {
  try {
    const dataList = await fetchCatalogProducts();
    if (dataList.length > 0) {
      await prisma.compareItem.createMany({
        data: dataList.map((p) => toCompareItemSeed(p, sessionId)),
        skipDuplicates: true,
      });
    }
  } catch (err: unknown) {
    console.error(
      "Gagal melakukan populasi produk awal sesi:",
      errorMessage(err),
    );
  }
}

async function getOrCreateActiveSession(locationCode: string) {
  let session = await prisma.opnameSession.findFirst({
    where: {
      locationCode,
      status: "ONGOING",
    },
  });

  if (!session) {
    session = await prisma.opnameSession.create({
      data: {
        name: `Sesi Opname - Lokasi ${locationCode}`,
        locationCode,
        status: "ONGOING",
      },
    });

    await seedSessionCatalog(session.id);
  }

  return session;
}

async function sessionScopeWhere(
  locationCode: string,
): Promise<SessionScopeWhere> {
  if (locationCode === "Semua") {
    const activeSessions = await prisma.opnameSession.findMany({
      where: { status: "ONGOING" },
    });
    const sessionIds = activeSessions.map((s: any) => s.id);
    return { sessionId: { in: sessionIds } };
  }

  const session = await getOrCreateActiveSession(locationCode);
  return { sessionId: session.id };
}

// 1. GET active session
router.get("/session/active", async (req: Request, res: Response) => {
  try {
    const locationCode = (req.query.locationCode as string) || "01";
    const session = await getOrCreateActiveSession(locationCode);
    return res.json(session);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// 2. POST create new session (closes ongoing one)
router.post("/session/create", async (req: Request, res: Response) => {
  try {
    const { name, locationCode } = req.body as {
      name?: string;
      locationCode?: string;
    };
    const loc = locationCode || "01";

    await prisma.opnameSession.updateMany({
      where: {
        locationCode: loc,
        status: "ONGOING",
      },
      data: {
        status: "COMPLETED",
      },
    });

    const session = await prisma.opnameSession.create({
      data: {
        name: name || `Opname Sesi - ${new Date().toLocaleDateString("id-ID")}`,
        locationCode: loc,
        status: "ONGOING",
      },
    });

    await seedSessionCatalog(session.id);

    return res.json(session);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// 3. POST scan log (adds a scan)
router.post("/scan", async (req: any, res: Response) => {
  try {
    const { sku, name, rak, qty, locationCode } = req.body as {
      sku: string;
      name?: string;
      rak?: number | string;
      qty?: number | string;
      locationCode?: string;
    };
    const loc = locationCode || "01";

    const session = await getOrCreateActiveSession(loc);

    const scan = await prisma.scanLog.create({
      data: {
        sku,
        name: name ?? "",
        rak: Number(rak) || 1,
        qty: Number(qty) || 0,
        operator: req.user.username as string,
        locationCode: loc,
        sessionId: session.id,
      },
    });

    await prisma.compareItem.upsert({
      where: {
        sessionId_sku: {
          sessionId: session.id,
          sku,
        },
      },
      update: {},
      create: {
        sku,
        name: name ?? "",
        physicalQty: 0,
        systemQty: 0,
        status: "BELUM_COMPARE",
        sessionId: session.id,
      },
    });

    const groupScans = await prisma.scanLog.findMany({
      where: {
        sessionId: session.id,
        sku,
        rak: scan.rak,
        locationCode: loc,
      },
    });

    await tryAutoApproveUnanimousGroup(groupScans);

    return res.json({ scan });
  } catch (error: unknown) {
    console.error("Scan API Error:", errorMessage(error));
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// 4. GET comparison items
router.get("/comparison", async (req: Request, res: Response) => {
  try {
    const locationCode = (req.query.locationCode as string) || "01";
    const whereClause = await sessionScopeWhere(locationCode);

    const items = await prisma.compareItem.findMany({
      where: whereClause,
      orderBy: {
        updatedAt: "desc",
      },
    });

    return res.json(items);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// 5. POST sync manual
router.post("/sync", async (req: Request, res: Response) => {
  try {
    const locationCode =
      (req.body as { locationCode?: string }).locationCode || "01";
    const whereClause = await sessionScopeWhere(locationCode);

    const items = await prisma.compareItem.findMany({
      where: whereClause,
    });

    const updatedItems = [];

    for (const item of items) {
      try {
        let loc = locationCode;
        if (locationCode === "Semua") {
          const itemSession = await prisma.opnameSession.findUnique({
            where: { id: item.sessionId },
          });
          loc = itemSession?.locationCode || "01";
        }

        const response = await axios.get<StockResponse>(
          `${databaseCenter()}/api/v1/product/getStock?No=${item.sku}&locationCode=${loc}`,
        );

        const realQty = resolveStockQty(response.data);
        const status = item.physicalQty === realQty ? "SESUAI" : "SELISIH";

        const updated = await prisma.compareItem.update({
          where: { id: item.id },
          data: {
            systemQty: realQty,
            status,
            updatedAt: new Date(),
          },
        });

        updatedItems.push(updated);
      } catch (err: unknown) {
        console.error(`Gagal sync SKU ${item.sku}:`, errorMessage(err));
        updatedItems.push(item);
      }
    }

    return res.json(updatedItems);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// 6. POST reset active session
router.post("/reset", async (req: Request, res: Response) => {
  try {
    const locationCode =
      (req.body as { locationCode?: string }).locationCode || "01";

    if (locationCode === "Semua") {
      const activeSessions = await prisma.opnameSession.findMany({
        where: { status: "ONGOING" },
      });

      for (const session of activeSessions) {
        await deleteScanQtyApprovals({ sessionId: session.id });

        await prisma.scanLog.deleteMany({
          where: { sessionId: session.id },
        });

        await prisma.compareItem.deleteMany({
          where: { sessionId: session.id },
        });

        await seedSessionCatalog(session.id);
      }
      return res.json({
        success: true,
        message: "Seluruh wilayah berhasil direset ke status awal.",
      });
    }

    const session = await getOrCreateActiveSession(locationCode);

    await deleteScanQtyApprovals({ sessionId: session.id });

    await prisma.scanLog.deleteMany({
      where: { sessionId: session.id },
    });

    await prisma.compareItem.deleteMany({
      where: { sessionId: session.id },
    });

    await seedSessionCatalog(session.id);

    return res.json({
      success: true,
      message: "State berhasil direset ke status awal. Scan lokal dibersihkan.",
    });
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// 7. GET active scans
router.get("/scans", async (req: Request, res: Response) => {
  try {
    const locationCode = (req.query.locationCode as string) || "01";
    const rak = (req.query.rak as string) || "Semua";
    const whereClause = await sessionScopeWhere(locationCode);

    const scans = await prisma.scanLog.findMany({
      where: {
        ...whereClause,
        ...(rak !== "Semua" ? { rak: Number(rak) } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(scans);
  } catch (error: unknown) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

export default router;

export function startOpnameCron() {
  console.log(
    "⏰ Opname Background Reconciler Cron initialized (Running every 3 hours)",
  );
  setInterval(async () => {
    try {
      const activeSessions = await prisma.opnameSession.findMany({
        where: { status: "ONGOING" },
      });

      for (const session of activeSessions) {
        const items = await prisma.compareItem.findMany({
          where: { sessionId: session.id },
        });

        for (const item of items) {
          try {
            const response = await axios.get<StockResponse>(
              `${databaseCenter()}/api/v1/product/getStock?No=${item.sku}&locationCode=${session.locationCode}`,
            );

            const realQty = resolveStockQty(response.data);
            const status = item.physicalQty === realQty ? "SESUAI" : "SELISIH";

            await prisma.compareItem.update({
              where: { id: item.id },
              data: {
                systemQty: realQty,
                status,
                updatedAt: new Date(),
              },
            });
          } catch {
            // skip single product sync failure
          }
        }
      }
      console.log(
        `⏰ Background opname status reconciliation finished at: ${new Date().toLocaleTimeString()}`,
      );
    } catch (err: unknown) {
      console.error("Opname background cron error:", errorMessage(err));
    }
  }, 10800000);
}
