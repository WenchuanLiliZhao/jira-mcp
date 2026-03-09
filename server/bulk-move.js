#!/usr/bin/env node
/**
 * Bulk move Jira issues from one project to another.
 * Reads credentials from secrets.json (same dir as this script).
 *
 * Usage:
 *   node server/bulk-move.js --from <SOURCE> --to <TARGET> [options]
 *
 * Options:
 *   --from <KEY>   Source project key (required)
 *   --to   <KEY>   Target project key (required)
 *   --jql  <query> JQL to select issues (default: all issues in source project)
 *   --help         Show this help text
 *
 * Examples:
 *   node server/bulk-move.js --from JM --to TEST
 *   node server/bulk-move.js --from JM --to TEST --jql "issuetype in (Epic, Task)"
 *   node server/bulk-move.js --from JM --to TEST --jql "labels = cli-test"
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
      case '--help': args.help = true; break;
      case '--from': args.from = argv[++i]; break;
      case '--to':   args.to   = argv[++i]; break;
      case '--jql':  args.jql  = argv[++i]; break;
    }
  }
  return args;
}

const HELP = `
Usage: node server/bulk-move.js --from <SOURCE> --to <TARGET> [options]

Options:
  --from <KEY>   Source project key (required)
  --to   <KEY>   Target project key (required)
  --jql  <query> JQL to select issues (default: all issues in source project)
  --help         Show this help text

Examples:
  node server/bulk-move.js --from JM --to TEST
  node server/bulk-move.js --from JM --to TEST --jql "issuetype in (Epic, Task)"
  node server/bulk-move.js --from JM --to TEST --jql "labels = cli-test"
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
    body: JSON.stringify({ jql, fields: ['summary', 'issuetype'], maxResults }),
  });
  return (data?.issues ?? []).map((issue) => ({
    key:       issue.key,
    summary:   issue.fields?.summary ?? '',
    issuetype: issue.fields?.issuetype?.name ?? '',
  }));
}

async function fetchProjectWithIssueTypes(projectKey) {
  const data = await jiraFetch(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
  return {
    key:        data.key,
    name:       data.name,
    issueTypes: (data.issueTypes ?? []).map((it) => ({ id: it.id, name: it.name })),
  };
}

// ── Bulk move ─────────────────────────────────────────────────────────────────

async function pollUntilComplete(taskId, label) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const progress = await jiraFetch(`/rest/api/3/bulk/queue/${taskId}`);
    const status = progress?.status ?? '';
    if (status === 'COMPLETE') {
      const count = progress.totalIssueCount ?? 0;
      console.log(`  Done. Moved ${count} ${label}(s).`);
      if ((progress.invalidOrInaccessibleIssueCount ?? 0) > 0) {
        console.log(`  (${progress.invalidOrInaccessibleIssueCount} could not be moved)`);
      }
      return count;
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`Bulk move ${status}: ${progress?.message ?? JSON.stringify(progress)}`);
    }
    process.stdout.write('.');
  }
  throw new Error('Bulk move timed out after 120 seconds');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (!opts.from || !opts.to) {
    console.error('Error: --from and --to are required.\n');
    console.error(HELP);
    process.exit(1);
  }

  const sourceProject = opts.from;
  const targetProject = opts.to;
  const jql = opts.jql ?? `project = ${sourceProject} ORDER BY key ASC`;

  console.log(`Source:  ${sourceProject}`);
  console.log(`Target:  ${targetProject}`);
  console.log(`JQL:     ${jql}\n`);

  const issues = await fetchIssuesByJQL(jql);
  if (issues.length === 0) {
    console.log('No issues found. Nothing to move.');
    return;
  }
  console.log(`Found ${issues.length} issue(s) to move.`);

  const targetProjectData = await fetchProjectWithIssueTypes(targetProject);
  const typeById = Object.fromEntries(targetProjectData.issueTypes.map((it) => [it.name, it.id]));

  const byType = {};
  for (const issue of issues) {
    const typeName = issue.issuetype;
    if (!typeById[typeName]) {
      console.error(`\nTarget project "${targetProject}" has no issue type "${typeName}".`);
      console.error(`Available types: ${targetProjectData.issueTypes.map((it) => it.name).join(', ')}`);
      process.exit(1);
    }
    if (!byType[typeName]) byType[typeName] = [];
    byType[typeName].push(issue.key);
  }

  // Move Epics first so child issues can be re-parented correctly, then all other types
  const allTypes = Object.keys(byType);
  const typeOrder = ['Epic', ...allTypes.filter((t) => t !== 'Epic')];

  let totalMoved = 0;
  for (const typeName of typeOrder) {
    const keys = byType[typeName];
    if (!keys?.length) continue;

    const targetKey = `${targetProject},${typeById[typeName]}`;
    const movePayload = {
      sendBulkNotification: true,
      targetToSourcesMapping: {
        [targetKey]: {
          issueIdsOrKeys:              keys,
          inferFieldDefaults:          true,
          inferStatusDefaults:         true,
          inferClassificationDefaults: true,
          inferSubtaskTypeDefault:     true,
        },
      },
    };

    const moveRes = await jiraFetch('/rest/api/3/bulk/issues/move', {
      method: 'POST',
      body: JSON.stringify(movePayload),
    });

    const taskId = moveRes?.taskId;
    if (!taskId) {
      console.error(`Bulk move for "${typeName}" did not return taskId:`, moveRes);
      process.exit(1);
    }

    console.log(`Moving ${keys.length} ${typeName}(s) (taskId: ${taskId})...`);
    totalMoved += await pollUntilComplete(taskId, typeName);
  }

  console.log(`\nTotal: ${totalMoved} issue(s) moved to ${targetProject}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
