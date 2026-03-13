#!/usr/bin/env node
/**
 * CLI: bulk move Jira issues from one project to another.
 *
 * Usage:
 *   node cli/bulk-move.js --from <SOURCE> --to <TARGET> [options]
 *
 * Options:
 *   --from <KEY>   Source project key (required)
 *   --to   <KEY>   Target project key (required)
 *   --jql  <query> JQL to select issues (default: all issues in source project)
 *   --help         Show this help text
 */

import { requireSecrets } from '../lib/config.js';
import { jiraFetch, fetchProjectWithIssueTypes } from '../lib/jira-client.js';

requireSecrets();

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
Usage: node cli/bulk-move.js --from <SOURCE> --to <TARGET> [options]

Options:
  --from <KEY>   Source project key (required)
  --to   <KEY>   Target project key (required)
  --jql  <query> JQL to select issues (default: all issues in source project)
  --help         Show this help text

Examples:
  node cli/bulk-move.js --from JM --to TEST
  node cli/bulk-move.js --from JM --to TEST --jql "issuetype in (Epic, Task)"
  node cli/bulk-move.js --from JM --to TEST --jql "labels = cli-test"
`.trim();

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
