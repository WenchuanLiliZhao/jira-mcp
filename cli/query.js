#!/usr/bin/env node
/**
 * CLI: query Jira issues for the current user.
 *
 * Usage:
 *   node cli/query.js [options]
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
 */

import { requireSecrets } from '../lib/config.js';
import { jiraFetch } from '../lib/jira-client.js';

requireSecrets();

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
Usage: node cli/query.js [options]

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
  node cli/query.js
  node cli/query.js --status "In Progress"
  node cli/query.js --project PROJ --status all
  node cli/query.js --jql "project = PROJ AND sprint in openSprints()"
`.trim();

const FIELDS = ['summary', 'status', 'assignee', 'issuetype', 'priority', 'created', 'updated'];

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
