#!/usr/bin/env node
/**
 * CLI: set a Jira project's description.
 *
 * Usage:
 *   node cli/set-project-description.js --project <KEY> --description "<text>"
 *   node cli/set-project-description.js --project <KEY> --file <path>
 *
 * Options:
 *   --project <KEY>      Project key (required)
 *   --description <text> Description text (use with --description)
 *   --file <path>        Read description from file (use instead of --description)
 *   --help               Show this help text
 */

import { readFileSync, existsSync } from 'fs';
import { requireSecrets } from '../lib/config.js';
import { jiraFetch } from '../lib/jira-client.js';

requireSecrets();

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
Usage: node cli/set-project-description.js --project <KEY> [--description "<text>" | --file <path>]

Options:
  --project <KEY>      Project key (required)
  --description <text> Description text
  --file <path>        Read description from file
  --help               Show this help text
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
