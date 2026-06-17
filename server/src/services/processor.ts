import { db } from "../db/index.js";
import { emailAccounts, purchaseOrders, poAttachments, sapConnections } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { GmailService } from "./email/gmail.js";
import { ImapService } from "./email/imap.js";
import { analyzeDocument, screenEmailForPO, analyzeAttachmentsForPO } from "./openai.js";
import { extractTextFromBuffer } from "./documentExtractor.js";
import { SapB1Service } from "./sapB1.js";

// Persist email attachment bytes so the original file can be downloaded from
// the PO detail page later (lets us debug why an extraction was wrong by
// inspecting exactly what the AI received). Skip anything over the cap so
// SQLite doesn't bloat catastrophically on huge attachments.
const MAX_PERSIST_BYTES = 25 * 1024 * 1024;

function attachmentContentForDb(att: { data?: Buffer | null; filename: string }): string | null {
  if (!att.data || att.data.length === 0) return null;
  if (att.data.length > MAX_PERSIST_BYTES) {
    console.warn(
      `[processor] not persisting attachment "${att.filename}" (${att.data.length} bytes, > ${MAX_PERSIST_BYTES})`
    );
    return null;
  }
  return att.data.toString("base64");
}

export class EmailProcessor {
  private running = false;
  private interval: NodeJS.Timeout | null = null;

