# Update Command

Guide the user through updating Jira-MCP to the latest version from the remote repository.

## Known Pitfalls

These issues were discovered during real update sessions and must be handled explicitly:

1. **`install.sh` skips registration if the `jira` key already exists** in `~/.cursor/mcp.json`,
   even if the path is stale or points to a deleted directory. Always verify the path after install.

2. **Cursor caches MCP tool descriptors.** After updating the server code, new tools will NOT appear
   until Cursor is fully restarted. Refreshing the MCP panel in Settings is not always sufficient.

3. **`mcp.json` path must match the actual install location.** If the repo was previously installed
   under a different name (e.g. `~/jira-lens/` vs `~/Jira-MCP/`), the stale path silently loads
   the old server — no error is shown, but new tools are missing.

4. **Credentials are not preserved across a fresh clone.** `config/secrets.json` is gitignored,
   so pulling or re-cloning loses it. Back up before removing the old directory.

---

## Steps

### Step 1 — Back up credentials

Read the existing `config/secrets.json` from the Jira-MCP install directory (default `~/Jira-MCP`).
Store the contents in memory. If the file does not exist, skip this step and warn the user that
credentials will need to be re-entered after the update.

---

### Step 2 — Pull or re-clone

Try `git pull` inside the install directory first.

If that fails (e.g. directory doesn't exist, not a git repo, or merge conflicts), fall back to:
1. Remove the old directory
2. `git clone https://github.com/WenchuanLiliZhao/jira-mcp.git ~/Jira-MCP`

---

### Step 3 — Install dependencies

Run `npm install --prefix ~/Jira-MCP --silent`.

---

### Step 4 — Restore credentials

Write the backed-up `config/secrets.json` back to `~/Jira-MCP/config/secrets.json`.
If no backup was made in Step 1, run the `/Jira-MCP/install` command instead.

---

### Step 5 — Verify `mcp.json` path

Read `~/.cursor/mcp.json`. Check that `mcpServers.jira.args[0]` points to
`/Users/<user>/Jira-MCP/mcp/server.js` (the actual file that exists on disk).

If the path is wrong or stale:
1. Update it to the correct path
2. Tell the user: "Fixed MCP server path in `~/.cursor/mcp.json` — it was pointing to `<old path>`."

If the path is already correct, confirm: "MCP server path is correct."

---

### Step 6 — Verify tools

Ask the user to **restart Cursor** (this is required for Cursor to pick up new tool definitions).

After restart, call `list_sprints` with `{"project": "JL"}` (or any known project) to verify
the MCP server is responding. Then confirm:
> "Update complete. MCP server is running with the latest tools."

List any new tools that were not available before the update, if known.

---

## Rules

- Always back up credentials before any destructive operation (rm, re-clone).
- Always verify the `mcp.json` path — do not trust `install.sh` to handle it correctly when
  the `jira` key already exists.
- Always ask the user to restart Cursor after the update. Do not skip this step.
- If `config/state.json` exists, back it up and restore it too (it stores the active project).
