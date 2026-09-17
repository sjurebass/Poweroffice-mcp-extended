import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodePath, type PowerOfficeClient } from "../api/client.js";
import { json, jsonList, query } from "../utils/safety.js";

/**
 * Bank — READ ONLY, deliberately.
 *
 * The Go API can create bank transfers (POST /BankTransfers) and change bank
 * accounts and approvers. None of that is exposed here: this server does not
 * move money or touch payment infrastructure. Reading is enough to reconcile,
 * to see what is queued, and to answer "did that get paid".
 *
 * Every API call in this file is a read. The write helpers are never used here.
 */

const paging = {
  pageNumber: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(1000).optional(),
};

export function registerBankTools(server: McpServer, client: PowerOfficeClient) {
  server.tool(
    "list_client_bank_accounts",
    "Bank accounts registered on the client. Read-only.",
    { bankAccountNumbers: z.array(z.string()).optional(), ...paging },
    async (a) =>
      jsonList(
        await client.get<unknown>(
          "/ClientBankAccounts",
          query({
            bankAccountNumbers: a.bankAccountNumbers,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );

  server.tool(
    "get_client_bank_account",
    "Get one client bank account by id. Read-only.",
    { id: z.string().min(1) },
    async ({ id }) => json(await client.get<unknown>(encodePath`/ClientBankAccounts/${id}`))
  );

  server.tool(
    "list_bank_approvers",
    "List the bank approvers configured on the client. Read-only.",
    {},
    async () => jsonList(await client.get<unknown>("/ClientBankAccounts/BankApprovers"))
  );

  server.tool(
    "list_bank_transfers",
    "List bank transfers (betalinger) and their status. Read-only — this server cannot create or cancel a transfer.",
    { changedSince: z.string().optional().describe("ISO 8601 timestamp"), ...paging },
    async (a) =>
      jsonList(
        await client.get<unknown>(
          "/BankTransfers",
          query({
            lastChangedDateTimeOffsetGreaterThan: a.changedSince,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );

  server.tool(
    "get_bank_transfer",
    "Get one bank transfer by id. Read-only.",
    { id: z.string().min(1) },
    async ({ id }) => json(await client.get<unknown>(encodePath`/BankTransfers/${id}`))
  );
}
