import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodePath, type PowerOfficeClient } from "../api/client.js";
import { json, query, requireConfirm } from "../utils/safety.js";

/**
 * Suppliers, supplier ledger and incoming invoices.
 *
 * Incoming invoices are read-only in the Go API — to record a purchase you
 * create a supplierInvoice voucher (see vouchers.ts), which is where the
 * bookkeeping actually happens.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const paging = {
  pageNumber: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(1000).optional(),
};

export function registerSupplierTools(server: McpServer, client: PowerOfficeClient) {
  server.tool(
    "list_suppliers",
    "List suppliers (leverandører) on the client, with optional filters.",
    {
      supplierNos: z.array(z.number().int()).optional(),
      organizationNumbers: z.array(z.string()).optional(),
      emailAddresses: z.array(z.string()).optional(),
      changedSince: z.string().optional().describe("ISO 8601 timestamp"),
      ...paging,
    },
    async (a) =>
      json(
        await client.get<unknown>(
          "/Suppliers",
          query({
            supplierNos: a.supplierNos,
            organizationNumbers: a.organizationNumbers,
            emailAddresses: a.emailAddresses,
            lastChangedDateTimeOffsetGreaterThan: a.changedSince,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );

  server.tool(
    "get_supplier",
    "Get one supplier by id.",
    { id: z.string().min(1) },
    async ({ id }) => json(await client.get<unknown>(encodePath`/Suppliers/${id}`))
  );

  server.tool(
    "create_supplier",
    "Create a supplier. Give either legalName/name for a company, or firstName/lastName with isPerson=true.",
    {
      name: z.string().optional().describe("Display name"),
      legalName: z.string().optional().describe("Registered legal name"),
      organizationNumber: z.string().optional(),
      isPerson: z.boolean().default(false),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      emailAddress: z.string().email().optional(),
      phoneNumber: z.string().optional(),
      currencyCode: z.string().length(3).optional(),
      number: z.number().int().optional().describe("Supplier number — assigned automatically if omitted"),
      paymentTermSupplierId: z.string().optional(),
    },
    async (a) => {
      if (!a.name && !a.legalName && !(a.firstName && a.lastName)) {
        throw new Error("Provide name, legalName, or firstName + lastName");
      }
      const body: Record<string, unknown> = { IsPerson: a.isPerson };
      if (a.name) body.Name = a.name;
      if (a.legalName) body.LegalName = a.legalName;
      if (a.organizationNumber) body.OrganizationNumber = a.organizationNumber;
      if (a.firstName) body.FirstName = a.firstName;
      if (a.lastName) body.LastName = a.lastName;
      if (a.emailAddress) body.EmailAddress = a.emailAddress;
      if (a.phoneNumber) body.PhoneNumber = a.phoneNumber;
      if (a.currencyCode) body.CurrencyCode = a.currencyCode;
      if (a.number !== undefined) body.Number = a.number;
      if (a.paymentTermSupplierId) body.PaymentTermSupplierId = a.paymentTermSupplierId;
      return json(await client.post<unknown>("/Suppliers", body));
    }
  );

  server.tool(
    "update_supplier",
    "Change an existing supplier.",
    {
      id: z.string().min(1),
      name: z.string().optional(),
      legalName: z.string().optional(),
      emailAddress: z.string().email().optional(),
      phoneNumber: z.string().optional(),
      organizationNumber: z.string().optional(),
      isArchived: z.boolean().optional(),
      paymentTermSupplierId: z.string().optional(),
    },
    async (a) => {
      const patch: Record<string, unknown> = {};
      if (a.name !== undefined) patch.Name = a.name;
      if (a.legalName !== undefined) patch.LegalName = a.legalName;
      if (a.emailAddress !== undefined) patch.EmailAddress = a.emailAddress;
      if (a.phoneNumber !== undefined) patch.PhoneNumber = a.phoneNumber;
      if (a.organizationNumber !== undefined) patch.OrganizationNumber = a.organizationNumber;
      if (a.isArchived !== undefined) patch.IsArchived = a.isArchived;
      if (a.paymentTermSupplierId !== undefined)
        patch.PaymentTermSupplierId = a.paymentTermSupplierId;
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
      return json(await client.patch<unknown>(encodePath`/Suppliers/${a.id}`, patch));
    }
  );

  server.tool(
    "delete_supplier",
    "Delete a supplier. Only possible while it has no transactions — archive it instead otherwise. Requires confirm=true.",
    { id: z.string().min(1), confirm: z.boolean().optional() },
    async ({ id, confirm }) => {
      requireConfirm(confirm, `deleting supplier ${id}`);
      await client.delete<void>(encodePath`/Suppliers/${id}`);
      return json({ deleted: true, id });
    }
  );

  server.tool(
    "list_supplier_payment_terms",
    "List supplier payment terms (betalingsbetingelser) configured on the client.",
    {},
    async () => json(await client.get<unknown>("/PaymentTermSuppliers"))
  );

  server.tool(
    "list_incoming_invoices",
    "Posted incoming invoices (inngående fakturaer). Read-only — record new purchases with create_voucher_draft using voucherType=supplierInvoice.",
    {
      fromDate: DATE.optional(),
      toDate: DATE.optional(),
      onlyUnpaidInvoices: z.boolean().optional(),
      supplierNos: z.array(z.number().int()).optional(),
      voucherNos: z.array(z.number().int()).optional(),
      projectCodes: z.array(z.string()).optional(),
      ...paging,
    },
    async (a) =>
      json(
        await client.get<unknown>(
          "/IncomingInvoices",
          query({
            fromDate: a.fromDate,
            toDate: a.toDate,
            onlyUnpaidInvoices: a.onlyUnpaidInvoices,
            supplierNos: a.supplierNos,
            voucherNos: a.voucherNos,
            projectCodes: a.projectCodes,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );

  server.tool(
    "get_incoming_invoice",
    "Get one posted incoming invoice by id.",
    { id: z.string().min(1) },
    async ({ id }) => json(await client.get<unknown>(encodePath`/IncomingInvoices/${id}`))
  );

  server.tool(
    "get_supplier_balances",
    "Leverandørreskontro: what we owe each supplier as of a date.",
    {
      date: DATE.describe("Balance date, inclusive"),
      includeOnlyOpenItems: z.boolean().optional(),
      ...paging,
    },
    async (a) =>
      json(
        await client.get<unknown>(
          "/Supplierledger/SupplierBalances",
          query({
            date: a.date,
            includeOnlyOpenItems: a.includeOnlyOpenItems,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );

  server.tool(
    "get_supplier_open_items",
    "Unpaid supplier invoices (åpne poster) as of a date — the bills still outstanding.",
    {
      date: DATE,
      supplierNos: z.array(z.number().int()).optional(),
      invoiceNos: z.array(z.string()).optional(),
      ...paging,
    },
    async (a) =>
      json(
        await client.get<unknown>(
          "/Supplierledger/OpenItems",
          query({
            date: a.date,
            supplierNos: a.supplierNos,
            invoiceNos: a.invoiceNos,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );

  server.tool(
    "get_supplier_statement",
    "Full supplier ledger statement between two dates.",
    {
      fromDate: DATE,
      toDate: DATE,
      supplierNos: z.array(z.number().int()).optional(),
      ...paging,
    },
    async (a) =>
      json(
        await client.get<unknown>(
          "/Supplierledger/Statement",
          query({
            fromDate: a.fromDate,
            toDate: a.toDate,
            supplierNos: a.supplierNos,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );
}
