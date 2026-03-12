#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JIRA_MCP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_JSON="$HOME/.cursor/mcp.json"
SERVER_PATH="$JIRA_MCP_ROOT/server/mcp-server.js"

# --- Check Node.js ---
if ! command -v node &>/dev/null; then
  echo "[jira-mcp] Error: Node.js is not installed. Install Node 18+ first."
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "[jira-mcp] Error: Node.js >= 18 required (found v$(node -v))."
  exit 1
fi

# --- Install npm dependencies ---
echo "[jira-mcp] Installing dependencies..."
npm install --prefix "$JIRA_MCP_ROOT" --silent
echo "[jira-mcp] Dependencies installed."

# --- Register MCP server in ~/.cursor/mcp.json ---
mkdir -p "$(dirname "$MCP_JSON")"

node -e "
const fs = require('fs');
const path = '$MCP_JSON';
const serverPath = '$SERVER_PATH';

let config = { mcpServers: {} };
if (fs.existsSync(path)) {
  try { config = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
  if (!config.mcpServers) config.mcpServers = {};
}

if (config.mcpServers.jira) {
  console.log('[jira-mcp] MCP server already registered in ' + path + ' — skipped.');
} else {
  config.mcpServers.jira = { command: 'node', args: [serverPath] };
  fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  console.log('[jira-mcp] Registered MCP server in ' + path);
}
"

echo "[jira-mcp] Done. Restart Cursor to activate the Jira tools."
