import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { env } from "../../config/env.js";

export interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromName: string;
  to: string;
  date: Date;
  body: string;
  attachments: Array<{
    filename: string;
    mimeType: string;
    data: Buffer;
    size: number;
  }>;
}

export class GmailService {
  private oauth2Client: OAuth2Client;

  constructor(accessToken: string, refreshToken?: string) {
    this.oauth2Client = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI
    );
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }

  async getAuthUrl(): Promise<string> {
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/gmail.readonly"],
      prompt: "consent",
    });
    return authUrl;
  }

  async getTokensFromCode(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens;
  }

  async listUnreadMessages(since?: Date): Promise<EmailMessage[]> {
    const gmail = google.gmail({ version: "v1", auth: this.oauth2Client });
    const query = since ? `after:${Math.floor(since.getTime() / 1000)}` : "is:unread";

    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 50,
    });

    const messages = res.data.messages || [];
    const result: EmailMessage[] = [];

    for (const msg of messages) {
      if (!msg.id) continue;
      const parsed = await this.getMessage(msg.id);
      if (parsed) result.push(parsed);
    }

    return result;
  }

  // Fetch and parse a single message by its Gmail message id.
  async getMessage(messageId: string): Promise<EmailMessage | null> {
    const gmail = google.gmail({ version: "v1", auth: this.oauth2Client });

    const detail = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const payload = detail.data.payload;
    if (!payload) return null;

    const headers = payload.headers || [];
    const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
    const fromHeader = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
    const toHeader = headers.find((h) => h.name?.toLowerCase() === "to")?.value || "";
    const dateHeader = headers.find((h) => h.name?.toLowerCase() === "date")?.value || "";

    let fromEmail = fromHeader;
    let fromName = "";
    const match = fromHeader.match(/(.*?)\s*<(.+)>/);
    if (match) {
      fromName = match[1].replace(/"/g, "").trim();
      fromEmail = match[2].trim();
    }

    const attachments: Array<EmailMessage["attachments"][number] & { attachmentId?: string }> = [];
    let body = "";

    const processPart = (part: any) => {
      if (part.parts) {
        part.parts.forEach(processPart);
      }
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || "application/octet-stream",
          data: Buffer.from(part.body.data || "", "base64"),
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.mimeType === "text/plain" && part.body?.data) {
        body += Buffer.from(part.body.data, "base64").toString("utf-8");
      }
    };

    if (payload.parts) {
      payload.parts.forEach(processPart);
    } else if (payload.body?.data) {
      body = Buffer.from(payload.body.data, "base64").toString("utf-8");
    }

    // Fetch actual attachment binary data for any part that referenced it.
    for (const att of attachments) {
      if (att.data.length === 0 && att.attachmentId) {
        const attRes = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: att.attachmentId,
        });
        if (attRes.data.data) {
          att.data = Buffer.from(attRes.data.data, "base64url");
        }
      }
    }

    return {
      id: messageId,
      threadId: detail.data.threadId || "",
      subject,
      from: fromEmail,
      fromName,
      to: toHeader,
      date: new Date(dateHeader),
      body,
      attachments: attachments.map(({ attachmentId, ...rest }) => rest),
    };
  }
}
