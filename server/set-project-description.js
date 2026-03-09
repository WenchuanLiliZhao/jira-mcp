#!/usr/bin/env node
/**
 * Set a Jira project's description.
 * Reads credentials from secrets.json (same dir as this script).
 *
 * Usage:
 *   node server/set-project-description.js --project <KEY> --description "<text>"
 *   node server/set-project-description.js --project <KEY> --file <path>
 *
 * Options:
 *   --project <KEY>      Project key (required)
 *   --description <text> Description text (use with --description)
 *   --file <path>        Read description from file (use instead of --description)
 *   --help               Show this help text
 *
 * Examples:
 *   node server/set-project-description.js --project TEST --description "My project"
 *   node server/set-project-description.js --project TEST --file ./desc.txt
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': args.help = true; break;
      case '--project': args.project = argv[++i]; break;
      case '--description': args.description = argv[++i]; break;
      case '--file': args.file = argv[++i]; break;
    }
  }
  return args;
}

const HELP = `
Usage: node server/set-project-description.js --project <KEY> [--description "<text>" | --file <path>]

Options:
  --project <KEY>      Project key (required)
  --description <text> Description text
  --file <path>        Read description from file
  --help               Show this help text
`.trim();

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

  let description;
  if (opts.file) {
    if (!existsSync(opts.file)) {
      console.error(`Error: File not found: ${opts.file}`);
      process.exit(1);
    }
    description = readFileSync(opts.file, 'utf8').trim();
  } else if (opts.description !== undefined) {
    description = opts.description;
  } else {
    console.error('Error: --description or --file is required.\n');
    console.error(HELP);
    process.exit(1);
  }

  await jiraFetch(`/rest/api/3/project/${encodeURIComponent(opts.project)}`, {
    method: 'PUT',
    body: JSON.stringify({ description }),
  });

  console.log(`Updated project ${opts.project} description.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
