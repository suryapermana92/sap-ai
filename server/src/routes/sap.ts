import { Router } from "express";
import { db } from "../db/index.js";
import { sapConnections } from "../db/schema.js";
import { SapB1Service } from "../services/sapB1.js";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/connections", async (_req, res) => {
  const connections = await db.select().from(sapConnections);
  // Don't return passwords
  res.json(connections.map((c) => ({
    ...c,
    password: undefined,
  })));
});

router.post("/connections", async (req, res) => {
  const { name, serviceLayerUrl, companyDB, username, password } = req.body;

  // Test connection first
  const service = new SapB1Service({ serviceLayerUrl, companyDB, username, password });
  const test = await service.testConnection();

  if (!test.success) {
    res.status(400).json({ error: test.message });
    return;
  }

  const result = await db.insert(sapConnections).values({
    name,
    serviceLayerUrl,
    companyDB,
    username,
    password,
    lastConnectedAt: new Date(),
  }).returning();

  res.json({ ...result[0], password: undefined });
});

router.post("/connections/:id/test", async (req, res) => {
  const id = Number(req.params.id);
  const conn = await db.select().from(sapConnections).where(eq(sapConnections.id, id)).get();

  if (!conn) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const service = new SapB1Service({
    serviceLayerUrl: conn.serviceLayerUrl,
    companyDB: conn.companyDB,
    username: conn.username,
    password: conn.password,
  });

  const test = await service.testConnection();
  if (test.success) {
    await db.update(sapConnections).set({ lastConnectedAt: new Date() }).where(eq(sapConnections.id, id));
  }

  res.json(test);
});

router.delete("/connections/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(sapConnections).where(eq(sapConnections.id, id));
  res.json({ success: true });
});

router.get("/connections/:id/business-partners", async (req, res) => {
  const id = Number(req.params.id);
  const search = req.query.search as string | undefined;
  const conn = await db.select().from(sapConnections).where(eq(sapConnections.id, id)).get();

  if (!conn) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const service = new SapB1Service({
    serviceLayerUrl: conn.serviceLayerUrl,
    companyDB: conn.companyDB,
    username: conn.username,
    password: conn.password,
  });

  const partners = await service.getBusinessPartners(search);
  res.json(partners);
});

router.get("/connections/:id/items", async (req, res) => {
  const id = Number(req.params.id);
  const search = req.query.search as string | undefined;
  const conn = await db.select().from(sapConnections).where(eq(sapConnections.id, id)).get();

  if (!conn) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const service = new SapB1Service({
    serviceLayerUrl: conn.serviceLayerUrl,
    companyDB: conn.companyDB,
    username: conn.username,
    password: conn.password,
  });

  const items = await service.getItems(search);
  res.json(items);
});

export default router;
