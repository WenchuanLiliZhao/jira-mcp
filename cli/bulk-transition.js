#!/usr/bin/env node
/**
 * CLI: transition Jira issues to a target status (e.g. "Done").
 *
 * Usage:
 *   node cli/bulk-transition.js --to <STATUS> [--issue <KEY> ...] [--jql <query>]
 *
 * Options:
 *   --to    <STATUS>  Target status name, e.g. "Done" (required)
 *   --issue <KEY>     Issue key; repeat for multiple issues
 *   --jql   <query>   JQL to select issues (alternative to --issue)
 *   --help            Show this help text
 */

import { requireSecrets } from '../lib/config.js';
import { jiraFetch } from '../lib/jira-client.js';

requireSecrets();

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
Usage: node cli/bulk-transition.js --to <STATUS> [--issue <KEY> ...] [--jql <query>]

Options:
  --to    <STATUS>  Target status name, e.g. "Done" (required)
  --issue <KEY>     Issue key; repeat for multiple issues
  --jql   <query>   JQL to select issues (alternative to --issue)
  --help            Show this help text

Examples:
  node cli/bulk-transition.js --to Done --issue TEST-10 --issue TEST-11
  node cli/bulk-transition.js --to "In Progress" --issue TEST-10
  node cli/bulk-transition.js --to Done --jql "project = TEST AND sprint in openSprints()"
`.trim();

async function fetchKeysByJQL(jql) {
  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, fields: ['summary'], maxResults: 1000 }),
  });
  return (data?.issues ?? []).map((i) => i.key);
}

async function getTransitionId(issueKey, targetStatusName) {
  const data = await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`);
  const match = (data?.transitions ?? []).find(
    (t) => t.name.toLowerCase() === targetStatusName.toLowerCase()
  );
  return match?.id ?? null;
}

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
    const jqlKeys = await fetchKeysByJQL(opts.jql);
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
