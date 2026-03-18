#!/usr/bin/env node
/**
 * CLI: One-shot fixer for broken inline links in JL issue descriptions.
 *
 * Usage:
 *   node cli/fix-description-links.js [--dry-run]
 */

import { requireSecrets } from '../lib/config.js';
import { fetchIssueDetail, jiraFetch } from '../lib/jira-client.js';
import markdownToAdf from 'md-to-adf';

requireSecrets();

const DRY_RUN = process.argv.includes('--dry-run');

// ── URL constants ────────────────────────────────────────────────────────────

const DOMAIN = 'zhaowenchuan.atlassian.net';
const BROWSE = `https://${DOMAIN}/browse`;
const WIKI   = `https://${DOMAIN}/wiki`;

const CF = {
  jiraLens:             `${WIKI}/spaces/JL/overview`,
  basicInteractionFlow: `${WIKI}/spaces/JL/pages/6324225/Basic+Interaction+Flow`,
  archDecisions:        `${WIKI}/spaces/JL/pages/5963782/Architecture+Decisions`,
  atlascode:            'https://open-vsx.org/extension/Atlassian/atlascode',
  mcpGitHub:            'https://github.com/WenchuanLiliZhao/jira-mcp',
};

const jUrl = (key) => `${BROWSE}/${key}`;

// ── Generic fixers ───────────────────────────────────────────────────────────

/** Fix [JL-N](https SOME TEXT → [JL-N](https://url) SOME TEXT */
function fixTruncatedLinks(text) {
  return text.replace(/\[JL-(\d+)\]\(https /g, (_, n) => `[JL-${n}](${jUrl(`JL-${n}`)}) `);
}

/** Fix (JL-N) bare → ([JL-N](url)) */
function fixBareParenRef(text) {
  return text.replace(/\((?!\[)JL-(\d+)\)/g, (_, n) => `([JL-${n}](${jUrl(`JL-${n}`)}))`);
}

/** Fix ", JL-N)" → ", [JL-N](url))" (last item before closing paren) */
function fixBareCommaRef(text) {
  return text.replace(/, JL-(\d+)\)/g, (_, n) => `, [JL-${n}](${jUrl(`JL-${n}`)}))`);
}

/** Fix " and JL-N" bare → " and [JL-N](url)" */
function fixBareAndRef(text) {
  return text.replace(/( and )JL-(\d+)(?!\])/g, (_, pre, n) => `${pre}[JL-${n}](${jUrl(`JL-${n}`)})`);
}

// ── Per-issue fix functions ──────────────────────────────────────────────────

const FIXES = {
  'JL-1': (d) => {
    d = fixTruncatedLinks(d);
    d = d.replace(' Architecture Decisions', ` [Architecture Decisions](${CF.archDecisions})`);
    return d;
  },

  'JL-2': (d) => {
    d = d.replace(' Basic Interaction Flow', ` [Basic Interaction Flow](${CF.basicInteractionFlow})`);
    return d;
  },

  'JL-3': (d) => {
    d = d.replace('References Jira Lens', `References [Jira Lens](${CF.jiraLens})`);
    return d;
  },

  'JL-4': (d) => {
    d = fixBareAndRef(d);
    d = d.replace('References Jira Lens', `References [Jira Lens](${CF.jiraLens})`);
    return d;
  },

  'JL-5': (d) => {
    d = fixTruncatedLinks(d);
    d = fixBareParenRef(d);
    d = fixBareAndRef(d);
    d = d.replace('References Jira Lens', `References [Jira Lens](${CF.jiraLens})`);
    return d;
  },

  'JL-6': (d) => {
    d = fixBareAndRef(d);
    d = d.replace(' Basic Interaction Flow', ` [Basic Interaction Flow](${CF.basicInteractionFlow})`);
    return d;
  },

  'JL-7': (d) => {
    // Fix ", JL-4 (what fields..." – comma then space then paren
    d = d.replace(', JL-4 (', `, [JL-4](${jUrl('JL-4')}) (`);
    d = d.replace(' Architecture Decisions', ` [Architecture Decisions](${CF.archDecisions})`);
    return d;
  },

  'JL-8': (d) => {
    d = fixBareCommaRef(d);
    d = fixBareParenRef(d);
    d = d.replace(' Basic Interaction Flow', ` [Basic Interaction Flow](${CF.basicInteractionFlow})`);
    return d;
  },

  'JL-9': (d) => {
    d = d.replace('Atlascode on Open VSX', `[Atlascode on Open VSX](${CF.atlascode})`);
    return d;
  },

  'JL-10': (d) => {
    // "from JL-7)" → "from [JL-7](url))" — extra ) closes outer parenthetical
    d = d.replace('from JL-7)', `from [JL-7](${jUrl('JL-7')}))`);
    d = d.replace('Jira Lens MCP (GitHub)', `[Jira Lens MCP (GitHub)](${CF.mcpGitHub})`);
    return d;
  },
};

// ── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  for (const [key, fix] of Object.entries(FIXES)) {
    const detail   = await fetchIssueDetail(key);
    const original = detail.description ?? '';
    const fixed    = fix(original);

    if (fixed === original) {
      console.log(`${key}: nothing to change`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`${key}: would update`);
      continue;
    }

    await jiraFetch(`/rest/api/3/issue/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: { description: markdownToAdf(fixed) } }),
    });
    console.log(`${key}: updated`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
