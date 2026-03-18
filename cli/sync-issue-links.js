#!/usr/bin/env node
/**
 * CLI: Sync formal Jira issue links from description references.
 * Scans each issue's description for KEY-N references and creates
 * "Relates" links for any that don't already exist in Jira.
 *
 * Usage:
 *   node cli/sync-issue-links.js [--project KEY] [--issue KEY-N] [--dry-run]
 *
 * Options:
 *   --project KEY   Project to sync (default: JL)
 *   --issue   KEY-N Sync only this single issue instead of the whole project
 *   --dry-run       Print what would be linked without making any changes
 */

import { requireSecrets } from '../lib/config.js';
import { fetchIssueDetail, linkIssues, jiraFetch } from '../lib/jira-client.js';

requireSecrets();

const argv = process.argv.slice(2);
function flag(name) { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; }

const PROJECT = flag('--project') ?? 'JL';
const SINGLE  = flag('--issue');
const DRY_RUN = argv.includes('--dry-run');

function buildPattern(project) {
  return new RegExp(`${project}-\\d+`, 'g');
}

async function getAllIssueKeys(project) {
  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql: `project = ${project} ORDER BY key ASC`,
      fields: ['key'],
      maxResults: 200,
    }),
  });
  return (data?.issues ?? []).map((i) => i.key);
}

function extractRefs(text, pattern) {
  if (!text || typeof text !== 'string') return [];
  return [...new Set(text.match(pattern) ?? [])];
}

async function getExistingLinks(issueKey) {
  const data = await jiraFetch(`/rest/api/3/issue/${issueKey}?fields=issuelinks`);
  return (data?.fields?.issuelinks ?? [])
    .map((l) => (l.inwardIssue ?? l.outwardIssue)?.key)
    .filter(Boolean);
}

async function syncLinks(targetKeys, allKeys) {
  const pattern = buildPattern(PROJECT);
  const created = new Set();
  const errors  = [];

  for (const key of targetKeys) {
    const detail   = await fetchIssueDetail(key);
    const refs     = extractRefs(detail.description, pattern);
    const existing = await getExistingLinks(key);

    for (const ref of refs) {
      if (ref === key) continue;
      if (!allKeys.includes(ref)) continue;
      if (existing.includes(ref)) continue;

      const linkId = [key, ref].sort().join('->');
      if (created.has(linkId)) continue;
      created.add(linkId);

      if (DRY_RUN) {
        console.log(`[dry-run] would link ${key} --Relates--> ${ref}`);
        continue;
      }

      try {
        await linkIssues(key, ref, 'Relates');
        console.log(`Linked ${key} --Relates--> ${ref}`);
      } catch (e) {
        if (e.message?.includes('already exists')) {
          console.log(`(skip) ${key} -> ${ref} already linked`);
        } else {
          errors.push({ key, ref, err: e.message });
        }
      }
    }
  }

  if (errors.length) console.error('\nErrors:', errors);
  if (created.size === 0) console.log('Nothing to link.');
}

async function main() {
  const allKeys    = await getAllIssueKeys(PROJECT);
  const targetKeys = SINGLE ? [SINGLE] : allKeys;
  await syncLinks(targetKeys, allKeys);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
