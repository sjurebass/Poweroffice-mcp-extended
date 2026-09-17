#!/bin/bash
# Loads credentials from ~/.poweroffice-mcp/env, then starts the MCP server on stdio.
set -a
[ -f "$HOME/.poweroffice-mcp/env" ] && . "$HOME/.poweroffice-mcp/env"
set +a
exec node "$HOME/poweroffice-go-mcp/dist/index.js"
