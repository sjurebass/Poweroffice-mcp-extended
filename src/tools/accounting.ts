import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodePath, type PowerOfficeClient } from "../api/client.js";
import { json, query, requireConfirm } from "../utils/safety.js";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const paging = {
  pageNumber: z.number().int().positive().optional().describe("1-based page number"),
  pageSize: z.number().int().positive().max(1000).optional().describe("Rows per page"),
};

export function registerAccountingTools(server: McpServer, client: PowerOfficeClient) {
  server.tool(
    "get_trial_balance",
    "Saldobalanse: account balances as of a date. The starting point for closing the books, checking VAT, or answering 'what is on account X'.",
    {
      date: DATE.describe("Balance date, inclusive (YYYY-MM-DD)"),
      accountNos: z.array(z.number().int()).optional().describe("Limit to these account numbers"),
      departmentCodes: z.array(z.string()).optional(),
      projectCode: z.string().optional(),
      hideAccountsWithZeroBalance: z.boolean().default(true),
      includeSubProject: z.boolean().optional(),
      ...paging,
    },
    async (a) => {
      const result = await client.get<unknown>(
        "/TrialBalance",
        query({
          date: a.date,
          accountNos: a.accountNos,
          departmentCodes: a.departmentCodes,
          projectCode: a.projectCode,
          hideAccountsWithZeroBalance: a.hideAccountsWithZeroBalance,
          includeSubProject: a.includeSubProject,
          PageNumber: a.pageNumber,
          PageSize: a.pageSize,
        })
      );
      return json(result);
    }
  );

  server.tool(
    "list_account_transactions",
    "Hovedbokstransaksjoner: every posting between two dates, filterable by account, voucher, project, department or VAT code.",
    {
      fromDate: DATE,
      toDate: DATE,
      accountNos: z.array(z.number().int()).optional(),
      voucherNos: z.array(z.number().int()).optional(),
      voucherTypes: z.array(z.string()).optional(),
      projectCodes: z.array(z.string()).optional(),
      departmentCodes: z.array(z.string()).optional(),
      vatCodes: z.array(z.string()).optional(),
      ...paging,
    },
    async (a) => {
      const result = await client.get<unknown>(
        "/AccountTransactions",
        query({
          fromDate: a.fromDate,
          toDate: a.toDate,
          accountNos: a.accountNos,
          voucherNos: a.voucherNos,
          voucherTypes: a.voucherTypes,
          projectCodes: a.projectCodes,
          departmentCodes: a.departmentCodes,
          vatCodes: a.vatCodes,
          PageNumber: a.pageNumber,
          PageSize: a.pageSize,
        })
      );
      return json(result);
    }
  );

  server.tool(
    "list_gl_accounts",
    "Kontoplan: the client's general ledger accounts. Use this to find the right account number before posting anything.",
    {
      accountNos: z.array(z.number().int()).optional(),
      ...paging,
    },
    async (a) =>
      json(
        await client.get<unknown>(
          "/GeneralLedgerAccounts",
          query({ accountNos: a.accountNos, PageNumber: a.pageNumber, PageSize: a.pageSize })
        )
      )
  );

  server.tool(
    "get_gl_account",
    "Get one general ledger account by its internal id.",
    { id: z.string().min(1).describe("General ledger account id") },
    async ({ id }) => json(await client.get<unknown>(encodePath`/GeneralLedgerAccounts/${id}`))
  );

  server.tool(
    "create_gl_account",
    "Add an account to the chart of accounts. Changes the client's accounting setup — requires confirm=true.",
    {
      accountNo: z.number().int().positive().describe("Account number, e.g. 6552"),
      name: z.string().min(1),
      isActive: z.boolean().default(true),
      vatCodeId: z.number().int().optional(),
      currencyCode: z.string().length(3).optional(),
      isProjectRequired: z.boolean().optional(),
      isDepartmentRequired: z.boolean().optional(),
      confirm: z.boolean().optional().describe("Must be true — this changes the chart of accounts"),
    },
    async (a) => {
      requireConfirm(a.confirm, `creating account ${a.accountNo} "${a.name}"`);
      const body: Record<string, unknown> = {
        AccountNo: a.accountNo,
        Name: a.name,
        IsActive: a.isActive,
      };
      if (a.vatCodeId !== undefined) body.VatCodeId = a.vatCodeId;
      if (a.currencyCode) body.CurrencyCode = a.currencyCode;
      if (a.isProjectRequired !== undefined) body.IsProjectRequired = a.isProjectRequired;
      if (a.isDepartmentRequired !== undefined) body.IsDepartmentRequired = a.isDepartmentRequired;
      return json(await client.post<unknown>("/GeneralLedgerAccounts", body));
    }
  );

  server.tool(
    "update_gl_account",
    "Change an existing general ledger account. Requires confirm=true.",
    {
      id: z.string().min(1),
      name: z.string().optional(),
      isActive: z.boolean().optional(),
      vatCodeId: z.number().int().optional(),
      isProjectRequired: z.boolean().optional(),
      isDepartmentRequired: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    async (a) => {
      requireConfirm(a.confirm, `updating general ledger account ${a.id}`);
      const patch: Record<string, unknown> = {};
      if (a.name !== undefined) patch.Name = a.name;
      if (a.isActive !== undefined) patch.IsActive = a.isActive;
      if (a.vatCodeId !== undefined) patch.VatCodeId = a.vatCodeId;
      if (a.isProjectRequired !== undefined) patch.IsProjectRequired = a.isProjectRequired;
      if (a.isDepartmentRequired !== undefined) patch.IsDepartmentRequired = a.isDepartmentRequired;
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
      return json(await client.patch<unknown>(encodePath`/GeneralLedgerAccounts/${a.id}`, patch));
    }
  );

  server.tool(
    "delete_gl_account",
    "Delete a general ledger account. Only possible while it is unused. Requires confirm=true.",
    { id: z.string().min(1), confirm: z.boolean().optional() },
    async ({ id, confirm }) => {
      requireConfirm(confirm, `deleting general ledger account ${id}`);
      await client.delete<void>(encodePath`/GeneralLedgerAccounts/${id}`);
      return json({ deleted: true, id });
    }
  );

  server.tool(
    "get_financial_settings",
    "Financial settings for the client, including the conversion date.",
    {},
    async () => json(await client.get<unknown>("/FinancialSettings"))
  );

  server.tool(
    "get_lock_date",
    "Bokføringssperre: the date the books are locked up to. Anything on or before this date cannot be posted.",
    { includeHistory: z.boolean().default(false).describe("Also return the lock date history") },
    async ({ includeHistory }) => {
      const current = await client.get<unknown>("/LockDateSettings");
      if (!includeHistory) return json(current);
      const history = await client.get<unknown>("/LockDateSettings/history");
      return json({ current, history });
    }
  );

  server.tool(
    "get_vat_settings",
    "MVA-innstillinger for the client (VAT periods, registration status).",
    {},
    async () => json(await client.get<unknown>("/VatSettings"))
  );

  server.tool(
    "get_currency_rate",
    "Currency rate between two currencies on a given date.",
    {
      fromCurrency: z.string().length(3).describe("e.g. EUR"),
      toCurrency: z.string().length(3).describe("e.g. NOK"),
      asOnDate: DATE,
    },
    async (a) =>
      json(
        await client.get<unknown>(
          "/CurrencyRates",
          query({ fromCurrency: a.fromCurrency, toCurrency: a.toCurrency, asOnDate: a.asOnDate })
        )
      )
  );

  server.tool(
    "list_sub_ledger_number_series",
    "Sub-ledger number series (customer/supplier number ranges) configured on the client.",
    {},
    async () => json(await client.get<unknown>("/SubLedgerNumberSeries"))
  );
}
