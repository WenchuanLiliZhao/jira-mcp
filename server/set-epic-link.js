#!/usr/bin/env node
/**
 * Set the parent Epic on one or more Jira issues.
 * Reads credentials from secrets.json (same dir as this script).
 *
 * Usage:
 *   node server/set-epic-link.js --epic <EPIC_KEY> --issue <ISSUE_KEY> [--issue <ISSUE_KEY> ...]
 *
 * Options:
 *   --epic  <KEY>   Epic to link issues to (required)
 *   --issue <KEY>   Issue to update; repeat for multiple issues (required)
 *   --help          Show this help text
 *
 * Examples:
 *   node server/set-epic-link.js --epic TEST-34 --issue TEST-35
 *   node server/set-epic-link.js --epic TEST-34 --issue TEST-35 --issue TEST-36 --issue TEST-37
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ── Credentials ───────────────────────────────────────────────────────────────

const dir = dirname(fileURLToPath(import.meta.url));
const secretsPath = join(dir, 'secrets.json');
if (!existsSync(secretsPath)) {
  console.error('Missing secrets.json. Copy secrets.json.example and fill in your credentials.');
  process.exit(1);
}
const secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
const { JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN } = secrets;
if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_TOKEN) {
  console.error('Missing JIRA_DOMAIN, JIRA_EMAIL, or JIRA_TOKEN in secrets.json');
  process.exit(1);
}

const JIRA_BASE = `https://${JIRA_DOMAIN}`;
const AUTH = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

// ── CLI argument parsing ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { issues: [] };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help':  args.help  = true; break;
      case '--epic':  args.epic  = argv[++i]; break;
      case '--issue': args.issues.push(argv[++i]); break;
    }
  }
  return args;
}

const HELP = `
Usage: node server/set-epic-link.js --epic <EPIC_KEY> --issue <ISSUE_KEY> [--issue ...]

Options:
  --epic  <KEY>   Epic to link issues to (required)
  --issue <KEY>   Issue to update; repeat for multiple issues (required)
  --help          Show this help text

Examples:
  node server/set-epic-link.js --epic TEST-34 --issue TEST-35
  node server/set-epic-link.js --epic TEST-34 --issue TEST-35 --issue TEST-36 --issue TEST-37
`.trim();

// ── Jira API helper ───────────────────────────────────────────────────────────

async function jiraFetch(path, opts = {}) {
  const res = await fetch(`${JIRA_BASE}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${AUTH}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(text).errorMessages?.[0] || JSON.parse(text).message || text; } catch {}
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (!opts.epic || opts.issues.length === 0) {
    console.error('Error: --epic and at least one --issue are required.\n');
    console.error(HELP);
    process.exit(1);
  }

  console.log(`Setting parent epic to ${opts.epic} on ${opts.issues.length} issue(s)...`);

  let updated = 0;
  for (const issueKey of opts.issues) {
    try {
      await jiraFetch(`/rest/api/3/issue/${issueKey}`, {
        method: 'PUT',
        body: JSON.stringify({ fields: { parent: { key: opts.epic } } }),
      });
      console.log(`  Linked ${issueKey} → ${opts.epic}`);
      updated++;
    } catch (err) {
      console.error(`  Failed ${issueKey}: ${err.message}`);
    }
  }

  console.log(`\nDone. Updated ${updated}/${opts.issues.length} issue(s).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
