/**
 * Safety boundary.
 *
 * The server exposes bookkeeping, but stops short of anything that moves money
 * or creates an obligation toward a third party. As in the original draft-only
 * design, the guarantee is the absence of code: the tools below do not exist,
 * so no prompt, flag or configuration can reach them.
 *
 *   - No sending of invoices, credit notes or payment reminders.
 *   - No debt collection.
 *   - No POST/DELETE on /BankTransfers — payments are not initiated here.
 *   - No writes to /ClientBankAccounts — payment infrastructure is read-only.
 *
 * Within what is exposed, operations that post to the general ledger or delete
 * records require an explicit confirm flag. That is a speed bump against a
 * misread instruction, not a security control: the real control is the list
 * above.
 */

export const NOT_EXPOSED_BY_DESIGN = [
  "Sending invoices, credit notes and reminders",
  "Debt collection",
  "Creating or deleting bank transfers (payments)",
  "Creating or changing client bank accounts and bank approvers",
];

export function requireConfirm(confirm: boolean | undefined, action: string): void {
  if (confirm !== true) {
    throw new Error(
      `Refused: ${action} changes the accounts and is hard to undo. ` +
        `Re-run with confirm=true once the user has explicitly approved it.`
    );
  }
}

/** Standard MCP text result carrying a JSON payload. */
export function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Build a query string from optional values, dropping anything unset.
 * Arrays are joined with commas, which is how the Go API takes list filters.
 */
export function query(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = Array.isArray(v) ? v.join(",") : String(v);
  }
  return out;
}
