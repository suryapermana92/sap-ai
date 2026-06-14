import { env } from "../config/env.js";

interface SapB1Credentials {
  serviceLayerUrl: string;
  companyDB: string;
  username: string;
  password: string;
}

interface SapB1Session {
  sessionId: string;
  routeId: string;
  cookies: string[];
}

interface SalesOrderLine {
  ItemCode?: string;
  ItemDescription?: string;
  Quantity: number;
  UnitPrice?: number;
  Currency?: string;
  ShipDate?: string;
  FreeText?: string;
}

interface SalesOrderPayload {
  CardCode: string;
  DocDate?: string;
  DocDueDate?: string;
  Comments?: string;
  DocumentLines: SalesOrderLine[];
}

export class SapB1Service {
  private credentials: SapB1Credentials;

  constructor(credentials: SapB1Credentials) {
    this.credentials = credentials;
  }

  private async login(): Promise<SapB1Session> {
    const url = `${this.credentials.serviceLayerUrl}/Login`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        CompanyDB: this.credentials.companyDB,
        UserName: this.credentials.username,
        Password: this.credentials.password,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SAP B1 Login failed: ${response.status} - ${errorText}`);
    }

    const setCookie = response.headers.get("set-cookie") || "";
    const cookies = setCookie.split(",").map((c) => c.trim());
    const sessionId = cookies.find((c) => c.startsWith("B1SESSION="))?.split("=")[1]?.split(";")[0] || "";
    const routeId = cookies.find((c) => c.startsWith("ROUTEID="))?.split("=")[1]?.split(";")[0] || "";

    return { sessionId, routeId, cookies };
  }

  private async logout(session: SapB1Session): Promise<void> {
    const url = `${this.credentials.serviceLayerUrl}/Logout`;
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          Cookie: session.cookies.join("; "),
        },
      });
    } catch {
      // Ignore logout errors
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const session = await this.login();
      await this.logout(session);
      return { success: true, message: "Connected successfully" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async createSalesOrder(payload: SalesOrderPayload): Promise<{ success: boolean; docEntry?: number; docNum?: number; error?: string }> {
    const session = await this.login();

    try {
      const url = `${this.credentials.serviceLayerUrl}/Orders`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session.cookies.join("; "),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`SAP B1 Order creation failed: ${response.status} - ${errorData}`);
      }

      const result = await response.json();
      return {
        success: true,
        docEntry: result.DocEntry,
        docNum: result.DocNum,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    } finally {
      await this.logout(session);
    }
  }

  async getBusinessPartners(search?: string): Promise<Array<{ cardCode: string; cardName: string }>> {
    const session = await this.login();

    try {
      let url = `${this.credentials.serviceLayerUrl}/BusinessPartners?$select=CardCode,CardName&$filter=CardType eq 'C'`;
      if (search) {
        url += ` and (contains(CardCode,'${search}') or contains(CardName,'${search}'))`;
      }
      url += "&$top=50";

      const response = await fetch(url, {
        headers: {
          Cookie: session.cookies.join("; "),
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch Business Partners: ${response.status}`);
      }

      const result = await response.json();
      return (result.value || []).map((bp: any) => ({
        cardCode: bp.CardCode,
        cardName: bp.CardName,
      }));
    } finally {
      await this.logout(session);
    }
  }

  async getItems(search?: string): Promise<Array<{ itemCode: string; itemName: string }>> {
    const session = await this.login();

    try {
      let url = `${this.credentials.serviceLayerUrl}/Items?$select=ItemCode,ItemName`;
      if (search) {
        url += `&$filter=contains(ItemCode,'${search}') or contains(ItemName,'${search}')`;
      }
      url += "&$top=50";

      const response = await fetch(url, {
        headers: {
          Cookie: session.cookies.join("; "),
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch Items: ${response.status}`);
      }

      const result = await response.json();
      return (result.value || []).map((item: any) => ({
        itemCode: item.ItemCode,
        itemName: item.ItemName,
      }));
    } finally {
      await this.logout(session);
    }
  }

  async getSalesQuotationByOfferSheet(offerSheetNumber: string): Promise<{ docEntry: number; docNum: number; cardCode: string; lines: any[] } | null> {
    const session = await this.login();

    try {
      // UDF field name in SAP B1 for Offer Sheet. Adjust if your system uses a different name.
      const udfField = "U_OfferSheet";
      const url = `${this.credentials.serviceLayerUrl}/Quotations?$filter=${udfField} eq '${encodeURIComponent(offerSheetNumber)}'&$select=DocEntry,DocNum,CardCode,DocumentLines`;

      const response = await fetch(url, {
        headers: {
          Cookie: session.cookies.join("; "),
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch Sales Quotation by Offer Sheet: ${response.status} - ${errText}`);
      }

      const result = await response.json();
      const quotations = result.value || [];
      if (quotations.length === 0) {
        return null;
      }

      const sq = quotations[0];
      return {
        docEntry: sq.DocEntry,
        docNum: sq.DocNum,
        cardCode: sq.CardCode,
        lines: sq.DocumentLines || [],
      };
    } finally {
      await this.logout(session);
    }
  }

  async getSalesQuotationByDocEntry(docEntry: number): Promise<any | null> {
    const session = await this.login();

    try {
      const url = `${this.credentials.serviceLayerUrl}/Quotations(${docEntry})`;
      const response = await fetch(url, {
        headers: {
          Cookie: session.cookies.join("; "),
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Failed to fetch Sales Quotation: ${response.status}`);
      }

      return await response.json();
    } finally {
      await this.logout(session);
    }
  }

  async createSalesOrderFromSQ(sqDocEntry: number, sqData: any): Promise<{ success: boolean; docEntry?: number; docNum?: number; error?: string }> {
    const session = await this.login();

    try {
      const lines = (sqData.DocumentLines || []).map((line: any, idx: number) => ({
        BaseType: 23, // Sales Quotation
        BaseEntry: sqDocEntry,
        BaseLine: line.LineNum ?? idx,
        Quantity: line.Quantity,
        UnitPrice: line.UnitPrice,
        ItemCode: line.ItemCode,
        ItemDescription: line.ItemDescription || line.LineText,
        ShipDate: line.ShipDate,
        FreeText: line.FreeText || "",
      }));

      const payload = {
        CardCode: sqData.CardCode,
        DocDate: sqData.DocDate ? sqData.DocDate.split("T")[0] : new Date().toISOString().split("T")[0],
        DocDueDate: sqData.DocDueDate ? sqData.DocDueDate.split("T")[0] : new Date().toISOString().split("T")[0],
        Comments: `Auto-generated from PO referencing Offer Sheet ${sqData.U_OfferSheet || ""}. Based on SQ #${sqData.DocNum}`,
        DocumentLines: lines,
      };

      const url = `${this.credentials.serviceLayerUrl}/Orders`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session.cookies.join("; "),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`SAP B1 Order creation failed: ${response.status} - ${errorData}`);
      }

      const result = await response.json();
      return {
        success: true,
        docEntry: result.DocEntry,
        docNum: result.DocNum,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    } finally {
      await this.logout(session);
    }
  }
}
