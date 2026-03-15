#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JIRA_LENS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_JSON="$HOME/.cursor/mcp.json"
SERVER_PATH="$JIRA_LENS_ROOT/mcp/server.js"

# --- Check Node.js ---
if ! command -v node &>/dev/null; then
  echo "[jira-lens] Error: Node.js is not installed. Install Node 18+ first."
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "[jira-lens] Error: Node.js >= 18 required (found v$(node -v))."
  exit 1
fi

# --- Install npm dependencies ---
echo "[jira-lens] Installing dependencies..."
npm install --prefix "$JIRA_LENS_ROOT" --silent
echo "[jira-lens] Dependencies installed."

# --- Ensure config directory exists ---
mkdir -p "$JIRA_LENS_ROOT/config"

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
  console.log('[jira-lens] MCP server already registered in ' + path + ' — skipped.');
} else {
  config.mcpServers.jira = { command: 'node', args: [serverPath] };
  fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  console.log('[jira-lens] Registered MCP server in ' + path);
}
"

echo "[jira-lens] Done. Restart Cursor to activate the Jira tools."
