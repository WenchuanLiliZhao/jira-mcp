#!/usr/bin/env node
/**
 * Transition Jira issues to a target status (e.g. "Done").
 * Reads credentials from secrets.json (same dir as this script).
 *
 * Usage:
 *   node server/bulk-transition.js --to <STATUS> [--issue <KEY> ...] [--jql <query>]
 *
 * Options:
 *   --to    <STATUS>  Target status name, e.g. "Done" (required)
 *   --issue <KEY>     Issue key; repeat for multiple issues
 *   --jql   <query>   JQL to select issues (alternative to --issue)
 *   --help            Show this help text
 *
 * Examples:
 *   node server/bulk-transition.js --to Done --issue TEST-10 --issue TEST-11
 *   node server/bulk-transition.js --to "In Progress" --issue TEST-10
 *   node server/bulk-transition.js --to Done --jql "project = TEST AND sprint in openSprints()"
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
      case '--help':  args.help = true; break;
      case '--to':    args.to   = argv[++i]; break;
      case '--issue': args.issues.push(argv[++i]); break;
      case '--jql':   args.jql  = argv[++i]; break;
    }
  }
  return args;
}

const HELP = `
Usage: node server/bulk-transition.js --to <STATUS> [--issue <KEY> ...] [--jql <query>]

Options:
  --to    <STATUS>  Target status name, e.g. "Done" (required)
  --issue <KEY>     Issue key; repeat for multiple issues
  --jql   <query>   JQL to select issues (alternative to --issue)
  --help            Show this help text

Examples:
  node server/bulk-transition.js --to Done --issue TEST-10 --issue TEST-11
  node server/bulk-transition.js --to "In Progress" --issue TEST-10
  node server/bulk-transition.js --to Done --jql "project = TEST AND sprint in openSprints()"
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

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchIssuesByJQL(jql, maxResults = 1000) {
  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, fields: ['summary'], maxResults }),
  });
  return (data?.issues ?? []).map((i) => i.key);
}

/**
 * Looks up the transition ID for a given status name on a specific issue.
 * Each issue may have a different workflow, so this is called per-issue.
 */
async function getTransitionId(issueKey, targetStatusName) {
  const data = await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`);
  const match = (data?.transitions ?? []).find(
    (t) => t.name.toLowerCase() === targetStatusName.toLowerCase()
  );
  return match?.id ?? null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (!opts.to) {
    console.error('Error: --to is required.\n');
    console.error(HELP);
    process.exit(1);
  }

  if (!opts.issues.length && !opts.jql) {
    console.error('Error: provide at least one --issue or a --jql filter.\n');
    console.error(HELP);
    process.exit(1);
  }

  let keys = [...opts.issues];
  if (opts.jql) {
    console.log(`JQL: ${opts.jql}`);
    const jqlKeys = await fetchIssuesByJQL(opts.jql);
    keys = [...new Set([...keys, ...jqlKeys])];
  }

  if (keys.length === 0) {
    console.log('No issues found. Nothing to transition.');
    return;
  }

  console.log(`Transitioning ${keys.length} issue(s) to "${opts.to}"...\n`);

  let updated = 0;
  for (const key of keys) {
    try {
      const transitionId = await getTransitionId(key, opts.to);
      if (!transitionId) {
        console.error(`  Skipped ${key}: no transition named "${opts.to}" available`);
        continue;
      }
      await jiraFetch(`/rest/api/3/issue/${key}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: transitionId } }),
      });
      console.log(`  ${key} → ${opts.to}`);
      updated++;
    } catch (err) {
      console.error(`  Failed ${key}: ${err.message}`);
    }
  }

  console.log(`\nDone. Transitioned ${updated}/${keys.length} issue(s).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
