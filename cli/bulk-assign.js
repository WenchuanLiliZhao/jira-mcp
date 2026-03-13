#!/usr/bin/env node
/**
 * CLI: assign Jira issues in a project to the authenticated user.
 *
 * Usage:
 *   node cli/bulk-assign.js --project <KEY> [options]
 *
 * Options:
 *   --project <KEY>  Project key (required)
 *   --jql <query>    JQL to select issues (default: all issues in project)
 *   --help           Show this help text
 */

import { requireSecrets } from '../lib/config.js';
import { jiraFetch } from '../lib/jira-client.js';

requireSecrets();

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
Usage: node cli/bulk-assign.js --project <KEY> [options]

Options:
  --project <KEY>  Project key (required)
  --jql <query>    JQL to select issues (default: all issues in project)
  --help           Show this help text

Examples:
  node cli/bulk-assign.js --project TEST
  node cli/bulk-assign.js --project TEST --jql "issuetype = Epic"
  node cli/bulk-assign.js --project TEST --jql "labels = cli-test"
`.trim();

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
