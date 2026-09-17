/**
 * Multi-client registry.
 *
 * PowerOffice issues one client key per Go client (company), and an access
 * token is scoped to exactly one client key. PowerOffice's own guidance warns
 * that sharing token state between clients risks reading or writing the wrong
 * company's books, so isolation here is structural:
 *
 *   - One PowerOfficeClient instance per configured client alias. Each owns its
 *     own token cache and its own rate limiter. Nothing is shared.
 *   - The client for a given tool call is resolved once, at call time, and
 *     carried through an AsyncLocalStorage context for the duration of that
 *     call. Concurrent calls for different companies cannot observe each
 *     other's context.
 *   - Tool modules talk to a proxy that reads the current context. A tool that
 *     somehow runs outside a resolved context throws rather than falling back
 *     to a default company.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { PowerOfficeClient } from "./client.js";
import type { ClientEntry, ServerConfig } from "../config.js";

export interface ResolvedClient {
  alias: string;
  label: string;
  api: PowerOfficeClient;
}

const context = new AsyncLocalStorage<ResolvedClient>();

export class ClientRegistry {
  private readonly config: ServerConfig;
  private readonly instances = new Map<string, ResolvedClient>();

  constructor(config: ServerConfig) {
    this.config = config;
    for (const entry of config.clients) {
      this.instances.set(entry.alias.toLowerCase(), {
        alias: entry.alias,
        label: entry.label,
        api: new PowerOfficeClient({
          apiUrl: entry.apiUrl ?? config.apiUrl,
          appKey: entry.appKey ?? config.appKey,
          clientKey: entry.clientKey,
          subscriptionKey: entry.subscriptionKey ?? config.subscriptionKey,
        }),
      });
    }
  }

  /** Public, non-sensitive description of the configured clients. */
  list(): Array<{ alias: string; label: string; isDefault: boolean }> {
    return this.config.clients.map((c: ClientEntry) => ({
      alias: c.alias,
      label: c.label,
      isDefault: this.defaultAlias() === c.alias,
    }));
  }

  get size(): number {
    return this.instances.size;
  }

  private defaultAlias(): string | undefined {
    if (this.config.defaultClient) return this.config.defaultClient;
    if (this.config.clients.length === 1) return this.config.clients[0].alias;
    return undefined;
  }

  /**
   * Resolve an alias to a client.
   *
   * `isWrite` tightens the rules: a write must always name its company
   * explicitly when more than one is configured, even if a default exists.
   * Booking to the wrong company is expensive to discover and tedious to
   * reverse, so the ambiguity is refused up front.
   */
  resolve(alias: string | undefined, isWrite: boolean): ResolvedClient {
    const known = this.list()
      .map((c) => c.alias)
      .join(", ");

    if (!alias) {
      if (isWrite && this.instances.size > 1) {
        throw new Error(
          `This tool writes to the accounts, so it must name the company. ` +
            `Pass client="<alias>". Configured: ${known}`
        );
      }
      const fallback = this.defaultAlias();
      if (!fallback) {
        throw new Error(
          `More than one company is configured and no default is set. ` +
            `Pass client="<alias>". Configured: ${known}`
        );
      }
      return this.instances.get(fallback.toLowerCase())!;
    }

    const found = this.instances.get(alias.toLowerCase());
    if (!found) {
      throw new Error(`Unknown client "${alias}". Configured: ${known}`);
    }
    return found;
  }

  /** Run `fn` with `resolved` as the active client for its whole async extent. */
  run<T>(resolved: ResolvedClient, fn: () => T): T {
    return context.run(resolved, fn);
  }
}

export function currentClient(): ResolvedClient {
  const active = context.getStore();
  if (!active) {
    throw new Error(
      "No PowerOffice client resolved for this call — refusing to guess which company to use."
    );
  }
  return active;
}

/**
 * A PowerOfficeClient-shaped object that forwards to whichever company is
 * active for the current call. Tool modules take this, so none of them need to
 * know that multiple companies exist.
 */
export function contextClient(): PowerOfficeClient {
  const forward = {
    request: (...args: Parameters<PowerOfficeClient["request"]>) =>
      currentClient().api.request(...args),
    get: (...args: Parameters<PowerOfficeClient["get"]>) => currentClient().api.get(...args),
    post: (...args: Parameters<PowerOfficeClient["post"]>) => currentClient().api.post(...args),
    patch: (...args: Parameters<PowerOfficeClient["patch"]>) => currentClient().api.patch(...args),
    delete: (...args: Parameters<PowerOfficeClient["delete"]>) =>
      currentClient().api.delete(...args),
    upload: (...args: Parameters<PowerOfficeClient["upload"]>) =>
      currentClient().api.upload(...args),
  };
  return forward as unknown as PowerOfficeClient;
}
