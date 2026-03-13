# JIRA MCP

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that connects **Cursor AI** to your Jira Cloud workspace. Query tasks, issues, sprints, and comments directly from the IDE — no scripts, no copy-pasting, just ask.



---

## How it works

Once installed, Cursor AI gains access to your Jira data as native tools. You can ask things like:

> "What's assigned to me right now?"
> "Show me the details and comments on PROJ-42."
> "What issues are in the current sprint?"

The AI picks the right tool, calls the Jira API, and presents the results — all within the chat.

For scripting or terminal use, a CLI query script is also included.

---

## Project Structure

```
jira-mcp/
├── lib/                       Shared core (credentials, Jira API client)
│   ├── config.js              Credential loading, active-project state
│   └── jira-client.js         Authenticated fetch, data formatters, fetchers
│
├── mcp/                       MCP server (Cursor AI integration)
│   └── server.js
│
├── cli/                       CLI tools (terminal / automation)
│   ├── query.js               Query issues by status, assignee, or JQL
│   ├── bulk-move.js           Move issues between projects
│   ├── bulk-assign.js         Assign issues to yourself
│   ├── bulk-transition.js     Transition issues to a target status
│   ├── set-epic-link.js       Link issues to an epic
│   └── set-project-description.js  Set a project's description
│
├── config/                    Configuration (gitignored secrets + state)
│   ├── secrets.json           Jira credentials (local only)
│   ├── secrets.json.example   Template for secrets.json
│   └── state.json             Active project state (local only)
│
├── scripts/                   Install & link helpers
│   ├── install.sh             npm install + MCP server registration
│   └── link-to-project.sh    Symlink commands into any project
│
└── package.json
```

---

## Features

### MCP Tools (Cursor AI integration)


| Tool                 | Status | Description                                                                                                                     |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `list_projects`      | ✅      | List all Jira projects accessible to the authenticated user                                                                     |
| `list_issues`        | ✅      | List issues in a project with optional JQL filter                                                                               |
| `get_issue`          | ✅      | Full issue detail: description, comments, sprint, attachments, time tracking, subtasks, linked issues                           |
| `search_issues`      | ✅      | Search with any custom JQL query                                                                                                |
| `get_my_issues`      | ✅      | Issues currently assigned to the authenticated user                                                                             |
| `list_sprints`       | ✅      | List sprints for a project (active / future / closed)                                                                           |
| `get_sprint_issues`  | ✅      | All issues inside a specific sprint                                                                                             |
| `get_active_project` | ✅      | Read the currently active project key and board from local state                                                                |
| `set_active_project` | ✅      | Switch the active project (persisted to `config/state.json`); used by the AI on "switch to X" requests                          |
| `create_issue`       | ✅      | Create a new issue (summary, type, description, assignee, priority, labels, parent, story points); description accepts Markdown |
| `update_issue`       | ✅      | Update any field on an existing issue; only provided fields are changed; description accepts Markdown                           |
| Add comment          | 🔲     | Post a comment to an issue from the IDE                                                                                         |
| `get_transitions`    | ✅      | List available workflow transitions for an issue, including custom statuses (use before transition_issue)                       |
| `transition_issue`   | ✅      | Move an issue to a new status (e.g. In Progress → Done); supports custom statuses (e.g. Testing) with optional Markdown comment |
| `assign_issue`       | ✅      | Assign or reassign an issue to a user (or unassign by passing null)                                                             |
| `search_users`       | ✅      | Look up team members by name or email; returns accountId for use with assign/create                                             |
| Attachment download  | 🔲     | Fetch attachment content (not just metadata)                                                                                    |


### `get_issue` — returned fields


| Field                                        | Description                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `description`                                | Full issue description (plain text, converted from Atlassian Document Format); Markdown is rendered when writing |
| `comments`                                   | `[{ author, created, body }]` — who said what and when                                                           |
| `sprint`                                     | `{ id, name, state, startDate, endDate }` or `null`                                                              |
| `story_points`                               | Numeric estimate or `null`                                                                                       |
| `timetracking`                               | `{ original, remaining, spent }` or `null`                                                                       |
| `attachments`                                | `[{ filename, url, mimeType, size }]`                                                                            |
| `subtasks`                                   | `[{ key, summary, status }]`                                                                                     |
| `issuelinks`                                 | `[{ type, issue }]` — blocks / is blocked by / relates to                                                        |
| `components`                                 | Component names                                                                                                  |
| `resolution`                                 | e.g. `"Fixed"`, `"Won't Do"`, or `null`                                                                          |
| `assignee`, `reporter`, `priority`, `labels` | Standard fields                                                                                                  |


### CLI Query Script


