#!/usr/bin/env node
/**
 * Assign Jira issues in a project to the authenticated user.
 * Reads credentials from secrets.json (same dir as this script).
 *
 * Usage:
 *   node server/bulk-assign.js --project <KEY> [options]
 *
 * Options:
 *   --project <KEY>  Project key (required)
 *   --jql <query>    JQL to select issues (default: all issues in project)
 *   --help           Show this help text
 *
 * Examples:
 *   node server/bulk-assign.js --project TEST
 *   node server/bulk-assign.js --project TEST --jql "issuetype = Epic"
 *   node server/bulk-assign.js --project TEST --jql "labels = cli-test"
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
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help':    args.help    = true; break;
      case '--project': args.project = argv[++i]; break;
      case '--jql':     args.jql     = argv[++i]; break;
    }
  }
  return args;
}

const HELP = `
Usage: node server/bulk-assign.js --project <KEY> [options]

Options:
  --project <KEY>  Project key (required)
  --jql <query>    JQL to select issues (default: all issues in project)
  --help           Show this help text

Examples:
  node server/bulk-assign.js --project TEST
  node server/bulk-assign.js --project TEST --jql "issuetype = Epic"
  node server/bulk-assign.js --project TEST --jql "labels = cli-test"
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

  if (!opts.project) {
    console.error('Error: --project is required.\n');
    console.error(HELP);
    process.exit(1);
  }

  const me = await jiraFetch('/rest/api/3/myself');
  const accountId = me?.accountId;
  if (!accountId) {
    console.error('Could not get current user.');
    process.exit(1);
  }
  console.log(`Assigning to: ${me.displayName} (${me.emailAddress})`);

  const jql = opts.jql ?? `project = ${opts.project} ORDER BY key ASC`;
  console.log(`JQL: ${jql}\n`);

  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, fields: ['summary', 'assignee'], maxResults: 1000 }),
  });
  const issues = data?.issues ?? [];
  if (issues.length === 0) {
    console.log('No issues found. Nothing to assign.');
    return;
  }
  console.log(`Found ${issues.length} issue(s). Assigning...`);

  let assigned = 0;
  let skipped  = 0;
  for (const issue of issues) {
    const key = issue.key;
    if (issue.fields?.assignee?.accountId === accountId) {
      skipped++;
      continue;
    }
    try {
      await jiraFetch(`/rest/api/3/issue/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ fields: { assignee: { accountId } } }),
      });
      assigned++;
      process.stdout.write('.');
    } catch (err) {
      console.error(`\nFailed ${key}: ${err.message}`);
    }
  }

  console.log(`\nDone. Assigned ${assigned} issue(s) (${skipped} already yours).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
