# Jira MCP — Installation Guide

Connect Cursor AI to your Jira projects so you can query tasks, issues, and sprints directly from the IDE.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18 or later |
| Cursor IDE | Any recent version (MCP support required) |
| Jira Cloud | An active Atlassian Cloud account |

---

## Step 1 — Install Dependencies

```bash
cd jira-mcp
npm install
```

---

## Step 2 — Register with Cursor

Open (or create) `~/.cursor/mcp.json` and add the `jira` entry:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp/server/mcp-server.js"]
    }
  }
}
```

To find the absolute path:
```bash
cd jira-mcp && pwd
# append /server/mcp-server.js to the output
```

---

## Step 3 — Run the Setup Command

Fully quit and reopen Cursor, then open a new chat in **Agent mode** and run:

```
/install
```

The AI will guide you through the rest — collecting your Jira credentials, selecting your project and board, and writing all config files automatically.

---

## Available Tools

| Tool | Description |
|---|---|
| `list_projects` | List all Jira projects accessible to the authenticated user |
| `list_issues` | List issues in a project (with optional JQL filter) |
| `get_issue` | Get full details for a single issue (description, comments, subtasks) |
| `search_issues` | Search using any JQL query |
| `get_my_issues` | Get all issues assigned to the current user |
| `list_sprints` | List sprints for a project (active / future / closed) |
| `get_sprint_issues` | Get all issues inside a specific sprint |

---

## Usage Examples

Once installed, ask Cursor things like:

```
Show me all in-progress issues in the ACME project.
```
```
What's in the current sprint?
```
```
Get the details for issue ACME-42.
```
```
What issues are assigned to me right now?
```

---

## Troubleshooting

### HTTP 401 Unauthorized
Your credentials are incorrect. Double-check:
- `JIRA_DOMAIN` — no `https://` prefix, no trailing slash
- `JIRA_EMAIL` — must match your Atlassian account exactly
- `JIRA_TOKEN` — copied in full, with no extra whitespace

Re-run `/install` to overwrite `server/secrets.json` with corrected values.

### Tools not appearing in Cursor
- Make sure `mcp.json` uses valid JSON (no trailing commas)
- Verify the `args` path points to `mcp-server.js` and that the file exists
- Fully restart Cursor (quit the app, reopen — not just reload window)

### `Cannot find package '@modelcontextprotocol/sdk'`
Run `npm install` inside the `jira-mcp/` directory.

### `No boards found for project XYZ`
The `list_sprints` tool requires a Jira Software **Scrum** or **Kanban** board linked to the project. Kanban boards without sprints will not return sprint data by design.

### Empty results from `list_projects`
Your API token may lack the necessary permissions. Ensure the Atlassian account associated with the token has at least **Browse Projects** permission in Jira.

---

## Security Notes

- **Never commit your API token** to version control. `server/secrets.json` is in `.gitignore`.
- The token grants the same access as your Atlassian account — treat it like a password.
- Tokens can be revoked at any time from [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
