# CLI Scripts

This directory contains the MCP server (`mcp-server.js`) and a set of standalone CLI scripts for performing bulk Jira operations directly from the terminal.

---

## Scripts

| Script | npm shortcut | Description |
|--------|-------------|-------------|
| `query-completed.js` | `npm run query` | Query issues by status, assignee, or raw JQL |
| `bulk-move.js` | `npm run move` | Move issues from one project to another |
| `bulk-assign.js` | `npm run assign` | Assign issues in a project to yourself |
| `set-epic-link.js` | `npm run set-epic-link` | Set the parent epic on one or more issues |
| `set-project-description.js` | `npm run set-project-description` | Set a project's description |

---

## Design Principles

All CLI scripts in this directory follow the same conventions. These were established during an intentional generalization pass to make every script safe to publish and reuse across any Jira Cloud workspace.

### 1. No hardcoded project names or IDs

Scripts must never embed private project keys (like `JM` or `TEST`) as default values. A script that silently falls back to a specific project only works for one person's workspace. Instead:

- Required parameters have no default. Missing them prints `--help` and exits with a non-zero code.
- Optional parameters (like `--jql`) have documented, workspace-agnostic defaults.

### 2. Named flags, not positional arguments

All parameters use `--flag <value>` style, consistent with how npm scripts are composed and extended:

```bash
# Good
node server/bulk-move.js --from JM --to TEST --jql "issuetype = Epic"

# Avoid
node server/bulk-move.js JM TEST
```

Named flags are self-documenting, order-independent, and easier to extend without breaking existing callers.

### 3. Every script has `--help`

Each script defines a `HELP` constant and checks for `--help` before doing any API work. This makes the script usable without reading source code.

### 4. JQL as the universal filter

Where a script operates on a set of issues, it always accepts a `--jql` parameter. This avoids building in bespoke filter options (status, type, label…) and instead delegates to Jira's native query language, which is already expressive and well-documented.

```bash
# Move only epics
npm run move -- --from SRC --to DST --jql "issuetype = Epic"

# Assign only unresolved issues
npm run assign -- --project PROJ --jql "project = PROJ AND resolution = Unresolved"
```

### 5. Never assume issue types

`bulk-move.js` originally hardcoded `['Epic', 'Task']` and silently skipped `Story`, `Bug`, and any other types. The generalized version collects every type actually present in the result set and moves each one in a separate API call, with Epics always processed first to preserve parent–child relationships.

### 6. Reuse the `jiraFetch` helper

Every script that makes HTTP calls defines (or will define) a single `jiraFetch(path, opts)` function that handles auth, error parsing, and JSON decoding in one place. Inline `fetch` calls elsewhere in the same file are a bug.

### 7. Shared credential loading

All scripts load credentials from `server/secrets.json` in the same way:

```js
const secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
const { JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN } = secrets;
```

Environment variables take precedence in `mcp-server.js`; CLI scripts use `secrets.json` directly for simplicity.

### 8. Fail fast, fail loudly

- Missing required flags → print help, `process.exit(1)`
- Missing `secrets.json` → clear message, `process.exit(1)`
- API errors → surface Jira's error message, not a generic HTTP status

Partial failures (e.g. one issue in a batch fails to update) are logged per-item and do not abort the rest of the batch.

---

## Adding a New Script

When writing a new CLI script, follow this checklist:

- [ ] `--help` flag with a `HELP` constant at the top
- [ ] All required parameters use `--flag` style with no hardcoded defaults
- [ ] Optional filtering via `--jql`
- [ ] Single `jiraFetch` helper — no inline `fetch` calls in `main()`
- [ ] Credential loading matches the pattern above
- [ ] Entry added to `package.json` scripts
- [ ] One-liner added to the CLI table in the root `README.md`
