import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodePath, type PowerOfficeClient } from "../api/client.js";
import { json, query } from "../utils/safety.js";
import type { ClientRegistry } from "../api/registry.js";
import { NOT_EXPOSED_BY_DESIGN } from "../utils/safety.js";

/**
 * Which companies this server can reach, and who the current key belongs to.
 *
 * list_companies is answered from local configuration and never leaks a client
 * key. The ClientAdmin tools below only work when the key in use belongs to a
 * PowerOffice partner (accounting firm); on an ordinary client key they return
 * a 401/403, which is the correct answer rather than a bug.
 */

export function registerClientTools(
  server: McpServer,
  client: PowerOfficeClient,
  registry: ClientRegistry
) {
  server.tool(
    "list_companies",
    "List the companies (Go clients) this server is configured for, with the alias to pass as the `client` argument on every other tool. Start here when working across several companies.",
    {},
    async () =>
      json({
        companies: registry.list(),
        note:
          registry.size > 1
            ? "Write operations must name the company explicitly via the client argument."
            : "Only one company is configured; the client argument is optional.",
        notExposedByDesign: NOT_EXPOSED_BY_DESIGN,
      })
  );

  server.tool(
    "get_integration_info",
    "What PowerOffice says about the integration behind the current client key — which client it is attached to and which privileges it has. Use this to confirm you are pointed at the company you think you are.",
    {},
    async () => json(await client.get<unknown>("/ClientIntegrationInformation"))
  );

  server.tool(
    "list_partner_clients",
    "Accounting firms only: list the Go clients the partner has access to. Requires a partner client key with the ClientAdmin privilege; an ordinary client key will be rejected by PowerOffice.",
    {
      pageNumber: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().max(1000).optional(),
    },
    async (a) =>
      json(
        await client.get<unknown>(
          "/ClientAdmin/Clients",
          query({ PageNumber: a.pageNumber, PageSize: a.pageSize })
        )
      )
  );

  server.tool(
    "get_partner_client_users",
    "Accounting firms only: list the users on one of the partner's clients.",
    { clientId: z.string().min(1) },
    async ({ clientId }) =>
      json(await client.get<unknown>(encodePath`/ClientAdmin/${clientId}/Users`))
  );

  server.tool(
    "get_partner_client_access_roles",
    "Accounting firms only: the access roles defined on one of the partner's clients.",
    { clientId: z.string().min(1) },
    async ({ clientId }) =>
      json(await client.get<unknown>(encodePath`/ClientAdmin/${clientId}/AccessRoles`))
  );
}
