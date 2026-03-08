#!/usr/bin/env node
/**
 * CLI script to query Jira issues for the current user.
 * Reads credentials from secrets.json (same dir as this script).
 *
 * Usage:
 *   node server/query-completed.js [options]
 *
 * Options:
 *   --project <KEY>      Jira project key (default: all projects)
 *   --status  <name>     Issue status to filter by (default: "Done")
 *                        Use "all" to skip status filter
 *   --assignee <value>   Assignee filter (default: currentUser())
 *   --max     <n>        Max results (default: 50)
 *   --jql     <query>    Raw JQL — overrides all other filters
 *   --fields             Show which fields are returned
 *   --help               Show this help text
 *
 * Examples:
 *   node server/query-completed.js
 *   node server/query-completed.js --status "In Progress"
 *   node server/query-completed.js --project PROJ --status all
 *   node server/query-completed.js --jql "project = PROJ AND sprint in openSprints()"
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ── Credentials ───────────────────────────────────────────────────────────────

const dir = dirname(fileURLToPath(import.meta.url));
const secretsPath = join(dir, 'secrets.json');
if (!existsSync(secretsPath)) {
  console.error('Missing secrets.json. Copy secrets.json.example to secrets.json and fill in your credentials.');
  process.exit(1);
}
const secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
const JIRA_DOMAIN = secrets.JIRA_DOMAIN;
const JIRA_EMAIL  = secrets.JIRA_EMAIL;
const JIRA_TOKEN  = secrets.JIRA_TOKEN;

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
      case '--help':    args.help = true; break;
      case '--fields':  args.showFields = true; break;
      case '--project': args.project  = argv[++i]; break;
      case '--status':  args.status   = argv[++i]; break;
      case '--assignee':args.assignee = argv[++i]; break;
      case '--max':     args.max      = parseInt(argv[++i], 10); break;
      case '--jql':     args.jql      = argv[++i]; break;
    }
  }
  return args;
}

const HELP = `
Usage: node server/query-completed.js [options]

Options:
  --project <KEY>      Jira project key (default: all projects)
  --status  <name>     Issue status, e.g. "Done", "In Progress" (default: Done)
                       Use "all" to skip status filter
  --assignee <value>   Assignee (default: currentUser())
  --max     <n>        Max results (default: 50)
  --jql     <query>    Raw JQL — overrides all other filters
  --fields             Show which fields are returned
  --help               Show this help text

Examples:
  node server/query-completed.js
  node server/query-completed.js --status "In Progress"
  node server/query-completed.js --project PROJ --status all
  node server/query-completed.js --jql "project = PROJ AND sprint in openSprints()"
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

const FIELDS = ['summary', 'status', 'assignee', 'issuetype', 'priority', 'created', 'updated'];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (opts.showFields) {
    console.log('Fields returned:', FIELDS.join(', '));
    return;
  }

  // Build JQL
  let jql;
  if (opts.jql) {
    jql = opts.jql;
  } else {
    const clauses = [];
    if (opts.project)  clauses.push(`project = ${opts.project}`);
    const assignee = opts.assignee ?? 'currentUser()';
    clauses.push(`assignee = ${assignee}`);
    const status = opts.status ?? 'Done';
    if (status !== 'all') clauses.push(`status = "${status}"`);
    jql = clauses.join(' AND ') + ' ORDER BY updated DESC';
  }

  console.error(`JQL: ${jql}\n`);

  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, fields: FIELDS, maxResults: opts.max ?? 50 }),
  });

  const issues = (data?.issues ?? []).map((i) => {
    const f = i.fields ?? {};
    return {
      key:       i.key,
      summary:   f.summary ?? '',
      status:    f.status?.name ?? '',
      issuetype: f.issuetype?.name ?? '',
      priority:  f.priority?.name ?? '',
      updated:   f.updated?.slice(0, 10) ?? '',
    };
  });

  console.log(JSON.stringify(issues, null, 2));
  console.error(`\nTotal: ${issues.length} issue(s)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
