import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PowerOfficeClient } from "../api/client.js";
import { json, query } from "../utils/safety.js";

/**
 * Customer ledger (kundereskontro) — the mirror of the supplier ledger in
 * suppliers.ts, and it follows the same shape.
 *
 * Every /Customerledger endpoint takes a mandatory as-of date: a balance or an
 * open item only means anything at a point in time. Omitting it does not
 * default to today — the request 404s.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const paging = {
  pageNumber: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(1000).optional(),
};

export function registerLedgerTools(server: McpServer, client: PowerOfficeClient) {
  server.tool(
    "get_customer_balances",
    "Kundereskontro: what each customer owes us as of a date. Answers: who owes us money?",
    {
      date: DATE.describe("Balance date, inclusive"),
      customerIds: z
        .array(z.number().int().positive())
        .optional()
        .describe("Limit to these customer IDs"),
      includeOnlyOpenItems: z
        .boolean()
        .optional()
        .describe("Count only unmatched entries towards the balance"),
      onlyNonZero: z
        .boolean()
        .default(true)
        .describe("Drop customers whose balance is zero. Applied to the returned page."),
      ...paging,
    },
    async (a) => {
      const all =
        (await client.get<any[]>(
          "/Customerledger/CustomerBalances",
          query({
            date: a.date,
            customerIds: a.customerIds,
            includeOnlyOpenItems: a.includeOnlyOpenItems,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )) ?? [];
      const data = a.onlyNonZero ? all.filter((b) => (b.Balance ?? 0) !== 0) : all;
      return json({ count: data.length, data });
    }
  );

  server.tool(
    "get_open_items",
    "Unpaid customer invoices (åpne poster) as of a date — what is still outstanding.",
    {
      date: DATE.describe("As-of date, inclusive"),
      customerNos: z
        .array(z.number().int())
        .optional()
        .describe("Limit to these customer numbers (not IDs)"),
      invoiceNos: z.array(z.string()).optional().describe("Limit to these invoice numbers"),
      onlyOverdue: z
        .boolean()
        .default(false)
        .describe("Keep only items past their due date. Applied to the returned page."),
      ...paging,
    },
    async (a) => {
      const all =
        (await client.get<any[]>(
          "/Customerledger/OpenItems",
          query({
            date: a.date,
            customerNos: a.customerNos,
            invoiceNos: a.invoiceNos,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )) ?? [];
      // Overdue is relative to the as-of date, not to today — asking for open
      // items at year-end should not mark them overdue just because that date
      // has since passed. DueDate is a YYYY-MM-DD string, so comparing the
      // strings orders them correctly.
      const data = a.onlyOverdue ? all.filter((i) => i.DueDate && i.DueDate < a.date) : all;
      return json({ count: data.length, data });
    }
  );

  server.tool(
    "get_customer_statement",
    "Full customer ledger statement between two dates (all entries, paid and unpaid).",
    {
      fromDate: DATE.describe("Start date, inclusive"),
      toDate: DATE.describe("End date, inclusive"),
      customerNos: z
        .array(z.number().int())
        .optional()
        .describe("Limit to these customer numbers (not IDs)"),
      invoiceNos: z.array(z.string()).optional().describe("Limit to these invoice numbers"),
      ...paging,
    },
    async (a) =>
      json(
        (await client.get<unknown>(
          "/Customerledger/Statement",
          query({
            fromDate: a.fromDate,
            toDate: a.toDate,
            customerNos: a.customerNos,
            invoiceNos: a.invoiceNos,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )) ?? []
      )
  );
}
