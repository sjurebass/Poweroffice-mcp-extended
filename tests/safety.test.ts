import { describe, expect, it } from "vitest";
import { requireConfirm, query, NOT_EXPOSED_BY_DESIGN } from "../src/utils/safety.js";

describe("requireConfirm", () => {
  it("throws unless confirm is exactly true", () => {
    expect(() => requireConfirm(undefined, "posting a voucher")).toThrow(/Refused: posting a voucher/);
    expect(() => requireConfirm(false, "posting a voucher")).toThrow(/Refused/);
    // Truthy-but-not-true must not pass.
    expect(() => requireConfirm("yes" as unknown as boolean, "posting")).toThrow(/Refused/);
    expect(() => requireConfirm(true, "posting a voucher")).not.toThrow();
  });
});

describe("query", () => {
  it("drops unset values and joins arrays with commas", () => {
    expect(
      query({ a: 1, b: undefined, c: null, d: "", e: [1, 2, 3], f: false })
    ).toEqual({ a: "1", e: "1,2,3", f: "false" });
  });
});

describe("safety boundary", () => {
  it("documents what is deliberately absent", () => {
    expect(NOT_EXPOSED_BY_DESIGN.join(" ")).toMatch(/bank transfers/i);
    expect(NOT_EXPOSED_BY_DESIGN.join(" ")).toMatch(/Sending invoices/i);
  });
});
