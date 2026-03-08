# Install Command

Guide the user through first-time setup of jira-mcp, step by step.
Ask for one piece of information at a time, confirm each answer before moving on,
then write all config files at the end.

**Preferred interaction style**: use the structured `ask_question` tool whenever presenting
choices or yes/no decisions. For free-form inputs (domain, email, token) ask in plain text.

## Steps

### Step 1 — Jira Domain

Ask:
> "What is your Jira domain? This is the subdomain of your Atlassian URL.
> For example, if you access Jira at `https://acme.atlassian.net`, enter: `acme.atlassian.net`"

Wait for the answer. Validate that it ends with `.atlassian.net` (warn if not, but allow any value).
Save as `JIRA_DOMAIN`.

---

### Step 2 — Jira Email

Ask:
> "What email address do you use to log in to Jira?"

Save as `JIRA_EMAIL`.

---

### Step 3 — Jira API Token

Ask:
> "What is your Jira API token?
> If you don't have one yet, go to: https://id.atlassian.com/manage-profile/security/api-tokens
> Click **Create API token**, give it a name (e.g. `cursor-jira-mcp`), and paste the token here."

Save as `JIRA_TOKEN`.

---

### Step 4 — Project Key

Call the `list_projects` MCP tool using the credentials collected above to fetch the user's
accessible projects. Then use the `ask_question` tool to present the choices:

```
question: "Which project would you like to use as your default?"
options: one option per project, label = "<KEY> — <name>"
allow_multiple: false
```

If `list_projects` fails, fall back to asking in plain text:
> "Could not fetch projects automatically. What is your default Jira project key? (e.g. `PROJ`)"

Save as `PROJECT_KEY`.

---

### Step 5 — Board (optional, for sprint support)

Call the `list_sprints` MCP tool with `project: PROJECT_KEY`.

If boards are found, use the `ask_question` tool with two questions in a single call:

```
question 1: "Which board should be used for sprint queries?"
  options: one option per board, label = "<ID> — <name>", plus "Skip — no sprint support"
  allow_multiple: false

question 2: "Would you like to enable sprint support?"  ← only if above is not skipped
  options: ["Yes", "No"]
  allow_multiple: false
```

If no boards are found, use the `ask_question` tool:
```
question: "No boards were found for this project. How would you like to proceed?"
options:
  - "Continue without sprint support"
  - "Enter board ID manually"
allow_multiple: false
```

If skipped or no board selected, set `BOARD_ID` and `BOARD_NAME` to null.

Save as `BOARD_ID` and `BOARD_NAME`.

---

### Step 6 — Write config files

Once all answers are collected, perform ALL of the following:

1. **Write `server/secrets.json`** with:
```json
{
  "JIRA_DOMAIN": "<JIRA_DOMAIN>",
  "JIRA_EMAIL": "<JIRA_EMAIL>",
  "JIRA_TOKEN": "<JIRA_TOKEN>"
}
```

2. **Write `server/state.json`** with:
```json
{
  "project": "<PROJECT_KEY>",
  "boardId": <BOARD_ID or null>,
  "boardName": "<BOARD_NAME or null>"
}
```

3. **Confirm to the user**:
> "Setup complete! Here's what was configured:
> - Domain: JIRA_DOMAIN
> - Email: JIRA_EMAIL
> - Active project: PROJECT_KEY
> - Board: BOARD_NAME (ID: BOARD_ID) — or 'none' if skipped
>
> You can now ask me anything about your Jira tasks. To switch projects later, just say
> 'switch to project X' — no need to re-run /install."

---

## Rules

- Ask **one question at a time**. Do not ask multiple things in a single message.
- **Use `ask_question` tool** for any question with a defined set of choices (project list, board
  list, yes/no, skip options). Use plain text only for open-ended inputs (domain, email, token).
- After each answer, briefly confirm what was received before asking the next question.
  Example: "Got it — domain is `acme.atlassian.net`. Next..."
- Never show the full API token back to the user after it's entered (treat it as a secret).
- If the user makes a mistake or wants to change an answer, allow them to correct it before writing files.
- Only write files in **Step 6**, after all answers are confirmed.
- Do not ask the user to restart Cursor — remind them only if the MCP server path in
  `~/.cursor/mcp.json` still points to an old location.
