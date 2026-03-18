# Jira Query Command

Use this command when the user asks about tasks, issues, bugs, priorities, or anything related to the project backlog.

## Active Project

Before any project-scoped query (`list_issues`, `list_sprints`, `search_issues`, etc.), call
`get_active_project` to read the current project key and board ID. Use the returned values in
all JQL and tool calls.

- If `get_active_project` returns `{ "project": null }`, ask the user which project they want,
  then call `set_active_project` to save it before proceeding.
- If the user says "switch to X" or "use project X", call `set_active_project` with the new
  key (look up board ID via `list_sprints` if needed), then confirm the switch.

## Available Tools

`list_projects`, `list_issues`, `get_issue`, `search_issues`, `get_my_issues`, `list_sprints`,
`get_sprint_issues`, `get_active_project`, `set_active_project`

---

## Tool Reference — What Each Tool Returns

### Summary tools (no full detail)
These tools return **summaries only** — no description, no comments, no attachments.

| Tool | Returns |
|------|---------|
| `list_issues` | key, summary, status, assignee, issuetype, priority, created, updated, labels, fixVersions |
| `search_issues` | same as above |
| `get_my_issues` | same as above |
| `get_sprint_issues` | same as above |

### Detail tool
`get_issue` returns **everything**:

| Field | Description |
|-------|-------------|
| key, summary, status, issuetype, priority | Basic info |
| assignee, reporter | People |
| created, updated, duedate, resolutiondate | Dates |
| description | Full issue description (plain text) |
| comments | Array of `{ author, created, body }` — **who commented and what they said** |
| sprint | `{ id, name, state, startDate, endDate }` or `null` if no sprint |
| story_points | Numeric estimate or `null` |
| labels, fixVersions, components | Categorisation |
| resolution | e.g. "Fixed", "Won't Do", or `null` |
| timetracking | `{ original, remaining, spent }` or `null` |
| attachments | Array of `{ filename, url, mimeType, size }` |
| subtasks | Array of `{ key, summary, status }` |
| issuelinks | Array of `{ type, issue }` |

---

## When to Use Which Tool

**Use `get_issue`** when the user asks about ANY of:
- Description or details of an issue
- Comments on an issue (or who commented)
- Attachments
- Sprint the issue belongs to
- Time tracking / story points
- Subtasks or linked issues
- Resolution status

**Use `list_issues` / `search_issues` / `get_my_issues`** when the user wants:
- A list of issues with basic info
- Filtering by status, assignee, label, etc.

**Use `list_sprints`** to discover sprint IDs, then **`get_sprint_issues`** to list issues in that sprint.

> ⚠️ `list_issues`, `search_issues`, and `get_my_issues` do NOT contain descriptions or comments.
> Always call `get_issue` when full detail is needed.

---

## Workflow

1. **Identify intent** — what is the user trying to find out?
2. **Choose the right tool** using the reference above
3. **Present results clearly** — summarize key fields: key, summary, status, assignee, priority; **include a clickable link for each issue**
4. **Offer next steps** — suggest follow-up queries or related issues if relevant

---

## Including Links

When presenting any list of issues (from any tool), **always include a clickable link** for each issue.

- **Link format:** `https://<domain>/browse/<issue-key>`
- **Get `domain`:** It is returned by `get_active_project` (field `domain`). Never read files to obtain it.
- **Markdown:** Use `[KEY](https://<domain>/browse/KEY)` or a table column with links for easy clicking.

## Linking issue references in descriptions

Whenever you write or update a Jira issue description that mentions another issue key (e.g. JL-2, JL-12), **always render it as a clickable link** — never leave a bare key:

```
[JL-12](https://<domain>/browse/JL-12)
```

This applies to every section of the description: `Goal`, `Context`, `Input`, `References`, `Done When`, inline prose, everywhere.

---

## Common JQL Examples

Replace `<project>` with the key returned by `get_active_project`.

```
# In Progress tasks
project = <project> AND status = "In Progress"

# High priority issues
project = <project> AND priority in (Highest, High) ORDER BY updated DESC

# Recently updated
project = <project> ORDER BY updated DESC

# Unassigned issues
project = <project> AND assignee is EMPTY

# Issues in active sprint
project = <project> AND sprint in openSprints()
```
