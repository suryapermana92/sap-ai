import { Router } from "express";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const allSettings = await db.select().from(settings);
  const result: Record<string, string> = {};
  for (const s of allSettings) {
    result[s.key] = s.value;
  }
  res.json(result);
});

router.post("/", async (req, res) => {
  const { key, value } = req.body;

  const existing = await db.select().from(settings).where(eq(settings.key, key)).get();

  if (existing) {
    await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.id, existing.id));
  } else {
    await db.insert(settings).values({ key, value });
  }

  res.json({ key, value });
});

export default router;
