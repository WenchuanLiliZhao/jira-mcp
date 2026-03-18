# Confluence Query Command

Use this command when the user asks to **read** documentation, pages, wikis, specs, or meeting notes stored in Confluence.

> For **creating or updating** pages, use the `confluence-edit` command instead.

## Available Tools

`list_confluence_spaces`, `search_confluence_pages`, `get_confluence_page`

---

## Tool Reference

| Tool | Returns |
|------|---------|
| `list_confluence_spaces` | All accessible spaces: id, key, name, type |
| `search_confluence_pages` | Matching pages: id, title, space, URL — **no page body** |
| `get_confluence_page` | Full page: title, HTML body (storage format), version, URL |

---

## When to Use Which Tool

**Use `list_confluence_spaces`** when:
- You need a space ID before searching
- The user asks "what spaces are there?" or wants to narrow a search to a specific space

**Use `search_confluence_pages`** when:
- The user asks to find, list, or look up pages by topic or title keyword
- Always prefer searching within a specific `space_id` when the user mentions a project or team

**Use `get_confluence_page`** when:
- The user wants the actual content of a page
- Always call this after `search_confluence_pages` — never assume a page ID

**To create or update a page**, switch to the `confluence-edit` command.

---

## Standard Query Workflow

1. **Identify the space** — If the user mentions a project or team name, call `list_confluence_spaces` to find the matching `space_id`. Skip if searching all spaces is fine.
2. **Search for pages** — Call `search_confluence_pages` with a `title` keyword and optional `space_id`.
3. **Fetch content** — Call `get_confluence_page` with the `page_id` from search results if the user needs the page body.
4. **Present results** — Always include a clickable link for each page. Format:

   `[Page Title](url)`

   Use the `url` field returned directly by the tools — do not construct it manually.

---

## Presenting Results

- For a **list of pages**: show title, space, and a clickable link in a table or bullet list.
- For **page content**: render the key information in readable markdown; do not dump raw HTML at the user.
- If search returns no results, suggest broadening the title keyword or trying a different space.

---

## Common Patterns

```
# Find pages about a topic across all spaces
search_confluence_pages(title: "onboarding")

# Find pages in a specific space
list_confluence_spaces()  →  find space_id for "Engineering"
search_confluence_pages(space_id: "...", title: "architecture")

# Read a page's content
search_confluence_pages(title: "API Design Guide")  →  get page_id
get_confluence_page(page_id: "...")
```