  start(intervalMs = 60000) {
    if (this.interval) return;
    this.running = true;
    this.tick();
    this.interval = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async tick() {
    if (!this.running) return;

    const accounts = await db.select().from(emailAccounts).where(eq(emailAccounts.isActive, true));

    for (const account of accounts) {
      try {
        let messages: Array<{
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
        }> = [];

        if (account.provider === "gmail" && account.accessToken) {
          const service = new GmailService(account.accessToken, account.refreshToken || undefined);
          messages = await service.listUnreadMessages(account.lastCheckedAt || undefined);
        } else if (account.provider === "imap") {
          const service = new ImapService({
            host: account.imapHost!,
            port: account.imapPort!,
            secure: account.imapSecure!,
            user: account.imapUsername!,
            password: account.imapPassword!,
          });
          messages = await service.fetchUnread(account.lastCheckedAt || undefined);
        }

        // Update last checked time
        await db.update(emailAccounts)
          .set({ lastCheckedAt: new Date() })
          .where(eq(emailAccounts.id, account.id));

        for (const msg of messages) {
          // Skip if already processed
          const existing = await db.select()
            .from(purchaseOrders)
            .where(eq(purchaseOrders.emailMessageId, msg.id))
            .get();

          if (existing) continue;

          // Step 1: Screen email body + attachment names for PO likelihood
          const screen = await screenEmailForPO(
            msg.subject,
            msg.body,
            msg.attachments.map((a) => a.filename)
          );

          if (!screen.isLikelyPO) {
            // Not a PO: save a minimal record for audit
            const poResult = await db.insert(purchaseOrders).values({
              emailAccountId: account.id,
              emailMessageId: msg.id,
              senderEmail: msg.from,
              senderName: msg.fromName,
              subject: msg.subject,
              receivedAt: msg.date,
              status: "detected",
              confidence: screen.confidence,
              aiAnalysis: JSON.stringify({ screening: screen }),
              extractedData: JSON.stringify({ isPurchaseOrder: false, reason: screen.reason, items: [] }),
            }).returning();

            const poId = poResult[0].id;
            for (const att of msg.attachments) {
              await db.insert(poAttachments).values({
                poId,
                filename: att.filename,
                contentType: att.mimeType,
                size: att.size,
                content: attachmentContentForDb(att),
                isPoAttachment: false,
              });
            }
            continue;
          }

          // Step 2: Likely PO — analyze each attachment with AI vision
          const attInputs = msg.attachments.map((att) => ({
            filename: att.filename,
            mimeType: att.mimeType,
            data: att.data,
          }));
          const attAnalyses = await analyzeAttachmentsForPO(attInputs);

          const poAttachmentsList = attAnalyses.filter((a) => a.isPurchaseOrder);

          if (poAttachmentsList.length === 0) {
            // Screen said PO but no attachment is a real PO
            const poResult = await db.insert(purchaseOrders).values({
              emailAccountId: account.id,
              emailMessageId: msg.id,
              senderEmail: msg.from,
              senderName: msg.fromName,
              subject: msg.subject,
              receivedAt: msg.date,
              status: "detected",
              confidence: screen.confidence,
              aiAnalysis: JSON.stringify({ screening: screen, attachmentAnalyses: attAnalyses }),
              extractedData: JSON.stringify({ isPurchaseOrder: false, reason: "No PO attachment found", items: [] }),
            }).returning();

            const poId = poResult[0].id;
            for (let i = 0; i < msg.attachments.length; i++) {
              const att = msg.attachments[i];
              const analysis = attAnalyses[i];
              await db.insert(poAttachments).values({
                poId,
                filename: att.filename,
                contentType: att.mimeType,
                size: att.size,
                content: attachmentContentForDb(att),
                isPoAttachment: analysis.isPurchaseOrder,
                aiAnalysis: JSON.stringify(analysis),
              });
            }
            continue;
          }

          // Step 3: Full document analysis on PO attachments
          const poAttData = msg.attachments.filter((att) =>
            poAttachmentsList.some((pa) => pa.filename === att.filename)
          );

          const combinedTexts: string[] = [msg.body];
          for (const att of poAttData) {
            const text = await extractTextFromBuffer(att.data, att.mimeType);
            if (text) {
              combinedTexts.push(`--- Attachment: ${att.filename} ---\n${text}`);
            }
          }
          const fullText = combinedTexts.join("\n\n");

          const analysis = await analyzeDocument(
            fullText,
            msg.subject,
            poAttData.map((att) => ({
              filename: att.filename,
              mimeType: att.mimeType,
              data: att.data,
            })),
            msg.from
          );

          // Step 4: Determine next status based on offer sheet number
          const offerSheetNumber = analysis.offerSheetNumber || poAttachmentsList.find((pa) => pa.offerSheetNumber)?.offerSheetNumber;
          let status: string;
          if (offerSheetNumber) {
            status = "processing";
          } else {
            status = "needs_offer_sheet";
          }

          // Save PO record
          const poResult = await db.insert(purchaseOrders).values({
            emailAccountId: account.id,
            emailMessageId: msg.id,
            senderEmail: msg.from,
            senderName: msg.fromName,
            subject: msg.subject,
            receivedAt: msg.date,
            status,
            confidence: analysis.confidence,
            offerSheetNumber: offerSheetNumber || null,
            aiAnalysis: JSON.stringify({
              fullText: fullText.substring(0, 10000),
              screening: screen,
              attachmentAnalyses: attAnalyses,
            }),
            extractedData: JSON.stringify(analysis),
          }).returning();

          const poId = poResult[0].id;

          // Save all attachments with their PO flag
          for (let i = 0; i < msg.attachments.length; i++) {
            const att = msg.attachments[i];
            const analysis = attAnalyses[i];
            await db.insert(poAttachments).values({
              poId,
              filename: att.filename,
              contentType: att.mimeType,
              size: att.size,
              content: attachmentContentForDb(att),
              isPoAttachment: analysis?.isPurchaseOrder ?? false,
              aiAnalysis: analysis ? JSON.stringify(analysis) : null,
            });
          }
        }
      } catch (error) {
        console.error(`Error processing account ${account.email}:`, error);
      }
    }
  }
}

export class SAPProcessor {
  async processPendingOrders() {
    const pendingOrders = await db.select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.status, "processing"))
      .all();

