import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { scoresTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import {
  SubmitScoreBody,
  GetLeaderboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /scores — leaderboard
router.get("/scores", async (req, res) => {
  try {
    const query = GetLeaderboardQueryParams.parse({ limit: req.query.limit ?? 20 });
    const limit = Math.min(query.limit ?? 20, 100);

    const rows = await db
      .select()
      .from(scoresTable)
      .orderBy(desc(scoresTable.score))
      .limit(limit);

    const leaderboard = rows.map((row, index) => ({
      id: row.id,
      playerName: row.playerName,
      score: row.score,
      powerupsUsed: row.powerupsUsed,
      distanceTraveled: row.distanceTraveled,
      rank: index + 1,
      createdAt: row.createdAt.toISOString(),
    }));

    res.json(leaderboard);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch leaderboard");
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// POST /scores — submit score
router.post("/scores", async (req, res) => {
  try {
    const body = SubmitScoreBody.parse(req.body);

    const [inserted] = await db
      .insert(scoresTable)
      .values({
        playerName: body.playerName,
        score: body.score,
        powerupsUsed: body.powerupsUsed,
        distanceTraveled: body.distanceTraveled,
      })
      .returning();

    // Calculate rank
    const rankResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(scoresTable)
      .where(sql`${scoresTable.score} > ${inserted.score}`);

    const rank = Number(rankResult[0]?.count ?? 0) + 1;

    res.status(201).json({
      id: inserted.id,
      playerName: inserted.playerName,
      score: inserted.score,
      powerupsUsed: inserted.powerupsUsed,
      distanceTraveled: inserted.distanceTraveled,
      rank,
      createdAt: inserted.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to submit score");
    res.status(400).json({ error: "Invalid score submission" });
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
