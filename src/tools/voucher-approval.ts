import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { encodePath, type PowerOfficeClient } from "../api/client.js";
import { json, jsonList, query, requireConfirm } from "../utils/safety.js";

/**
 * Voucher approval and documentation.
 *
 * Approval here means the client has routed a voucher to this integration and
 * is waiting for a verdict. Approving is an internal act with no external
 * effect, but it does release a voucher for posting, so it is confirm-gated.
 */

export function registerVoucherApprovalTools(server: McpServer, client: PowerOfficeClient) {
  server.tool(
    "list_vouchers_for_approval",
    "List vouchers the client has sent to this integration for approval.",
    {
      pageNumber: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().max(1000).optional(),
    },
    async (a) =>
      jsonList(
        await client.get<unknown>(
          "/VoucherApproval",
          query({ PageNumber: a.pageNumber, PageSize: a.pageSize })
        )
      )
  );

  server.tool(
    "respond_to_voucher_approval",
    "Approve or reject a voucher waiting for approval. Requires confirm=true.",
    {
      voucherId: z.string().min(1),
      status: z.enum(["Approve", "Reject"]),
      comment: z.string().min(1).describe("Reason — required by the API"),
      confirm: z.boolean().optional(),
    },
    async (a) => {
      requireConfirm(a.confirm, `${a.status.toLowerCase()}ing voucher ${a.voucherId}`);
      return json(
        await client.post<unknown>(encodePath`/VoucherApproval/${a.voucherId}`, {
          VoucherApprovalStatus: a.status,
          Comment: a.comment,
        })
      );
    }
  );

  server.tool(
    "list_voucher_documentation",
    "List the documentation (bilagsdokumentasjon) attached to posted vouchers.",
    {
      voucherNo: z.number().int().optional().describe("Filter to one voucher number"),
      id: z.string().optional(),
      pageNumber: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().max(1000).optional(),
    },
    async (a) =>
      jsonList(
        await client.get<unknown>(
          "/VoucherDocumentation",
          query({
            voucherNo: a.voucherNo,
            id: a.id,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );

  server.tool(
    "replace_voucher_documentation",
    "Replace the PDF documentation on a posted voucher. The previous document is overwritten, so this requires confirm=true.",
    {
      id: z.string().min(1).describe("Voucher documentation id"),
      filePath: z.string().min(1).describe("Absolute path to a local PDF"),
      confirm: z.boolean().optional(),
    },
    async ({ id, filePath, confirm }) => {
      requireConfirm(confirm, `replacing the documentation on voucher ${id}`);
      const data = readFileSync(filePath);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(data)]), filePath.split("/").pop() ?? "file.pdf");
      return json(
        await client.upload<unknown>(
          `/VoucherDocumentation?id=${encodeURIComponent(id)}`,
          form,
          "PUT"
        )
      );
    }
  );
}
