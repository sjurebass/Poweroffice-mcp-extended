import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ClientRegistry, contextClient } from "./api/registry.js";
import type { ServerConfig } from "./config.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerProductTools } from "./tools/products.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { registerValidationTools } from "./tools/validate.js";
import { registerOutgoingInvoiceTools } from "./tools/outgoing-invoices.js";
import { registerLedgerTools } from "./tools/ledger.js";
import { registerEmployeeTools } from "./tools/employees.js";
import { registerDimensionTools } from "./tools/dimensions.js";
import { registerSettingsTools } from "./tools/settings.js";
import { registerProspectTools } from "./tools/prospects.js";
import { registerAccountingTools } from "./tools/accounting.js";
import { registerVoucherTools } from "./tools/vouchers.js";
import { registerVoucherPostingTools } from "./tools/voucher-posting.js";
import { registerVoucherApprovalTools } from "./tools/voucher-approval.js";
import { registerSupplierTools } from "./tools/suppliers.js";
import { registerPayrollTools } from "./tools/payroll.js";
import { registerTimeTrackingTools } from "./tools/time-tracking.js";
import { registerBankTools } from "./tools/bank.js";
import { registerClientTools } from "./tools/clients.js";
import { withAudit } from "./utils/audit-log.js";

/**
 * Tools whose names begin with one of these verbs write to the client's data.
 * They must name their company explicitly when more than one is configured —
 * see ClientRegistry.resolve.
 */
const WRITE_PREFIXES = [
  "create_",
  "update_",
  "delete_",
  "archive_",
  "add_",
  "post_",
  "reverse_",
  "submit_",
  "replace_",
  "respond_",
  "convert_",
];

function isWriteTool(name: string): boolean {
  return WRITE_PREFIXES.some((p) => name.startsWith(p));
}

/** Tools answered from local state, which must not resolve a company. */
const LOCAL_TOOLS = new Set(["list_companies"]);

export function createServer(config: ServerConfig): McpServer {
  const server = new McpServer({
    name: "poweroffice-go",
    version: "0.4.0",
  });

  const registry = new ClientRegistry(config);
  const multiClient = registry.size > 1;

  const clientParam = z
    .string()
    .optional()
    .describe(
      multiClient
        ? "Which company to act on — an alias from list_companies. Required for anything that writes."
        : "Company alias. Optional: only one company is configured."
    );

  /**
   * Every tool registration passes through here, which:
   *   1. adds the `client` argument to the tool's schema,
   *   2. resolves that alias to one company's API client,
   *   3. runs the handler inside that company's context, and
   *   4. audit-logs the call.
   *
   * Doing it centrally means an individual tool module cannot forget to scope
   * itself to a company, and cannot reach a different company than the one the
   * caller named.
   */
  const originalTool = server.tool.bind(server) as any;
  (server as any).tool = (...registerArgs: any[]) => {
    const toolName = registerArgs[0] as string;
    const handler = registerArgs[registerArgs.length - 1];
    const isLocal = LOCAL_TOOLS.has(toolName);

    if (typeof handler === "function") {
      // The schema, when present, is the argument before the handler.
      const schemaIndex = registerArgs.length - 2;
      const schema = registerArgs[schemaIndex];
      const hasSchema = schema && typeof schema === "object" && !Array.isArray(schema);

      if (!isLocal) {
        if (hasSchema) {
          registerArgs[schemaIndex] = { ...schema, client: clientParam };
        } else {
          // (name, description, handler) — insert a schema carrying just `client`.
          registerArgs.splice(registerArgs.length - 1, 0, { client: clientParam });
        }
      }

      const scoped = async (args: any, extra: any) => {
        if (isLocal) return handler(args, extra);
        const { client: alias, ...rest } = args ?? {};
        const resolved = registry.resolve(alias, isWriteTool(toolName));
        return registry.run(resolved, () => handler(rest, extra));
      };

      registerArgs[registerArgs.length - 1] = withAudit(toolName, scoped);
    }
    return originalTool(...registerArgs);
  };

  // Tool modules receive a proxy that forwards to whichever company the current
  // call resolved to, so no module holds a reference to a specific company.
  const client = contextClient();

  registerClientTools(server, client, registry);

  // Sales side (unchanged from 0.3.0: read + drafts only).
  registerCustomerTools(server, client);
  registerProductTools(server, client);
  registerInvoiceTools(server, client);
  registerValidationTools(server, client);
  registerOutgoingInvoiceTools(server, client);
  registerLedgerTools(server, client);
  registerProspectTools(server, client);

  // Shared reference data.
  registerEmployeeTools(server, client);
  registerDimensionTools(server, client);
  registerSettingsTools(server, client);

  // Added in 0.4.0.
  registerAccountingTools(server, client);
  registerVoucherTools(server, client);
  registerVoucherPostingTools(server, client);
  registerVoucherApprovalTools(server, client);
  registerSupplierTools(server, client);
  registerPayrollTools(server, client);
  registerTimeTrackingTools(server, client);
  registerBankTools(server, client);

  return server;
}
