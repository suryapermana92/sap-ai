import { Router } from "express";
import { db } from "../db/index.js";
import { emailAccounts } from "../db/schema.js";
import { GmailService } from "../services/email/gmail.js";
import { ImapService } from "../services/email/imap.js";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/accounts", async (_req, res) => {
  const accounts = await db.select().from(emailAccounts);
  res.json(accounts);
});

router.post("/accounts", async (req, res) => {
  const { provider, email, imapHost, imapPort, imapSecure, imapUsername, imapPassword } = req.body;

  if (provider === "imap") {
    const service = new ImapService({
      host: imapHost,
      port: imapPort,
      secure: imapSecure,
      user: imapUsername,
      password: imapPassword,
    });

    const test = await service.testConnection();
    if (!test.success) {
      res.status(400).json({ error: test.message });
      return;
    }
  }

  const result = await db.insert(emailAccounts).values({
    provider,
    email,
    imapHost,
    imapPort,
    imapSecure,
    imapUsername,
    imapPassword,
    isActive: true,
  }).returning();

  res.json(result[0]);
});

router.delete("/accounts/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(emailAccounts).where(eq(emailAccounts.id, id));
  res.json({ success: true });
});

router.post("/accounts/:id/test", async (req, res) => {
  const id = Number(req.params.id);
  const account = await db.select().from(emailAccounts).where(eq(emailAccounts.id, id)).get();

  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  if (account.provider === "gmail") {
    if (!account.accessToken) {
      res.status(400).json({ error: "No access token" });
      return;
    }
    const service = new GmailService(account.accessToken, account.refreshToken || undefined);
    try {
      await service.listUnreadMessages();
      res.json({ success: true, message: "Connected" });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  } else if (account.provider === "imap") {
    const service = new ImapService({
      host: account.imapHost!,
      port: account.imapPort!,
      secure: account.imapSecure!,
      user: account.imapUsername!,
      password: account.imapPassword!,
    });
    const result = await service.testConnection();
    res.json(result);
  } else {
    res.status(400).json({ error: "Unknown provider" });
  }
});

// Gmail OAuth
router.get("/auth/google", (_req, res) => {
  const service = new GmailService("");
  service.getAuthUrl().then((url) => res.redirect(url));
});

router.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code as string;
  const service = new GmailService("");
  const tokens = await service.getTokensFromCode(code);

  if (tokens.access_token && tokens.refresh_token) {
    // Get email from Google
    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
    const userInfo = await oauth2Api.userinfo.get();

    await db.insert(emailAccounts).values({
      provider: "gmail",
      email: userInfo.data.email || "",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      isActive: true,
    });

    res.redirect("http://localhost:5173/settings?connected=gmail");
  } else {
    res.status(400).send("Failed to get tokens");
  }
});

export default router;
