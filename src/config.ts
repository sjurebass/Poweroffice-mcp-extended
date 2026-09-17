/**
 * Configuration loading.
 *
 * Two shapes are supported:
 *
 * 1. Single client (backwards compatible): POWEROFFICE_CLIENT_KEY in the
 *    environment, alongside POWEROFFICE_API_URL / _APP_KEY / _SUBSCRIPTION_KEY.
 *
 * 2. Multiple clients: POWEROFFICE_CLIENTS points at a JSON file listing one
 *    client key per Go client (company). The application key and subscription
 *    key are shared across clients; the client key is not.
 *
 *    {
 *      "apiUrl": "https://goapi.poweroffice.net",
 *      "appKey": "...",
 *      "subscriptionKey": "...",
 *      "defaultClient": "acme",
 *      "clients": {
 *        "acme":   { "label": "Acme AS",   "clientKey": "..." },
 *        "bolig":  { "label": "Bolig AS",  "clientKey": "..." }
 *      }
 *    }
 *
 * Client keys are passwords. Each one grants access to one company's books, so
 * they are never logged, never echoed in errors, and never returned by a tool.
 */

import { readFileSync } from "node:fs";

export interface ClientEntry {
  alias: string;
  label: string;
  clientKey: string;
  /** Optional per-client override; falls back to the shared value. */
  apiUrl?: string;
  appKey?: string;
  subscriptionKey?: string;
}

export interface ServerConfig {
  apiUrl: string;
  appKey: string;
  subscriptionKey: string;
  clients: ClientEntry[];
  defaultClient?: string;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

export function loadConfig(): ServerConfig {
  const clientsFile = env("POWEROFFICE_CLIENTS");

  if (!clientsFile) {
    // Single-client mode.
    return {
      apiUrl: requireValue(env("POWEROFFICE_API_URL"), "POWEROFFICE_API_URL"),
      appKey: requireValue(env("POWEROFFICE_APP_KEY"), "POWEROFFICE_APP_KEY"),
      subscriptionKey: requireValue(
        env("POWEROFFICE_SUBSCRIPTION_KEY"),
        "POWEROFFICE_SUBSCRIPTION_KEY"
      ),
      clients: [
        {
          alias: env("POWEROFFICE_CLIENT_ALIAS") ?? "default",
          label: env("POWEROFFICE_CLIENT_LABEL") ?? "default",
          clientKey: requireValue(
            env("POWEROFFICE_CLIENT_KEY"),
            "POWEROFFICE_CLIENT_KEY"
          ),
        },
      ],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(clientsFile, "utf8"));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not read POWEROFFICE_CLIENTS file: ${message}`);
  }

  const file = raw as {
    apiUrl?: string;
    appKey?: string;
    subscriptionKey?: string;
    defaultClient?: string;
    clients?: Record<
      string,
      { label?: string; clientKey?: string; apiUrl?: string; appKey?: string; subscriptionKey?: string }
    >;
  };

  const apiUrl = requireValue(file.apiUrl ?? env("POWEROFFICE_API_URL"), "apiUrl");
  const appKey = requireValue(file.appKey ?? env("POWEROFFICE_APP_KEY"), "appKey");
  const subscriptionKey = requireValue(
    file.subscriptionKey ?? env("POWEROFFICE_SUBSCRIPTION_KEY"),
    "subscriptionKey"
  );

  const entries = Object.entries(file.clients ?? {});
  if (entries.length === 0) {
    throw new Error("POWEROFFICE_CLIENTS file contains no clients");
  }

  const clients: ClientEntry[] = entries.map(([alias, value]) => {
    if (!value?.clientKey) {
      throw new Error(`Client "${alias}" is missing clientKey`);
    }
    return {
      alias,
      label: value.label ?? alias,
      clientKey: value.clientKey,
      apiUrl: value.apiUrl,
      appKey: value.appKey,
      subscriptionKey: value.subscriptionKey,
    };
  });

  const seen = new Set<string>();
  for (const c of clients) {
    const key = c.alias.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate client alias: ${c.alias}`);
    seen.add(key);
  }

  if (file.defaultClient && !clients.some((c) => c.alias === file.defaultClient)) {
    throw new Error(`defaultClient "${file.defaultClient}" is not in the clients list`);
  }

  return { apiUrl, appKey, subscriptionKey, clients, defaultClient: file.defaultClient };
}
