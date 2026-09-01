import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import { scoresTable } from "@workspace/db";
import { desc, sql, gte, lt, gt, and, eq } from "drizzle-orm";
import {
  SubmitScoreBody,
  GetLeaderboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Rate limiting: 10 submissions/minute per IP
const scoreLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many score submissions, please try again later" },
});

// Max plausible score: baseSpeed(5) * maxSpeedMult(3) * maxScoreMult(3) / 10 per distance unit * generous factor
// Score per distance ≈ 0.3 at theoretical max; we allow 1.5× headroom for combo bonuses
const MAX_SCORE_PER_DISTANCE = 1.5;
const MAX_ABSOLUTE_SCORE = 200_000; // absolute ceiling regardless of distance

// GET /scores — leaderboard with optional period filter
router.get("/scores", async (req, res) => {
  try {
    const query = GetLeaderboardQueryParams.parse({ limit: req.query.limit ?? 20 });
    const limit = Math.min(query.limit ?? 20, 100);
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const period = (req.query.period as string | undefined) ?? "all";

    let baseQuery = db.select().from(scoresTable).orderBy(desc(scoresTable.score));

    if (period === "daily") {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      baseQuery = db
        .select()
        .from(scoresTable)
        .where(gte(scoresTable.createdAt, startOfDay))
        .orderBy(desc(scoresTable.score)) as typeof baseQuery;
    } else if (period === "weekly") {
      const startOfWeek = new Date();
      startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 7);
      startOfWeek.setUTCHours(0, 0, 0, 0);
      baseQuery = db
        .select()
        .from(scoresTable)
        .where(gte(scoresTable.createdAt, startOfWeek))
        .orderBy(desc(scoresTable.score)) as typeof baseQuery;
    }

    const rows = await baseQuery.limit(limit).offset(offset);

    const leaderboard = rows.map((row, index) => ({
      id: row.id,
      playerName: row.playerName,
      score: row.score,
      powerupsUsed: row.powerupsUsed,
      distanceTraveled: row.distanceTraveled,
      car: row.car,
      dailyMode: row.dailyMode,
      rank: offset + index + 1,
      createdAt: row.createdAt.toISOString(),
    }));

    res.json(leaderboard);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch leaderboard");
    res.status(500).json({ error: "Failed to fetch leaderboard", code: "SERVER_ERROR" });
  }
});

// POST /scores — submit score with server-side validation
router.post("/scores", scoreLimiter, async (req, res) => {
  try {
    const body = SubmitScoreBody.parse(req.body);

    // Validate distanceTraveled: finite, positive, and <= 100,000
    if (
      !Number.isFinite(body.distanceTraveled) ||
      body.distanceTraveled <= 0 ||
      body.distanceTraveled > 100_000
    ) {
      req.log.warn({ body }, "Score rejected: invalid distanceTraveled");
      res.status(400).json({ error: "distanceTraveled must be a positive finite number <= 100,000", code: "INVALID_INPUT" });
      return;
    }

    // Explicitly check for negative score
    if (body.score < 0) {
      req.log.warn({ body }, "Score rejected: negative score");
      res.status(400).json({ error: "Score cannot be negative", code: "INVALID_INPUT" });
      return;
    }

    // Sanitize playerName to remove HTML tags and control characters
    const sanitizedPlayerName = body.playerName.replace(/[<>"'&]/g, "");

    // Validate car field against allowed values
    const ALLOWED_CARS = ["RATTLETRAP", "WAR_RUNNER", "DEATHSLED", "SCRAPQUEEN", "PHANTOM"];
    if (body.car && !ALLOWED_CARS.includes(body.car)) {
      req.log.warn({ body }, "Score rejected: invalid car type");
      res.status(400).json({ error: "Invalid car type", code: "INVALID_INPUT" });
      return;
    }

    // Check for duplicate scores (same player, score, and dailyMode)
    const existingScore = await db.query.scoresTable.findFirst({
      where: and(
        eq(scoresTable.playerName, sanitizedPlayerName),
        eq(scoresTable.score, body.score),
        eq(scoresTable.dailyMode, body.dailyMode)
      ),
    });
    if (existingScore) {
      req.log.warn({ body }, "Score rejected: duplicate entry");
      res.status(409).json({ error: "Duplicate score", code: "DUPLICATE_SCORE" });
      return;
    }

    // Server-side plausibility check
    const maxAllowed = Math.min(
      MAX_ABSOLUTE_SCORE,
      body.distanceTraveled * MAX_SCORE_PER_DISTANCE + 5000 // 5000 buffer for tank/boss bonuses
    );
    if (body.score > maxAllowed) {
      req.log.warn({ body }, "Score rejected: implausible value");
      res.status(400).json({ error: "Score value is implausible", code: "INVALID_INPUT" });
      return;
    }

    // Wrap insert and rank query in a transaction for atomicity
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(scoresTable)
        .values({
          playerName: sanitizedPlayerName,
          score: body.score,
          powerupsUsed: body.powerupsUsed,
          distanceTraveled: body.distanceTraveled,
          car: body.car ?? "default_car",
          dailyMode: body.dailyMode,
        })
        .returning();

      // Use parameterized query with Drizzle's gt operator to avoid SQL injection
      const rankResult = await tx
        .select({ count: sql<number>`count(*)` })
        .from(scoresTable)
        .where(gt(scoresTable.score, inserted.score));

      const rank = Number(rankResult[0]?.count ?? 0) + 1;

       // Log successful submission
       req.log.info({ score: inserted.score, player: inserted.playerName }, "Score submitted successfully");

       res.status(201).json({
         id: inserted.id,
         playerName: inserted.playerName,
         score: inserted.score,
         powerupsUsed: inserted.powerupsUsed,
         distanceTraveled: inserted.distanceTraveled,
         car: inserted.car,
         dailyMode: inserted.dailyMode,
         rank,
         createdAt: inserted.createdAt.toISOString(),
       });
     });
   } catch (err) {
     req.log.error({ err }, "Failed to submit score");
     res.status(500).json({ error: "Failed to submit score", code: "SERVER_ERROR" });
   }
});

// GET /scores/stats — global game stats
router.get("/scores/stats", async (req, res) => {
  try {
    const statsResult = await db
      .select({
        totalGamesPlayed: sql<number>`count(*)`,
        highestScore: sql<number>`coalesce(max(${scoresTable.score}), 0)`,
        averageScore: sql<number>`coalesce(round(avg(${scoresTable.score})), 0)`,
        totalPowerupsUsed: sql<number>`coalesce(sum(${scoresTable.powerupsUsed}), 0)`,
      })
      .from(scoresTable);

    const stats = statsResult[0] ?? {
      totalGamesPlayed: 0,
      highestScore: 0,
      averageScore: 0,
      totalPowerupsUsed: 0,
    };

    res.json({
      totalGamesPlayed: Number(stats.totalGamesPlayed),
      highestScore: Number(stats.highestScore),
      averageScore: Number(stats.averageScore),
      totalPowerupsUsed: Number(stats.totalPowerupsUsed),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch game stats");
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
