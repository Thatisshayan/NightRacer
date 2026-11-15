import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { scoresTable } from "@workspace/db";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(helmet());
// Comma-separated allowlist via CORS_ORIGINS. The web client is same-origin
// (Vercel rewrite) and native clients ignore CORS, so the default is local dev only.
const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// Health check endpoint with DB connectivity check
app.get("/healthz", async (req, res) => {
  try {
    // Check DB connectivity
    await db.select().from(scoresTable).limit(1);
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (err) {
    // Detail stays in server logs; never echo DB errors to unauthenticated callers.
    req.log.error({ err }, "Health check failed");
    res.status(503).json({ status: "degraded", db: "disconnected" });
  }
});

app.use("/api", router);

export default app;
