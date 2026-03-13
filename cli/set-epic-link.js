#!/usr/bin/env node
/**
 * CLI: set the parent Epic on one or more Jira issues.
 *
 * Usage:
 *   node cli/set-epic-link.js --epic <EPIC_KEY> --issue <ISSUE_KEY> [--issue ...]
 *
 * Options:
 *   --epic  <KEY>   Epic to link issues to (required)
 *   --issue <KEY>   Issue to update; repeat for multiple issues (required)
 *   --help          Show this help text
 */

import { requireSecrets } from '../lib/config.js';
import { jiraFetch } from '../lib/jira-client.js';

requireSecrets();

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
Usage: node cli/set-epic-link.js --epic <EPIC_KEY> --issue <ISSUE_KEY> [--issue ...]

Options:
  --epic  <KEY>   Epic to link issues to (required)
  --issue <KEY>   Issue to update; repeat for multiple issues (required)
  --help          Show this help text

Examples:
  node cli/set-epic-link.js --epic TEST-34 --issue TEST-35
  node cli/set-epic-link.js --epic TEST-34 --issue TEST-35 --issue TEST-36 --issue TEST-37
`.trim();

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