    for (const order of pendingOrders) {
      try {
        const sapConns = await db.select().from(sapConnections).where(eq(sapConnections.isActive, true));
        if (sapConns.length === 0) {
          await db.update(purchaseOrders)
            .set({ status: "error", sapError: "No active SAP connection" })
            .where(eq(purchaseOrders.id, order.id));
          continue;
        }

        const sapConn = sapConns[0];
        const service = new SapB1Service({
          serviceLayerUrl: sapConn.serviceLayerUrl,
          companyDB: sapConn.companyDB,
          username: sapConn.username,
          password: sapConn.password,
        });

        const extractedData = order.extractedData ? JSON.parse(order.extractedData) : null;
        if (!extractedData || !extractedData.isPurchaseOrder) {
          await db.update(purchaseOrders)
            .set({ status: "error", sapError: "No valid extracted data" })
            .where(eq(purchaseOrders.id, order.id));
          continue;
        }

        let result: { success: boolean; docEntry?: number; docNum?: number; error?: string };

        // Step A: If offer sheet number exists, find SQ and create SO from SQ
        if (order.offerSheetNumber) {
          const sq = await service.getSalesQuotationByOfferSheet(order.offerSheetNumber);
          if (!sq) {
            await db.update(purchaseOrders)
              .set({ status: "error", sapError: `No Sales Quotation found with Offer Sheet #${order.offerSheetNumber}` })
              .where(eq(purchaseOrders.id, order.id));
            continue;
          }

          const sqFull = await service.getSalesQuotationByDocEntry(sq.docEntry);
          if (!sqFull) {
            await db.update(purchaseOrders)
              .set({ status: "error", sapError: `Could not fetch full Sales Quotation DocEntry ${sq.docEntry}` })
              .where(eq(purchaseOrders.id, order.id));
            continue;
          }

          result = await service.createSalesOrderFromSQ(sq.docEntry, sqFull);

          if (result.success) {
            await db.update(purchaseOrders)
              .set({
                status: "completed",
                sqDocEntry: sq.docEntry,
                sqDocNum: sq.docNum,
                sapDocEntry: result.docEntry,
                sapDocNum: result.docNum,
                updatedAt: new Date(),
              })
              .where(eq(purchaseOrders.id, order.id));
          } else {
            await db.update(purchaseOrders)
              .set({ status: "error", sapError: result.error || "Unknown error" })
              .where(eq(purchaseOrders.id, order.id));
          }
          continue;
        }

        // Step B: Fallback — create SO directly from extracted PO data
        const cardCode = extractedData.customerCode || "C20000"; // Default placeholder
        const docDate = extractedData.poDate ? new Date(extractedData.poDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
        const docDueDate = extractedData.deliveryDate ? new Date(extractedData.deliveryDate).toISOString().split("T")[0] : docDate;

        const lines = (extractedData.items || []).map((item: any, idx: number) => ({
          LineNum: idx,
          ItemCode: item.itemCode || "",
          ItemDescription: item.description || "",
          Quantity: item.quantity || 0,
          UnitPrice: item.unitPrice || 0,
          ShipDate: docDueDate,
          FreeText: item.description || "",
        }));

        result = await service.createSalesOrder({
          CardCode: cardCode,
          DocDate: docDate,
          DocDueDate: docDueDate,
          Comments: `Auto-generated from PO: ${extractedData.poNumber || ""}. ${extractedData.notes || ""}`,
          DocumentLines: lines,
        });

        if (result.success) {
          await db.update(purchaseOrders)
            .set({
              status: "completed",
              sapDocEntry: result.docEntry,
              sapDocNum: result.docNum,
              updatedAt: new Date(),
            })
            .where(eq(purchaseOrders.id, order.id));
        } else {
          await db.update(purchaseOrders)
            .set({ status: "error", sapError: result.error || "Unknown error" })
            .where(eq(purchaseOrders.id, order.id));
        }
      } catch (error: any) {
        await db.update(purchaseOrders)
          .set({ status: "error", sapError: error.message })
          .where(eq(purchaseOrders.id, order.id));
      }
    }
  }
}
