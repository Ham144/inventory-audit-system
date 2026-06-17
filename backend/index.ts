import express from "express";
import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import externalBackendRouter from "./routes/external-backend.route.js";
import opnameRouter, { startOpnameCron } from "./routes/opname.route.js";
import compareRouter from "./routes/compare.router.js";
import authenticate from "./middlewares/authenticate.middleware.js";

import { connectDB } from "./config/db.js";

const corsOrigin = process.env.FRONT_END;
const app = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);

// Database Connection
connectDB();

// Public test route
app.get("/", async (_req, res) => {
  return res.send("STOK OPNAME BACKEND : 200 (Active and Running)");
});

// ==========================================
// API Routes (Uncomment as they are developed)
// ==========================================
app.use(authenticate);
app.use("/api/opname", opnameRouter);
app.use("/so/api", externalBackendRouter);
app.use("/api/compare", compareRouter);

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log("\n" + "=".repeat(50));
  console.log(`🚀 STOK OPNAME BACKEND IS ALIVE!`);
  console.log(`📡 Listening on port: ${port}`);
  console.log(`🔗 Local Address: http://localhost:${port}`);
  console.log(`🌐 Environment:   ${process.env.NODE_ENV || "development"}`);
  console.log("=".repeat(50) + "\n");

  // Start Background Cron Reconciler
  startOpnameCron();
});
