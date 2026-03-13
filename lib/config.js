/**
 * Shared configuration: credential loading, active-project state.
 *
 * All paths resolve relative to the project root (one level above this file)
 * so that both MCP and CLI entry points share the same config directory.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_DIR = join(ROOT_DIR, 'config');

/**
 * Load Jira credentials.  Re-reads the file on every call so that
 * credential changes (e.g. via /install) take effect without restarting.
 * Environment variables take precedence over secrets.json.
 */
export function loadSecrets() {
  const secretsPath = join(CONFIG_DIR, 'secrets.json');
  let secrets = {};
  if (existsSync(secretsPath)) {
    try { secrets = JSON.parse(readFileSync(secretsPath, 'utf8')); } catch {}
  }
  return {
    JIRA_DOMAIN: process.env.JIRA_DOMAIN || secrets.JIRA_DOMAIN,
    JIRA_EMAIL:  process.env.JIRA_EMAIL  || secrets.JIRA_EMAIL,
    JIRA_TOKEN:  process.env.JIRA_TOKEN  || secrets.JIRA_TOKEN,
  };
}

/**
 * Load and validate credentials — throws if any value is missing.
 * CLI scripts call this at startup for early failure.
 */
export function requireSecrets() {
  const creds = loadSecrets();
  if (!creds.JIRA_DOMAIN || !creds.JIRA_EMAIL || !creds.JIRA_TOKEN) {
    throw new Error(
      'Missing Jira credentials. Create config/secrets.json or set JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN in env.'
    );
  }
  return creds;
}

/** Read active-project state (project key, board). */
export function loadState() {
  const statePath = join(CONFIG_DIR, 'state.json');
  if (!existsSync(statePath)) return { project: null, boardId: null, boardName: null };
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return { project: null, boardId: null, boardName: null };
  }
}

/** Persist active-project state. */
export function saveState(state) {
  const statePath = join(CONFIG_DIR, 'state.json');
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}
