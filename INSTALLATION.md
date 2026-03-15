# Jira Lens — Installation Guide

Connect Cursor AI to your Jira Cloud and Confluence so you can query tasks, issues, sprints, and pages directly from the IDE.

---

## AI-Assisted Install (recommended)

Open any project in Cursor, switch to **Agent mode**, and say:

```
Help me install https://github.com/<user>/jira-lens
```

The AI will follow the steps below automatically.

---

## Step-by-step Guide

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18 or later |
| Cursor IDE | Any recent version (MCP support required) |
| Jira Cloud | An active Atlassian Cloud account |

### 1. Clone the repository

```bash
git clone https://github.com/<user>/jira-lens.git ~/jira-lens
```

Clone to any location you like. `~/jira-lens` is used as an example throughout this guide.

### 2. Run the install script

```bash
bash ~/jira-lens/scripts/install.sh
```

This does two things:
- Installs npm dependencies (`@modelcontextprotocol/sdk`, `md-to-adf`)
- Registers the MCP server in `~/.cursor/mcp.json`

### 3. Link commands into your project

```bash
bash ~/jira-lens/scripts/link-to-project.sh /path/to/your/project
```

This creates one symlink in your project:
- `.cursor/commands/jira-lens/` — all Jira and Confluence commands

To preview what will be linked: add `--list`.
To remove the link later: add `--unlink`.

### 4. Restart Cursor

Fully quit and reopen Cursor so it picks up the new MCP server from `mcp.json`.
This is only needed once — credential changes take effect immediately.

### 5. Configure credentials

Open a chat in **Agent mode** and run:

```
/jira-lens/install
```

The AI will walk you through entering your Jira domain, email, and API token. If you don't have an API token yet, create one at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens).

---

## For AI Agents

When a user asks you to install jira-lens, follow these steps:

1. **Clone** the repo to `~/jira-lens/` (or a path the user specifies)
2. **Run** `bash <repo>/scripts/install.sh` — installs deps and registers MCP server
3. **Run** `bash <repo>/scripts/link-to-project.sh <current-project-path>` — symlinks commands into the project
4. **Tell the user** to restart Cursor (quit and reopen)
5. **After restart**, run the `/jira-lens/install` command to configure Jira credentials

---

## Available Commands (after linking)

| Command | Description |
|---|---|
| `/jira-lens/install` | Interactive credential setup |
| `/jira-lens/jira` | Query Jira issues, sprints, and tasks |
| `/jira-lens/confluence` | Query Confluence spaces and pages |
| `/jira-lens/jira-create-issues` | Plan and create Jira tasks and epics |

---

## Troubleshooting

### HTTP 401 Unauthorized
Your credentials are incorrect. Double-check:
- `JIRA_DOMAIN` — no `https://` prefix, no trailing slash
- `JIRA_EMAIL` — must match your Atlassian account exactly
- `JIRA_TOKEN` — copied in full, with no extra whitespace

Re-run `/jira-lens/install` to overwrite credentials. Changes take effect immediately — no restart needed.

### Tools not appearing in Cursor
- Make sure `~/.cursor/mcp.json` uses valid JSON (no trailing commas)
- Verify the `args` path points to `mcp/server.js` and that the file exists
- Fully restart Cursor (quit the app, reopen — not just reload window)

### `Cannot find package '@modelcontextprotocol/sdk'`
Run `npm install` inside the jira-lens directory, or re-run `scripts/install.sh`.

### `No boards found for project XYZ`
The `list_sprints` tool requires a Jira Software **Scrum** or **Kanban** board linked to the project.

### Empty results from `list_projects`
Your API token may lack permissions. Ensure the account has at least **Browse Projects** permission in Jira.

---

## Unlinking

To remove jira-lens from a project without affecting other projects:

```bash
bash ~/jira-lens/scripts/link-to-project.sh --unlink /path/to/your/project
```

To fully uninstall, also remove the `jira` entry from `~/.cursor/mcp.json` and delete the cloned repo.

---

## Security

- Credentials are stored in `config/secrets.json`, which is in `.gitignore` and never committed.
- The API token grants the same access as your Atlassian account — treat it like a password.
- Tokens can be revoked at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens).
