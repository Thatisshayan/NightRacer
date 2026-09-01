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
app.use(cors({ origin: ["https://yourdomain.com"] }));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint with DB connectivity check
app.get("/healthz", async (req, res) => {
  try {
    // Check DB connectivity
    await db.select().from(scoresTable).limit(1);
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    res.status(503).json({ status: "degraded", db: "disconnected", error: message });
  }
});

app.use("/api", router);

export default app;
