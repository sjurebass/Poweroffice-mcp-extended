import { describe, expect, it, vi, afterEach } from "vitest";
import { ClientRegistry, contextClient, currentClient } from "../src/api/registry.js";
import type { ServerConfig } from "../src/config.js";

const twoClients: ServerConfig = {
  apiUrl: "https://example.invalid",
  appKey: "app",
  subscriptionKey: "sub",
  clients: [
    { alias: "acme", label: "Acme AS", clientKey: "key-acme" },
    { alias: "bolig", label: "Bolig AS", clientKey: "key-bolig" },
  ],
};

const oneClient: ServerConfig = {
  apiUrl: "https://example.invalid",
  appKey: "app",
  subscriptionKey: "sub",
  clients: [{ alias: "solo", label: "Solo AS", clientKey: "key-solo" }],
};

afterEach(() => vi.restoreAllMocks());

describe("ClientRegistry.resolve", () => {
  it("refuses a write that does not name a company when several are configured", () => {
    const r = new ClientRegistry(twoClients);
    expect(() => r.resolve(undefined, true)).toThrow(/must name the company/);
  });

  it("refuses a read with no alias and no default when several are configured", () => {
    const r = new ClientRegistry(twoClients);
    expect(() => r.resolve(undefined, false)).toThrow(/no default is set/);
  });

  it("refuses a write without an alias even when a default exists", () => {
    const r = new ClientRegistry({ ...twoClients, defaultClient: "acme" });
    expect(() => r.resolve(undefined, true)).toThrow(/must name the company/);
    // ...but a read may use the default.
    expect(r.resolve(undefined, false).alias).toBe("acme");
  });

  it("allows an unqualified call when only one company is configured", () => {
    const r = new ClientRegistry(oneClient);
    expect(r.resolve(undefined, true).alias).toBe("solo");
  });

  it("rejects an unknown alias and names the valid ones", () => {
    const r = new ClientRegistry(twoClients);
    expect(() => r.resolve("ghost", false)).toThrow(/Unknown client "ghost".*acme, bolig/);
  });

  it("matches aliases case-insensitively", () => {
    const r = new ClientRegistry(twoClients);
    expect(r.resolve("ACME", false).alias).toBe("acme");
  });

  it("never exposes client keys through list()", () => {
    const r = new ClientRegistry(twoClients);
    expect(JSON.stringify(r.list())).not.toContain("key-acme");
  });
});

describe("company isolation", () => {
  it("refuses to act when no company context is active", () => {
    expect(() => currentClient()).toThrow(/refusing to guess/);
  });

  it("keeps concurrent calls for different companies apart", async () => {
    const registry = new ClientRegistry(twoClients);
    const proxy = contextClient();
    const seen: Array<{ expected: string; actual: string }> = [];

    // Record which company's client each interleaved call actually reached.
    const spy = vi
      .spyOn(
        Object.getPrototypeOf(registry.resolve("acme", false).api),
        "request"
      )
      .mockImplementation(async function (this: any) {
        return this;
      });

    const call = async (alias: string, delayMs: number) => {
      const resolved = registry.resolve(alias, false);
      return registry.run(resolved, async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        const reached = (await proxy.get<any>("/whatever")) as any;
        seen.push({ expected: alias, actual: reached === resolved.api ? alias : "WRONG" });
      });
    };

    // Interleave deliberately: acme waits longer, so bolig runs in between.
    await Promise.all([call("acme", 20), call("bolig", 5), call("acme", 1)]);

    expect(spy).toHaveBeenCalledTimes(3);
    expect(seen.every((s) => s.actual === s.expected)).toBe(true);
  });
});
