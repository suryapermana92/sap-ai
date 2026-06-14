import { ImapFlow } from "imapflow";
import { simpleParser, AddressObject } from "mailparser";

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

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

export class ImapService {
  private config: ImapConfig;

  constructor(config: ImapConfig) {
    this.config = config;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
      logger: false,
    });

    try {
      await client.connect();
      await client.logout();
      return { success: true, message: "Connected successfully" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async fetchUnread(since?: Date): Promise<EmailMessage[]> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Use a time-based filter so emails already marked as read are still
      // detected. On the very first run (no `since`), fall back to unread-only
      // to avoid pulling the entire mailbox history.
      const searchCriteria: any = since ? { since } : { unseen: true };

      const messages = await client.fetch(searchCriteria, {
        envelope: true,
        source: true,
        bodyStructure: true,
      });

      const result: EmailMessage[] = [];

      for await (const msg of messages) {
        if (!msg.source) continue;

        const parsed = await simpleParser(msg.source);
        const attachments = (parsed.attachments || []).map((att) => ({
          filename: att.filename || "attachment",
          mimeType: att.contentType || "application/octet-stream",
          data: att.content as Buffer,
          size: att.size,
        }));

        result.push({
          id: msg.uid?.toString() || "",
          threadId: "",
          subject: parsed.subject || "",
          from: this.extractAddress(parsed.from),
          fromName: this.extractName(parsed.from),
          to: this.extractAddress(parsed.to),
          date: parsed.date || new Date(),
          body: parsed.text || parsed.html || "",
          attachments,
        });
      }

      return result;
    } finally {
      lock.release();
      await client.logout();
    }
  }

  // Fetch and parse a single message by its IMAP UID.
  async fetchByUid(uid: string): Promise<EmailMessage | null> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const messages = await client.fetch(
        { uid },
        { envelope: true, source: true, bodyStructure: true },
        { uid: true }
      );

      for await (const msg of messages) {
        if (!msg.source) continue;

        const parsed = await simpleParser(msg.source);
        const attachments = (parsed.attachments || []).map((att) => ({
          filename: att.filename || "attachment",
          mimeType: att.contentType || "application/octet-stream",
          data: att.content as Buffer,
          size: att.size,
        }));

        return {
          id: msg.uid?.toString() || uid,
          threadId: "",
          subject: parsed.subject || "",
          from: this.extractAddress(parsed.from),
          fromName: this.extractName(parsed.from),
          to: this.extractAddress(parsed.to),
          date: parsed.date || new Date(),
          body: parsed.text || parsed.html || "",
          attachments,
        };
      }

      return null;
    } finally {
      lock.release();
      await client.logout();
    }
  }

  private extractAddress(addr?: AddressObject | AddressObject[]): string {
    if (!addr) return "";
    const first = Array.isArray(addr) ? addr[0] : addr;
    return first?.value?.[0]?.address || "";
  }

  private extractName(addr?: AddressObject | AddressObject[]): string {
    if (!addr) return "";
    const first = Array.isArray(addr) ? addr[0] : addr;
    return first?.value?.[0]?.name || "";
  }
}
