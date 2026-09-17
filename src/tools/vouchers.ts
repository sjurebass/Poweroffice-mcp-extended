import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { encodePath, type PowerOfficeClient } from "../api/client.js";
import { json, query, requireConfirm } from "../utils/safety.js";

/**
 * Journal entry voucher DRAFTS (bilagsutkast).
 *
 * A draft sits in the voucher inbox until someone posts or approves it, so
 * these tools are the safe half of bookkeeping: they prepare work without
 * changing the general ledger. Posting straight to the ledger lives in
 * voucher-posting.ts and is gated separately.
 *
 * PowerOffice has one endpoint family per voucher type with identical shapes.
 * Rather than 25 near-identical tools, the type is a parameter.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const VOUCHER_TYPES = {
  manual: "ManualJournals",
  bank: "BankJournals",
  cash: "CashJournals",
  supplierInvoice: "SupplierInvoices",
  supplierCreditNote: "SupplierCreditNotes",
} as const;

type VoucherTypeKey = keyof typeof VOUCHER_TYPES;

const voucherType = z
  .enum(["manual", "bank", "cash", "supplierInvoice", "supplierCreditNote"])
  .describe(
    "manual = manuelt bilag, bank = bankbilag, cash = kassebilag, " +
      "supplierInvoice = leverandørfaktura, supplierCreditNote = leverandørkreditnota"
  );

function segment(type: VoucherTypeKey): string {
  return VOUCHER_TYPES[type];
}

const lineFields = {
  description: z.string().optional(),
  debitAccountId: z.number().int().optional().describe("Account id to debit"),
  creditAccountId: z.number().int().optional().describe("Account id to credit"),
  debitVatId: z.number().int().optional(),
  creditVatId: z.number().int().optional(),
  currencyAmount: z.number().optional().describe("Amount in the voucher currency"),
  currencyCode: z.string().length(3).optional(),
  currencyExchangeRate: z.number().optional(),
  postingDate: DATE.optional(),
  departmentId: z.number().int().optional(),
  projectId: z.number().int().optional(),
  productId: z.number().int().optional(),
  locationId: z.number().int().optional(),
  quantity: z.number().optional(),
};

function lineBody(a: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, string> = {
    description: "Description",
    debitAccountId: "DebitAccountId",
    creditAccountId: "CreditAccountId",
    debitVatId: "DebitVatId",
    creditVatId: "CreditVatId",
    currencyAmount: "CurrencyAmount",
    currencyCode: "CurrencyCode",
    currencyExchangeRate: "CurrencyExchangeRate",
    postingDate: "PostingDate",
    departmentId: "DepartmentId",
    projectId: "ProjectId",
    productId: "ProductId",
    locationId: "LocationId",
    quantity: "Quantity",
  };
  const out: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(map)) {
    if (a[from] !== undefined) out[to] = a[from];
  }
  return out;
}

export function registerVoucherTools(server: McpServer, client: PowerOfficeClient) {
  server.tool(
    "list_voucher_drafts",
    "List journal entry vouchers (bilag) on the client. Filter by whether they are posted or sitting in an approval workflow.",
    {
      isPosted: z.boolean().optional().describe("true = already posted, false = still a draft"),
      inApprovalWorkflow: z.boolean().optional(),
      changedSince: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp — only vouchers changed after this"),
      pageNumber: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().max(1000).optional(),
    },
    async (a) =>
      json(
        await client.get<unknown>(
          "/JournalEntryVouchers",
          query({
            isPosted: a.isPosted,
            inApprovalWorkflow: a.inApprovalWorkflow,
            lastChangedDateTimeOffsetGreaterThan: a.changedSince,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );

  server.tool(
    "get_voucher_draft",
    "Get one voucher draft with its lines. Needs the voucher type because PowerOffice keys drafts by type.",
    { voucherType, id: z.string().min(1).describe("Voucher id") },
    async ({ voucherType: t, id }) =>
      json(await client.get<unknown>(encodePath`/JournalEntryVouchers/${segment(t)}/${id}`))
  );

  server.tool(
    "create_voucher_draft",
    "Create a voucher draft (bilagsutkast). Does not touch the general ledger — the draft must be posted or approved separately. For supplier invoices, invoiceNo is required.",
    {
      voucherType,
      voucherDate: DATE.describe("Bilagsdato"),
      currencyCode: z.string().length(3).default("NOK"),
      description: z.string().optional(),
      comment: z.string().optional(),
      departmentId: z.number().int().optional(),
      projectId: z.number().int().optional(),
      locationId: z.number().int().optional(),
      // Supplier-specific
      invoiceNo: z.string().optional().describe("Required for supplierInvoice/supplierCreditNote"),
      supplierAccountId: z.number().int().optional(),
      dueDate: DATE.optional(),
      cid: z.string().optional().describe("KID"),
      currencyAmount: z.number().optional().describe("Gross amount for supplier vouchers"),
      paymentOnHold: z.boolean().optional(),
    },
    async (a) => {
      const isSupplier =
        a.voucherType === "supplierInvoice" || a.voucherType === "supplierCreditNote";
      if (isSupplier && !a.invoiceNo) {
        throw new Error("invoiceNo is required for supplierInvoice and supplierCreditNote");
      }
      const body: Record<string, unknown> = {
        VoucherDate: a.voucherDate,
        CurrencyCode: a.currencyCode,
      };
      if (a.description) body.Description = a.description;
      if (a.comment) body.Comment = a.comment;
      if (a.departmentId !== undefined) body.DepartmentId = a.departmentId;
      if (a.projectId !== undefined) body.ProjectId = a.projectId;
      if (a.locationId !== undefined) body.LocationId = a.locationId;
      if (isSupplier) {
        body.InvoiceNo = a.invoiceNo;
        if (a.supplierAccountId !== undefined) body.SupplierAccountId = a.supplierAccountId;
        if (a.dueDate) body.DueDate = a.dueDate;
        if (a.cid) body.Cid = a.cid;
        if (a.currencyAmount !== undefined) body.CurrencyAmount = a.currencyAmount;
        if (a.paymentOnHold !== undefined) body.PaymentOnHold = a.paymentOnHold;
      }
      return json(
        await client.post<unknown>(encodePath`/JournalEntryVouchers/${segment(a.voucherType)}`, body)
      );
    }
  );

  server.tool(
    "update_voucher_draft",
    "Update the header of a voucher draft (date, description, due date, KID and similar).",
    {
      voucherType,
      id: z.string().min(1),
      voucherDate: DATE.optional(),
      description: z.string().optional(),
      comment: z.string().optional(),
      dueDate: DATE.optional(),
      cid: z.string().optional(),
      departmentId: z.number().int().optional(),
      projectId: z.number().int().optional(),
      paymentOnHold: z.boolean().optional(),
    },
    async (a) => {
      const patch: Record<string, unknown> = {};
      if (a.voucherDate) patch.VoucherDate = a.voucherDate;
      if (a.description !== undefined) patch.Description = a.description;
      if (a.comment !== undefined) patch.Comment = a.comment;
      if (a.dueDate) patch.DueDate = a.dueDate;
      if (a.cid !== undefined) patch.Cid = a.cid;
      if (a.departmentId !== undefined) patch.DepartmentId = a.departmentId;
      if (a.projectId !== undefined) patch.ProjectId = a.projectId;
      if (a.paymentOnHold !== undefined) patch.PaymentOnHold = a.paymentOnHold;
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
      return json(
        await client.patch<unknown>(
          encodePath`/JournalEntryVouchers/${segment(a.voucherType)}/${a.id}`,
          patch
        )
      );
    }
  );

  server.tool(
    "add_voucher_line",
    "Add a line to a voucher draft. A balanced manual voucher needs matching debit and credit — use list_gl_accounts to find account ids first.",
    { voucherType, id: z.string().min(1), ...lineFields },
    async (a) =>
      json(
        await client.post<unknown>(
          encodePath`/JournalEntryVouchers/${segment(a.voucherType)}/${a.id}/VoucherLines`,
          lineBody(a as unknown as Record<string, unknown>)
        )
      )
  );

  server.tool(
    "update_voucher_line",
    "Change an existing line on a voucher draft.",
    { voucherType, id: z.string().min(1), lineId: z.string().min(1), ...lineFields },
    async (a) => {
      const patch = lineBody(a as unknown as Record<string, unknown>);
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
      return json(
        await client.patch<unknown>(
          encodePath`/JournalEntryVouchers/${segment(a.voucherType)}/${a.id}/VoucherLines/${a.lineId}`,
          patch
        )
      );
    }
  );

  server.tool(
    "delete_voucher_line",
    "Remove a line from a voucher draft.",
    { voucherType, id: z.string().min(1), lineId: z.string().min(1) },
    async (a) => {
      await client.delete<void>(
        encodePath`/JournalEntryVouchers/${segment(a.voucherType)}/${a.id}/VoucherLines/${a.lineId}`
      );
      return json({ deleted: true, voucherId: a.id, lineId: a.lineId });
    }
  );

  server.tool(
    "delete_voucher_draft",
    "Delete a voucher draft with its lines and attached pages. Requires confirm=true.",
    { id: z.string().min(1), confirm: z.boolean().optional() },
    async ({ id, confirm }) => {
      requireConfirm(confirm, `deleting voucher draft ${id}`);
      await client.delete<void>(encodePath`/JournalEntryVouchers/${id}`);
      return json({ deleted: true, id });
    }
  );

  server.tool(
    "add_voucher_page",
    "Attach a document (the receipt or invoice PDF) to a voucher draft. Path must be a local file.",
    {
      id: z.string().min(1),
      filePath: z.string().min(1).describe("Absolute path to a local PDF or image"),
    },
    async ({ id, filePath }) => {
      const data = readFileSync(filePath);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(data)]), filePath.split("/").pop() ?? "file.pdf");
      return json(await client.upload<unknown>(encodePath`/JournalEntryVouchers/${id}/VoucherPages`, form));
    }
  );

  server.tool(
    "delete_voucher_page",
    "Remove an attached page from a voucher draft.",
    { id: z.string().min(1), pageId: z.string().min(1) },
    async ({ id, pageId }) => {
      await client.delete<void>(encodePath`/JournalEntryVouchers/${id}/VoucherPages/${pageId}`);
      return json({ deleted: true, voucherId: id, pageId });
    }
  );

  server.tool(
    "get_voucher_ehf",
    "Retrieve the EHF file for a voucher draft that originated as an EHF invoice.",
    { id: z.string().min(1) },
    async ({ id }) => json(await client.get<unknown>(encodePath`/JournalEntryVouchers/${id}/ehf`))
  );

  server.tool(
    "submit_voucher_for_approval",
    "Send a voucher draft into the client's approval workflow. Internal to the client — nothing is sent to a third party.",
    { id: z.string().min(1), comment: z.string().optional() },
    async ({ id, comment }) =>
      json(
        await client.post<unknown>(encodePath`/JournalEntryVouchers/${id}/submitForApproval`, {
          Comment: comment ?? "",
        })
      )
  );
}
