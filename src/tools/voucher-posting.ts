import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodePath, type PowerOfficeClient } from "../api/client.js";
import { json, requireConfirm } from "../utils/safety.js";

/**
 * Direct posting to the general ledger (bokføring).
 *
 * Unlike a draft, a posted voucher is part of the accounts: under Norwegian
 * bookkeeping rules it cannot be edited or deleted, only reversed. Every tool
 * here therefore requires an explicit confirm=true, and the reversal tool is
 * provided so a mistake has a legitimate remedy.
 *
 * Posting is where this server stops being read-mostly. It still cannot send
 * anything to a customer or move any money — see utils/safety.ts.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const POST_TYPES = {
  manual: "ManualJournals",
  bank: "BankJournals",
  cash: "CashJournals",
  outgoingInvoice: "OutgoingInvoiceJournals",
  outgoingCreditNote: "OutgoingCreditNoteJournals",
  yearEnd: "YearEndJournals",
} as const;

const postType = z
  .enum(["manual", "bank", "cash", "outgoingInvoice", "outgoingCreditNote", "yearEnd"])
  .describe(
    "manual = manuelt bilag, bank = bankbilag, cash = kassebilag, " +
      "outgoingInvoice/outgoingCreditNote = bookkeeping record of an already-issued sales document, " +
      "yearEnd = årsoppgjørsbilag"
  );

const voucherLine = z.object({
  description: z.string().optional(),
  debitAccountId: z.number().int().optional(),
  creditAccountId: z.number().int().optional(),
  debitVatId: z.number().int().optional(),
  creditVatId: z.number().int().optional(),
  currencyAmount: z.number().describe("Amount for this line"),
  currencyCode: z.string().length(3).optional(),
  postingDate: DATE.optional(),
  departmentId: z.number().int().optional(),
  projectId: z.number().int().optional(),
  productId: z.number().int().optional(),
  quantity: z.number().optional(),
});

function toApiLine(l: z.infer<typeof voucherLine>): Record<string, unknown> {
  const out: Record<string, unknown> = { CurrencyAmount: l.currencyAmount };
  if (l.description) out.Description = l.description;
  if (l.debitAccountId !== undefined) out.DebitAccountId = l.debitAccountId;
  if (l.creditAccountId !== undefined) out.CreditAccountId = l.creditAccountId;
  if (l.debitVatId !== undefined) out.DebitVatId = l.debitVatId;
  if (l.creditVatId !== undefined) out.CreditVatId = l.creditVatId;
  if (l.currencyCode) out.CurrencyCode = l.currencyCode;
  if (l.postingDate) out.PostingDate = l.postingDate;
  if (l.departmentId !== undefined) out.DepartmentId = l.departmentId;
  if (l.projectId !== undefined) out.ProjectId = l.projectId;
  if (l.productId !== undefined) out.ProductId = l.productId;
  if (l.quantity !== undefined) out.Quantity = l.quantity;
  return out;
}

export function registerVoucherPostingTools(server: McpServer, client: PowerOfficeClient) {
  server.tool(
    "post_voucher",
    "Post a voucher directly to the general ledger (bokfør). This is final: a posted voucher cannot be edited or deleted, only reversed. Requires confirm=true. Check get_lock_date first — postings on or before the lock date are rejected.",
    {
      postType,
      voucherDate: DATE.describe("Bilagsdato"),
      currencyCode: z.string().length(3).default("NOK"),
      description: z.string().optional(),
      lines: z.array(voucherLine).min(1).describe("Voucher lines — debits must equal credits"),
      confirm: z.boolean().optional().describe("Must be true — this posts to the general ledger"),
    },
    async (a) => {
      const total = a.lines.reduce((sum, l) => sum + (l.currencyAmount ?? 0), 0);
      requireConfirm(
        a.confirm,
        `posting a ${a.postType} voucher dated ${a.voucherDate} with ${a.lines.length} line(s), total ${total}`
      );
      const body: Record<string, unknown> = {
        VoucherDate: a.voucherDate,
        CurrencyCode: a.currencyCode,
        VoucherLines: a.lines.map(toApiLine),
      };
      if (a.description) body.Description = a.description;
      return json(await client.post<unknown>(encodePath`/Vouchers/${POST_TYPES[a.postType]}`, body));
    }
  );

  server.tool(
    "get_posted_voucher",
    "Read back a voucher that was posted to the general ledger.",
    { postType, id: z.string().min(1) },
    async ({ postType: t, id }) =>
      json(await client.get<unknown>(encodePath`/Vouchers/${POST_TYPES[t]}/${id}`))
  );

  server.tool(
    "reverse_voucher",
    "Reverse (kreditere/tilbakefør) a posted voucher. This is the correct way to undo a posting — it creates an offsetting voucher rather than erasing history. Requires confirm=true.",
    { id: z.string().min(1).describe("Id of the posted voucher to reverse"), confirm: z.boolean().optional() },
    async ({ id, confirm }) => {
      requireConfirm(confirm, `reversing posted voucher ${id}`);
      return json(await client.post<unknown>(encodePath`/Vouchers/Reverse/${id}`, {}));
    }
  );
}