| Command                                            | Description                                |
| -------------------------------------------------- | ------------------------------------------ |
| `npm run done`                                     | My completed issues                        |
| `npm run inprogress`                               | My in-progress issues                      |
| `npm run todo`                                     | My to-do issues                            |
| `npm run all`                                      | All my issues regardless of status         |
| `npm run query -- --project PROJ`                  | Issues from a specific project             |
| `npm run query -- --jql "..."`                     | Raw JQL query                              |
| `npm run move -- --from SRC --to DST`              | Move all issues between projects           |
| `npm run move -- --from SRC --to DST --jql "..."`  | Move filtered issues between projects      |
| `npm run assign -- --project PROJ`                 | Assign all issues in a project to yourself |
| `npm run assign -- --project PROJ --jql "..."`     | Assign filtered issues to yourself         |
| `npm run set-epic-link -- --epic EPIC --issue KEY` | Link one or more issues to an epic         |
| `npm run transition -- --to STATUS --jql "..."`    | Transition issues to a target status       |


### Setup & AI Guidance


| Feature                                    | Status | Description                                                                                              |
| ------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------- |
| Interactive `/jira-mcp/install` command     | ✅      | AI-guided setup: collects credentials, verifies API access, writes `config/secrets.json`                 |
| `/jira-mcp/jira` command                   | ✅      | Cursor AI rule telling the AI when and how to use each Jira tool                                         |
| `/jira-mcp/confluence` command             | ✅      | Cursor AI rule for querying Confluence spaces and pages                                                  |
| `/jira-mcp/jira-create-issues` command     | ✅      | Cursor AI rule for planning and creating Jira tasks and epics                                            |
| Automated install script                    | ✅      | `scripts/install.sh` — npm install + MCP server registration in one command                              |
| Symlink-based project linking               | ✅      | `scripts/link-to-project.sh` — link commands into any project                                            |
| Project-specific config gitignored          | ✅      | `config/secrets.json`, `config/state.json` are local-only; `.example` files are committed for reference  |
| Guided token generation link                | ✅      | `/jira-mcp/install` links directly to Atlassian API token page                                           |
| Multi-project support                       | ✅      | `set_active_project` / `get_active_project` tools; switch by asking the AI                               |
| Hot-reload credentials                      | ✅      | Credentials are re-read on every request — switch accounts without restarting Cursor                     |
| Auto-refresh on token expiry                | 🔲     | Detect 401 and prompt for a new token                                                                    |


---

## Quick start

### AI-assisted install (recommended)

Open any project in Cursor **Agent mode** and say:

> "Help me install https://github.com/\<user\>/jira-mcp"

The AI will clone the repo, run the setup scripts, link commands into your project, and walk you through credential configuration.

### Manual install

```bash
# 1. Clone the repo
git clone https://github.com/<user>/jira-mcp.git ~/jira-mcp

# 2. Install deps + register MCP server
bash ~/jira-mcp/scripts/install.sh

# 3. Link commands into your project
bash ~/jira-mcp/scripts/link-to-project.sh /path/to/your/project

# 4. Restart Cursor, then run in Agent mode:
/jira-mcp/install
```

The `/jira-mcp/install` command will walk you through Jira credential setup.

See [INSTALLATION.md](INSTALLATION.md) for full details and troubleshooting.

---

## Requirements

- Node.js 18+
- Cursor IDE (any version with MCP support)
- Jira Cloud account with API token
- npm packages installed (`npm install`) — required for Markdown → ADF conversion (`md-to-adf`)

---

## Security

- Credentials are stored in `config/secrets.json`, which is listed in `.gitignore` and never committed.
- The API token grants the same access as your Atlassian account — treat it like a password.
- Tokens can be revoked at any time from [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens).

---

## After installation

Your project gains **one symlink** — nothing else is copied or modified:

```
my-proj/
├── .cursor/
│   └── commands/
│       ├── jira-mcp/          ← symlink to the cloned repo (install, jira, confluence, jira-create-issues)
│       └── (your own commands, untouched)
├── src/
└── package.json
```

The MCP server, `node_modules`, and credentials stay in the cloned repo (e.g. `~/jira-mcp/`). They never enter your project directory.

---

## Why this is not a Skill

jira-mcp uses **Cursor commands** (slash commands like `/jira-mcp/jira`), not the Skill framework.

| | Commands | Skill |
|---|---|---|
| **Activation** | User explicitly runs `/jira-mcp/jira` — precise, on-demand | Agent infers from description — can miss or over-trigger |
| **Token cost** | Loads only the command you invoke (~500 tokens) | Loads the entire skill file (~2500 tokens) whenever matched |
| **Isolation** | All commands live under `jira-mcp/` — no pollution of your other commands | N/A |

Commands are more efficient and predictable for Jira workflows. The install script and link script handle setup; no Skill wrapper is needed.
