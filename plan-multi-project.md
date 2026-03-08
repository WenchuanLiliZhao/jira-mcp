# Plan: Multi-Project Support (Option C)

## Goal

Allow switching the "active project" without re-running `/install`, by persisting project state
in a `server/state.json` file and exposing two new MCP tools so the AI can read and write it
on demand.

---

## Design Overview

```
secrets.json   — credentials (unchanged)
state.json     — active project + board (new, gitignored)
```

The AI, when answering a Jira question, calls `get_active_project` to learn which project to
scope queries to. The user can say "switch to ENG project" and the AI calls `set_active_project`
— no manual file editing, no `/install` re-run.

---

## Files Changed / Created

| File | Action | Notes |
|------|--------|-------|
| `server/state.json` | Create (gitignored) | Runtime state; written by `set_active_project` |
| `server/state.json.example` | Create (committed) | Template so new users know the schema |
| `server/mcp-server.js` | Edit | Load state.json; add 2 new tools |
| `.cursor/commands/install.md` | Edit | Write `state.json` in Step 6 instead of embedding project in `query.md` |
| `.cursor/commands/jira/query.md.example` | Edit | Remove hardcoded project; add instruction to call `get_active_project` first |
| `.cursor/commands/jira/query.md` | Edit | Same as above, applied to the live file |
| `.gitignore` | Edit | Add `server/state.json` |
| `README.md` | Edit | Mark Multi-project support ✅ |

---

## Step-by-Step Implementation

### Step 1 — `server/state.json.example`

New file committed to the repo as a schema reference:

```json
{
  "project": "YOUR_PROJECT",
  "boardId": null,
  "boardName": null
}
```

### Step 2 — `server/mcp-server.js`

**2a. Load state.json** (alongside `loadSecrets()`):

```js
function loadState() {
  const dir = dirname(fileURLToPath(import.meta.url));
  const statePath = join(dir, 'state.json');
  if (!existsSync(statePath)) return { project: null, boardId: null, boardName: null };
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return {}; }
}
```

**2b. Add `writeFileSync` to the `fs` import.**

**2c. Add 2 new tool definitions** to the `TOOLS` array:

```js
{
  name: 'get_active_project',
  description: 'Returns the currently active Jira project and board from local state. Call this before any project-scoped query if the user has not specified a project explicitly.',
  inputSchema: { type: 'object', properties: {}, required: [] },
},
{
  name: 'set_active_project',
  description: 'Sets the active Jira project (and optional board) so future queries default to it. Use when the user asks to switch projects.',
  inputSchema: {
    type: 'object',
    properties: {
      project:   { type: 'string', description: 'Jira project key, e.g. ENG' },
      boardId:   { type: 'number', description: 'Board ID for sprint support (optional)' },
      boardName: { type: 'string', description: 'Board display name (optional)' },
    },
    required: ['project'],
  },
},
```

**2d. Add handlers** in the `CallToolRequestSchema` handler block:

```js
} else if (name === 'get_active_project') {
  result = loadState();

} else if (name === 'set_active_project') {
  const { project, boardId = null, boardName = null } = args;
  const state = { project, boardId, boardName };
  const statePath = join(dirname(fileURLToPath(import.meta.url)), 'state.json');
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  result = { ok: true, active: state };
```

---

### Step 3 — `.gitignore`

Add one line:

```
server/state.json
```

---

### Step 4 — `install.md` (Step 6 rewrite)

Replace the current Step 6 "Write `query.md`" block with:

**Write `server/state.json`** (instead of embedding project in query.md):

```json
{
  "project": "<PROJECT_KEY>",
  "boardId": <BOARD_ID or null>,
  "boardName": "<BOARD_NAME or null>"
}
```

Remove the instruction to copy `query.md.example` and replace `YOUR_PROJECT`.
The `query.md` is now static (no project hardcoded) and does not need to be rewritten on install.

Update the confirmation message to reflect this.

---

### Step 5 — `query.md.example` and `query.md`

Remove the hardcoded project/board context section:

```markdown
<!-- REMOVE THIS -->
- Jira project: **YOUR_PROJECT**
- Board: **WIW board** (ID: 321)
```

Replace with a dynamic lookup instruction:

```markdown
## Active Project

Before any project-scoped query (list_issues, list_sprints, etc.), call `get_active_project`
to read the current project key and board ID. Use the returned values in all JQL and tool calls.

If `get_active_project` returns `{ "project": null }`, ask the user which project they want to
work with, then call `set_active_project` to save it.

If the user says "switch to X project" or "use project X", call `set_active_project` with the
new key (and look up board ID via `list_sprints` if needed), then confirm the switch.
```

Update JQL examples to use `<active_project>` as a placeholder instead of `MATH` / `YOUR_PROJECT`.

---

### Step 6 — `README.md`

Change:

```markdown
| Multi-project support | 🔲 | Switch between projects without re-running `/install` |
```

to:

```markdown
| Multi-project support | ✅ | `set_active_project` / `get_active_project` tools; switch by asking the AI |
```

---

## Resulting User Experience

```
User:  "Switch to the ENG project."
AI:    calls set_active_project({ project: "ENG" })
AI:    "Done — now working in ENG. Want me to fetch your open issues?"

User:  "What's in the current sprint?"
AI:    calls get_active_project() → { project: "ENG", boardId: 452 }
AI:    calls list_sprints({ project: "ENG" }) → finds active sprint
AI:    calls get_sprint_issues({ sprint_id: ... })
AI:    presents results
```

---

## Should This Be Done In One Pass?

**Yes — this is safe to execute in one pass.** Here's why:

- **Scope is fully contained.** All changes are isolated: one new JSON file, two new tool handlers
  in a single `if/else` block, and prompt-only edits to markdown files.
- **No breaking changes.** The 7 existing tools are untouched. Old `query.md` files (with a
  hardcoded project) still work — `get_active_project` just adds an alternative path.
- **Rollback is trivial.** Every file being changed is either new (can be deleted) or has a
  clear before/after diff. There's no database migration or dependency update.
- **The only interdependency is `state.json` ↔ MCP tools**, and `state.json` has a safe
  fallback (`{ project: null }`) when missing.

The one caveat: after the code changes, you'll need to **restart Cursor** once so it re-registers
the two new MCP tools. The existing tools keep working immediately.
