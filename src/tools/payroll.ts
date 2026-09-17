import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodePath, type PowerOfficeClient } from "../api/client.js";
import { json, jsonList, query, requireConfirm } from "../utils/safety.js";

/**
 * Payroll.
 *
 * Salary lines are the payroll input — what an employee is to be paid for in a
 * period. Running payroll, producing A-melding and paying out are not part of
 * the Go API surface exposed here, so a salary line created through this server
 * is prepared work that a human still runs in Go.
 *
 * Salary data is sensitive personal data. These tools return exactly what was
 * asked for; nothing is cached or written to disk beyond the audit log, which
 * records arguments rather than responses.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const paging = {
  pageNumber: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(1000).optional(),
};

export function registerPayrollTools(server: McpServer, client: PowerOfficeClient) {
  server.tool(
    "list_pay_items",
    "Lønnsarter: the pay items available on the client. Needed to create a salary line.",
    {
      codes: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
      ...paging,
    },
    async (a) =>
      jsonList(
        await client.get<unknown>(
          "/PayItems",
          query({
            codes: a.codes,
            isActive: a.isActive,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );

  server.tool(
    "get_pay_item",
    "Get one pay item by id.",
    { id: z.string().min(1) },
    async ({ id }) => json(await client.get<unknown>(encodePath`/PayItems/${id}`))
  );

  server.tool(
    "get_payroll_settings",
    "Payroll settings for the client, optionally including pension schemes.",
    { includePensionSchemes: z.boolean().default(false) },
    async ({ includePensionSchemes }) => {
      const settings = await client.get<unknown>("/PayrollSettings");
      if (!includePensionSchemes) return json(settings);
      const pension = await client.get<unknown>("/PayrollSettings/PensionSchemes");
      return json({ settings, pensionSchemes: pension });
    }
  );

  server.tool(
    "list_salary_lines",
    "List salary lines (lønnslinjer) registered on the client.",
    { ...paging },
    async (a) =>
      jsonList(
        await client.get<unknown>(
          "/SalaryLines",
          query({ PageNumber: a.pageNumber, PageSize: a.pageSize })
        )
      )
  );

  server.tool(
    "get_salary_line",
    "Get one salary line by id.",
    { id: z.string().min(1) },
    async ({ id }) => json(await client.get<unknown>(encodePath`/SalaryLines/${id}`))
  );

  server.tool(
    "create_salary_line",
    "Create a salary line for an employee. This is payroll input, not a payment — payroll is still run by a human in Go. Requires confirm=true.",
    {
      employeeId: z.number().int().positive(),
      payItemId: z.string().min(1).describe("Pay item id from list_pay_items"),
      amount: z.number().optional(),
      quantity: z.number().optional(),
      rate: z.number().optional(),
      fromDate: DATE.optional(),
      toDate: DATE.optional(),
      comment: z.string().optional(),
      departmentId: z.number().int().optional(),
      projectId: z.number().int().optional(),
      confirm: z.boolean().optional().describe("Must be true — this affects an employee's pay"),
    },
    async (a) => {
      requireConfirm(
        a.confirm,
        `creating a salary line for employee ${a.employeeId}` +
          (a.amount !== undefined ? ` of ${a.amount}` : "")
      );
      const body: Record<string, unknown> = {
        EmployeeId: a.employeeId,
        PayItemId: a.payItemId,
      };
      if (a.amount !== undefined) body.Amount = a.amount;
      if (a.quantity !== undefined) body.Quantity = a.quantity;
      if (a.rate !== undefined) body.Rate = a.rate;
      if (a.fromDate) body.FromDate = a.fromDate;
      if (a.toDate) body.ToDate = a.toDate;
      if (a.comment) body.Comment = a.comment;
      if (a.departmentId !== undefined) body.DepartmentId = a.departmentId;
      if (a.projectId !== undefined) body.ProjectId = a.projectId;
      return json(await client.post<unknown>("/SalaryLines", body));
    }
  );

  server.tool(
    "update_salary_line",
    "Change an existing salary line. Requires confirm=true.",
    {
      id: z.string().min(1),
      amount: z.number().optional(),
      quantity: z.number().optional(),
      rate: z.number().optional(),
      comment: z.string().optional(),
      fromDate: DATE.optional(),
      toDate: DATE.optional(),
      confirm: z.boolean().optional(),
    },
    async (a) => {
      requireConfirm(a.confirm, `updating salary line ${a.id}`);
      const patch: Record<string, unknown> = {};
      if (a.amount !== undefined) patch.Amount = a.amount;
      if (a.quantity !== undefined) patch.Quantity = a.quantity;
      if (a.rate !== undefined) patch.Rate = a.rate;
      if (a.comment !== undefined) patch.Comment = a.comment;
      if (a.fromDate) patch.FromDate = a.fromDate;
      if (a.toDate) patch.ToDate = a.toDate;
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
      return json(await client.patch<unknown>(encodePath`/SalaryLines/${a.id}`, patch));
    }
  );

  server.tool(
    "delete_salary_line",
    "Delete a salary line. Requires confirm=true.",
    { id: z.string().min(1), confirm: z.boolean().optional() },
    async ({ id, confirm }) => {
      requireConfirm(confirm, `deleting salary line ${id}`);
      await client.delete<void>(encodePath`/SalaryLines/${id}`);
      return json({ deleted: true, id });
    }
  );
}
