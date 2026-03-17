# Install Command

Guide the user through first-time setup of Jira-MCP, step by step.
Ask for one piece of information at a time, confirm each answer before moving on,
then write all config files at the end.

**Preferred interaction style**: use the structured `ask_question` tool whenever presenting
choices or yes/no decisions. For free-form inputs (domain, email, token) ask in plain text.

## Steps

### Step 0 — Install npm dependencies

Run `npm install` in the project root (the directory containing `package.json`).
This installs the `md-to-adf` package required for Markdown rendering in Jira descriptions.

If the command fails, tell the user the error and ask them to resolve it before proceeding.
Once it succeeds, confirm: "Dependencies installed." and move on.

---

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
> Click **Create API token**, give it a name (e.g. `cursor-Jira-MCP`), and paste the token here."

Save as `JIRA_TOKEN`.

---

### Step 4 — Verify credentials

Call the `list_projects` MCP tool to verify the credentials work. If the call succeeds, briefly
confirm: "Credentials verified — I can see your Jira projects."

If the call fails, tell the user the error and offer to re-enter the domain, email, or token.

Set `PROJECT_KEY`, `BOARD_ID`, and `BOARD_NAME` all to `null`. The user will pick a project
naturally the first time they query Jira — no need to choose one now.

---

### Step 5 — Write config files

Once all answers are collected, perform ALL of the following:

1. **Write `config/secrets.json`** with:
```json
{
  "JIRA_DOMAIN": "<JIRA_DOMAIN>",
  "JIRA_EMAIL": "<JIRA_EMAIL>",
  "JIRA_TOKEN": "<JIRA_TOKEN>"
}
```

2. **Confirm to the user**:
> "Setup complete! Here's what was configured:
> - Domain: JIRA_DOMAIN
> - Email: JIRA_EMAIL
>
> You can now ask me anything about your Jira tasks.
> The first time you query, I'll ask which project you want to work with.
> To switch projects later, just say 'switch to project X'."

---

## Rules

- Ask **one question at a time**. Do not ask multiple things in a single message.
- **Use `ask_question` tool** for any question with a defined set of choices (project list, board
  list, yes/no, skip options). Use plain text only for open-ended inputs (domain, email, token).
- After each answer, briefly confirm what was received before asking the next question.
  Example: "Got it — domain is `acme.atlassian.net`. Next..."
- Never show the full API token back to the user after it's entered (treat it as a secret).
- If the user makes a mistake or wants to change an answer, allow them to correct it before writing files.
- Only write files in **Step 5**, after all answers are confirmed.
- Do not ask the user to restart Cursor. Credentials are loaded dynamically — changes to
  `secrets.json` take effect on the next MCP tool call without a restart.
