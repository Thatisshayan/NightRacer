import { pgTable, text, serial, integer, timestamp, boolean, pgCheck } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scoresTable = pgTable("scores", {
  id: serial("id").primaryKey(),
  playerName: text("player_name", { length: 50 }).notNull(),
  score: integer("score").notNull(),
  powerupsUsed: integer("powerups_used").notNull().default(0),
  distanceTraveled: integer("distance_traveled").notNull().default(0),
  car: text("car").notNull().default("default_car"),
  dailyMode: boolean("daily_mode").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("score_idx").on(table.score),
  index("player_name_idx").on(table.playerName),
  index("daily_mode_idx").on(table.dailyMode),
  // Check constraints for range validation
  pgCheck("score_non_negative_and_capped").on(table).expression("score >= 0 AND score <= 999999"),
  pgCheck("powerups_used_non_negative_and_capped").on(table).expression("powerups_used >= 0 AND powerups_used <= 100"),
  pgCheck("distance_traveled_non_negative_and_capped").on(table).expression("distance_traveled >= 0 AND distance_traveled <= 999999"),
]);

export const insertScoreSchema = createInsertSchema(scoresTable)
  .omit({ id: true, createdAt: true })
  .extend({ car: z.string().default("default_car") });
export type InsertScore = z.infer<typeof insertScoreSchema>;
export type Score = typeof scoresTable.$inferSelect;
