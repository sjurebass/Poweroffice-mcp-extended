import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodePath, type PowerOfficeClient } from "../api/client.js";
import { json, query, requireConfirm } from "../utils/safety.js";

/**
 * Time tracking (timeføring).
 *
 * Four related record types share one shape in the API, so they share one set
 * of tools here with a `kind` parameter:
 *
 *   entryTime    — hours booked by an employee (the timesheet line)
 *   entryItem    — quantities/items booked alongside hours
 *   activityTime — the catalogue of time activities you can book against
 *   activityItem — the catalogue of item activities
 *
 * Hour types (timearter) are separate and get their own tools.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const KINDS = {
  entryTime: "EntryTime",
  entryItem: "EntryItem",
  activityTime: "ActivityTime",
  activityItem: "ActivityItem",
} as const;

const kind = z
  .enum(["entryTime", "entryItem", "activityTime", "activityItem"])
  .describe(
    "entryTime = booked hours, entryItem = booked items, " +
      "activityTime/activityItem = the activity catalogue you book against"
  );

const paging = {
  pageNumber: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(1000).optional(),
};

export function registerTimeTrackingTools(server: McpServer, client: PowerOfficeClient) {
  server.tool(
    "list_time_records",
    "List time tracking records of a given kind. Use kind=activityTime to discover what can be booked against.",
    {
      kind,
      changedSince: z.string().optional().describe("ISO 8601 timestamp"),
      includeInactive: z.boolean().optional().describe("Activity catalogues only"),
      ...paging,
    },
    async (a) =>
      json(
        await client.get<unknown>(
          encodePath`/TimeTracking/${KINDS[a.kind]}`,
          query({
            lastChangedDateTimeOffsetGreaterThan: a.changedSince,
            includeInactive: a.includeInactive,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );

  server.tool(
    "get_time_record",
    "Get one time tracking record by id.",
    { kind, id: z.string().min(1) },
    async ({ kind: k, id }) =>
      json(await client.get<unknown>(encodePath`/TimeTracking/${KINDS[k]}/${id}`))
  );

  server.tool(
    "create_time_entry",
    "Book hours for an employee (timeføring). activityTimeId comes from list_time_records with kind=activityTime.",
    {
      employeeId: z.number().int().positive(),
      activityTimeId: z.number().int().positive(),
      date: DATE,
      quantity: z.number().int().optional().describe("Hours booked"),
      billableQuantity: z.number().int().optional().describe("Hours to invoice"),
      fromTime: z.string().optional().describe("HH:mm"),
      toTime: z.string().optional().describe("HH:mm"),
      breakTime: z.number().int().optional().describe("Minutes"),
      customerId: z.number().int().optional(),
      projectId: z.number().int().optional(),
      departmentId: z.number().int().optional(),
      hourTypeId: z.number().int().optional(),
      internalComment: z.string().optional(),
      externalComment: z.string().optional().describe("Visible to the customer on an invoice"),
    },
    async (a) => {
      const body: Record<string, unknown> = {
        EmployeeId: a.employeeId,
        ActivityTimeId: a.activityTimeId,
        Date: a.date,
      };
      if (a.quantity !== undefined) body.Quantity = a.quantity;
      if (a.billableQuantity !== undefined) body.BillableQuantity = a.billableQuantity;
      if (a.fromTime) body.FromTime = a.fromTime;
      if (a.toTime) body.ToTime = a.toTime;
      if (a.breakTime !== undefined) body.BreakTime = a.breakTime;
      if (a.customerId !== undefined) body.CustomerId = a.customerId;
      if (a.projectId !== undefined) body.ProjectId = a.projectId;
      if (a.departmentId !== undefined) body.DepartmentId = a.departmentId;
      if (a.hourTypeId !== undefined) body.HourTypeId = a.hourTypeId;
      if (a.internalComment) body.InternalComment = a.internalComment;
      if (a.externalComment) body.ExternalComment = a.externalComment;
      return json(await client.post<unknown>("/TimeTracking/EntryTime", body));
    }
  );

  server.tool(
    "update_time_entry",
    "Change a booked time entry.",
    {
      id: z.string().min(1),
      date: DATE.optional(),
      quantity: z.number().int().optional(),
      billableQuantity: z.number().int().optional(),
      projectId: z.number().int().optional(),
      internalComment: z.string().optional(),
      externalComment: z.string().optional(),
    },
    async (a) => {
      const patch: Record<string, unknown> = {};
      if (a.date) patch.Date = a.date;
      if (a.quantity !== undefined) patch.Quantity = a.quantity;
      if (a.billableQuantity !== undefined) patch.BillableQuantity = a.billableQuantity;
      if (a.projectId !== undefined) patch.ProjectId = a.projectId;
      if (a.internalComment !== undefined) patch.InternalComment = a.internalComment;
      if (a.externalComment !== undefined) patch.ExternalComment = a.externalComment;
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
      return json(await client.patch<unknown>(encodePath`/TimeTracking/EntryTime/${a.id}`, patch));
    }
  );

  server.tool(
    "delete_time_record",
    "Delete a time tracking record. Requires confirm=true.",
    { kind, id: z.string().min(1), confirm: z.boolean().optional() },
    async ({ kind: k, id, confirm }) => {
      requireConfirm(confirm, `deleting ${k} record ${id}`);
      await client.delete<void>(encodePath`/TimeTracking/${KINDS[k]}/${id}`);
      return json({ deleted: true, kind: k, id });
    }
  );

  server.tool(
    "create_time_activity",
    "Add an activity to the time tracking catalogue (kind=activityTime) or the item catalogue (kind=activityItem).",
    {
      kind: z.enum(["activityTime", "activityItem"]),
      name: z.string().min(1),
      isActive: z.boolean().default(true),
      productId: z.number().int().optional(),
      projectId: z.number().int().optional(),
    },
    async (a) => {
      const body: Record<string, unknown> = { Name: a.name, IsActive: a.isActive };
      if (a.productId !== undefined) body.ProductId = a.productId;
      if (a.projectId !== undefined) body.ProjectId = a.projectId;
      return json(await client.post<unknown>(encodePath`/TimeTracking/${KINDS[a.kind]}`, body));
    }
  );

  server.tool(
    "list_hour_types",
    "Timearter: hour types configured on the client (id 0 is the synthetic 'Regular hours').",
    { ...paging },
    async (a) =>
      json(
        await client.get<unknown>(
          "/TimeTracking/HourType",
          query({ PageNumber: a.pageNumber, PageSize: a.pageSize })
        )
      )
  );

  server.tool(
    "list_time_transactions",
    "Time transactions between two dates — the reporting view over booked time.",
    {
      fromDate: DATE,
      toDate: DATE,
      onlyApproved: z.boolean().optional(),
      ...paging,
    },
    async (a) =>
      json(
        await client.get<unknown>(
          "/TimeTransactions",
          query({
            fromDate: a.fromDate,
            toDate: a.toDate,
            onlyApproved: a.onlyApproved,
            PageNumber: a.pageNumber,
            PageSize: a.pageSize,
          })
        )
      )
  );
}
