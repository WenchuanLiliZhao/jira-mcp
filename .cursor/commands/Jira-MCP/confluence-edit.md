# Confluence Edit Command

Use this command when the user asks to **create or update** a Confluence page.
All writes go through a local draft file so the user can review before anything is pushed.

## Available Tools

`list_confluence_spaces`, `search_confluence_pages`, `get_confluence_page`,
`create_confluence_page`, `update_confluence_page`

---

## Golden Rule

**Never call `create_confluence_page` or `update_confluence_page` without writing a
local draft first and receiving explicit user confirmation.**

---

## Workflow: Edit an Existing Page

### Step 1 — Find the page

Call `search_confluence_pages` with a title keyword.
If unsure which space, call `list_confluence_spaces` first.

Present results as a list with clickable links. If more than one match, ask the user
to confirm which page to edit.

### Step 2 — Fetch current content

Call `get_confluence_page` with the confirmed `page_id`.

### Step 3 — Write draft to local file

Save the proposed new content to:

```
drafts/confluence/<page-id>.md
```

The file must contain **only the page body in Markdown (GFM)**. Do not include
page title, page ID, or other metadata inside the file.

Then tell the user:
- The page title and URL
- A concise summary of what changed (sections added / removed / rewritten)

### Step 4 — Wait for confirmation

> "Draft saved to `drafts/confluence/<page-id>.md`. Review or edit it, then say
> **push** to publish."

Do **not** call `update_confluence_page` until the user explicitly says
"push", "apply", "looks good", or similar.

### Step 5 — Push

Read the draft file. Call `update_confluence_page` with:

| Argument | Value |
|----------|-------|
| `page_id` | ID from Step 1 |
| `body` | Contents of the draft file |

Confirm success and show a clickable link: `[Page Title](url)`.

---

## Workflow: Create a New Page

### Step 1 — Confirm target space

Ask the user which space the page should live in, or call `list_confluence_spaces`
to look it up. Also ask for a parent page if appropriate.

### Step 2 — Write draft to local file

Save the proposed content to:

```
drafts/confluence/new-<slugified-title>.md
```

Tell the user what the page will contain (summary of sections).

### Step 3 — Wait for confirmation

> "Draft saved to `drafts/confluence/new-<slug>.md`. Edit if needed, then say
> **push** to create the page."

### Step 4 — Push

Read the draft file. Call `create_confluence_page` with:

| Argument | Value |
|----------|-------|
| `space_id` | Confirmed space |
| `title` | Page title (from user) |
| `body` | Contents of the draft file |
| `parent_id` | Parent page ID, if specified |

Confirm success and show a clickable link.

---

## Content Format Rules

- Write `body` as **Markdown (GFM)**. The server converts it to Confluence storage
  format automatically.
- Use fenced code blocks (` ```lang … ``` `) for code — they become
  syntax-highlighted Confluence macros.
- Do **not** write raw Confluence storage XML or `<ac:*>` tags.
- Do **not** include `<html>` or `<body>` tags.

---

## Rules

- Always find the page via `search_confluence_pages` — never assume a `page_id`.
- Always write to `drafts/confluence/` before any write call.
- Always wait for explicit user confirmation before calling `create_confluence_page`
  or `update_confluence_page`.
- After pushing, confirm with a clickable link to the page.
