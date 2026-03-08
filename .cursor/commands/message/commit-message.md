# Commit Message Prompt

Generate a commit message for this change set. Include both a subject line and a body (description). Output the message directly in the chat—do not create a new file.

## Guidelines

- **Format**: Use conventional commits when appropriate (e.g. `feat:`, `fix:`, `docs:`, `chore:`).
- **Subject**: One line, ~50 chars, imperative mood (e.g. "Add X" not "Added X").
- **Body** (required): Use an unordered list (`-` bullets). Explain *what* and *why*, not *how*. Wrap at 72 chars. Add a blank line between subject and body.
- **Scope**: Include a short scope if helpful (e.g. `feat(server): add JQL search`).

## Examples

```
feat(server): add search_issues tool with JQL support

- Allow filtering issues by JQL query
- Support project, status, assignee, and custom fields
- Enable flexible backlog queries
```

```
fix: handle empty assignee in get_my_issues response

- Return null instead of undefined when an issue has no assignee
- Prevent serialization errors in MCP tool responses
```

```
docs: update INSTALLATION.md with env var setup

- Document JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN configuration
- Add troubleshooting section for common auth failures
```
