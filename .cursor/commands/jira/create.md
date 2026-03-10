# Jira Task Creation

Plan and create Jira tasks or epics for the feature or work the user describes. Follow the granularity rules below strictly.

## Workflow

1. **Understand scope** — Ask clarifying questions if the request is vague. Identify the target project via `get_active_project`.
2. **Propose a breakdown** — Present a table with these columns and wait for approval:

   | # | Title | Type | Estimate | Notes |
   |---|-------|------|----------|-------|
   | 1 | User registration with email | Story | 2d | Includes API, UI, validation, tests |

3. **Wait for confirmation** — Do NOT create any issues until the user explicitly approves or adjusts the plan.
4. **Create issues** — After approval, create issues using the agreed titles and descriptions.

## Granularity rules

- Each task = **1–3 days**, one deliverable unit. All technical work (DB, API, UI, tests) belongs inside a single task.
- Each epic = **1–4 weeks**, one user-facing feature. No per-layer epics.
- Maximum **8 tasks** per epic before asking for another confirmation round.
- Split by **user outcome**, never by technical layer.

## Description format

Use this template for task descriptions:

```
**As a** [role],
**I want to** [action],
**so that** [benefit].

### Acceptance criteria
- [ ] ...
- [ ] ...
```

## Anti-patterns (never do this)

- Separate tasks for migration, endpoint, component, validation, and tests — these are steps inside ONE task.
- Epics named "Backend work" or "Frontend work" — name epics after the feature they deliver.
- Creating 15+ tasks before the user has seen and approved the plan.

## Good examples

- "User registration with email and password" (not 5 separate technical tasks)
- "Product search with category filters" (not search-API + search-UI + filter-component)
- "CSV export for order history" (not export-endpoint + download-button + file-generation)
