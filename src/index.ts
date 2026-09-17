#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { loadConfig } from "./config.js";

try {
  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`poweroffice-go MCP failed to start: ${message}`);
  process.exit(1);
}
