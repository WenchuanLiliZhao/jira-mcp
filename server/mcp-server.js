/**
 * @file mcp-server.js
 * @description Jira MCP Server
 *
 * PURPOSE
 * -------
 * Exposes Jira project data as MCP (Model Context Protocol) tools so that
 * Cursor AI can query Jira in real time during conversations.
 *
 * TRANSPORT
 *   stdio (JSON-RPC 2.0)
 *   Cursor spawns this process and communicates via stdin/stdout.
 *   Do NOT add any console.log output — it will corrupt the JSON-RPC stream.
 *
 * REGISTRATION
 *   Add to ~/.cursor/mcp.json:
 *   {
 *     "jira": {
 *       "command": "node",
 *       "args": ["/absolute/path/to/jira-mcp/server/mcp-server.js"]
 *     }
 *   }
 *   Credentials are loaded from secrets.json (same dir as mcp-server.js).
 *   Then restart Cursor to pick up the new server.
 *
 * AVAILABLE TOOLS (7 total)
 *   REST API v3 (core):
 *     list_projects    — all accessible Jira projects
 *     list_issues      — issues in a project, with optional JQL filter
 *     get_issue        — full detail for a single issue
 *     search_issues    — search with any custom JQL
 *     get_my_issues    — issues assigned to current user
 *   Agile API v1 (sprint):
 *     list_sprints     — sprints for a project (via board)
 *     get_sprint_issues — issues inside a specific sprint
 *
 * REQUIRES Node.js 18+ (built-in fetch)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ── Credentials ──────────────────────────────────────────────────────────────
// Re-read from secrets.json on every request so that credential changes (e.g.
// switching Jira accounts via /install) take effect immediately — no Cursor
// restart required.  Priority: process.env > secrets.json
function loadSecrets() {
  const dir = dirname(fileURLToPath(import.meta.url));
  const secretsPath = join(dir, 'secrets.json');
  let secrets = {};
  if (existsSync(secretsPath)) {
    try {
      secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
    } catch {}
  }
  return {
    JIRA_DOMAIN: process.env.JIRA_DOMAIN || secrets.JIRA_DOMAIN,
    JIRA_EMAIL:  process.env.JIRA_EMAIL  || secrets.JIRA_EMAIL,
    JIRA_TOKEN:  process.env.JIRA_TOKEN  || secrets.JIRA_TOKEN,
  };
}

// ── Active-project state ──────────────────────────────────────────────────────
// Re-read on each call so changes made via set_active_project are reflected
// immediately.
function loadState() {
  const dir = dirname(fileURLToPath(import.meta.url));
  const statePath = join(dir, 'state.json');
  if (!existsSync(statePath)) return { project: null, boardId: null, boardName: null };
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return { project: null, boardId: null, boardName: null };
  }
}

// Validate on startup so the process fails fast if secrets.json is completely missing.
{
  const { JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN } = loadSecrets();
  if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_TOKEN) {
    process.stderr.write('Jira MCP: Missing credentials. Create secrets.json or set JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN in env.\n');
    process.exit(1);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Jira API helper ───────────────────────────────────────────────────────────
/**
 * Authenticated fetch wrapper for Jira REST APIs (both v3 and Agile v1).
 * Re-reads credentials on every call so account switches take effect immediately.
 *
 * @param {string} path  - API path, e.g. "/rest/api/3/project"
 * @param {object} opts  - fetch options (method, body, etc.)
 * @returns {Promise<any>} Parsed JSON response body
 * @throws {Error} With Jira's human-readable error message on non-2xx responses
 */
async function jiraFetch(path, opts = {}) {
  const { JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN } = loadSecrets();
  if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_TOKEN) {
    throw new Error('Missing Jira credentials. Run /install to configure.');
  }
  const base = `https://${JIRA_DOMAIN}`;
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(text).errorMessages?.[0] || JSON.parse(text).message || text; } catch {}
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

// ── Field constants ───────────────────────────────────────────────────────────

/**
 * Fields requested for issue list views (cards / summaries).
 * Kept minimal to reduce response size — detail fields are fetched separately.
 */
const ISSUE_LIST_FIELDS = [
  'summary', 'status', 'assignee', 'issuetype', 'priority',
  'created', 'updated', 'labels', 'fixVersions',
];

/**
 * Fields requested for the full issue detail view.
 * customfield_10016 = Story Points
 * customfield_10020 = Sprint (Jira Software Agile field)
 * parent            = Epic (parent issue link)
 */
const ISSUE_DETAIL_FIELDS = [
  'summary', 'description', 'status', 'priority', 'issuetype',
  'assignee', 'reporter', 'created', 'updated', 'duedate',
  'labels', 'fixVersions', 'components',
  'resolution', 'resolutiondate',
  'timetracking', 'attachment',
  'subtasks', 'issuelinks', 'comment',
  'customfield_10016', 'customfield_10020', 'parent',
];

// ── Data formatters ───────────────────────────────────────────────────────────

/**
 * Normalises a raw Jira issue (from list/search APIs) into a clean summary object.
 * Strips away Jira's verbose nested structure and provides consistent defaults.
 *
 * Used by: fetchIssuesByJQL, fetchSprintIssues
 *
 * @param {object} issue - Raw issue from Jira search/JQL response
 * @returns Flat object with key, summary, status, assignee, issuetype, priority, dates, labels
 */
function formatIssueSummary(issue) {
  const f = issue.fields ?? {};
  return {
    key:          issue.key,
    summary:      f.summary ?? '',
    status:       f.status?.name ?? '',
    assignee:     f.assignee?.displayName ?? 'Unassigned',
    issuetype:    f.issuetype?.name ?? '',
    priority:     f.priority?.name ?? '',
    created:      f.created?.slice(0, 10) ?? '',  // ISO date, trimmed to YYYY-MM-DD
    updated:      f.updated?.slice(0, 10) ?? '',
    labels:       f.labels ?? [],
    fixVersions:  (f.fixVersions ?? []).map((v) => v.name),
  };
}

/**
 * Converts an Atlassian Document Format (ADF) tree to a plain text string.
 *
 * Jira stores rich text (description, comment body) as ADF JSON.
 * This recursive function extracts text content suitable for AI consumption.
 *
 * Strips: bold, italic, links, images, code blocks (keeps only text content)
 *
 * @param {unknown} node - ADF node (can be doc, paragraph, text, etc.)
 * @returns {string} Plain text content
 */
function adfToText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) return node.content.map(adfToText).join('');
  return '';
}

// ── REST API v3 data fetchers ─────────────────────────────────────────────────

/**
 * Runs a JQL query and returns formatted issue summaries.
 * Uses POST /rest/api/3/search/jql (the new endpoint; the old GET /search is deprecated).
 *
 * @param {string} jql        - JQL query string
 * @param {number} maxResults - Max issues to return (default 50)
 * @returns {Promise<object[]>} Array of formatted issue summaries
 */
async function fetchIssuesByJQL(jql, maxResults = 50) {
  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, fields: ISSUE_LIST_FIELDS, maxResults }),
  });
  return (data?.issues ?? []).map(formatIssueSummary);
}

/**
 * Fetches full detail for a single issue by key.
 * Normalises Jira's verbose response into a clean, flat structure for AI use.
 *
 * Key normalisations:
 * - customfield_10016 → story_points
 * - customfield_10020 → sprint (raw object, may be null)
 * - parent            → epic (key + summary)
 * - description/comment bodies: ADF → plain text
 *
 * @param {string} key - Issue key, e.g. "PROJ-1"
 * @returns {Promise<object>} Flat issue detail object
 */
async function fetchIssueDetail(key) {
  const fields = ISSUE_DETAIL_FIELDS.join(',');
  const data = await jiraFetch(`/rest/api/3/issue/${key}?fields=${fields}`);
  if (!data) throw new Error(`Issue ${key} not found`);
  const f = data.fields ?? {};
  return {
    key:          data.key,
    summary:      f.summary ?? '',
    status:       f.status?.name ?? '',
    issuetype:    f.issuetype?.name ?? '',
    priority:     f.priority?.name ?? '',
    assignee:     f.assignee?.displayName ?? 'Unassigned',
    reporter:     f.reporter?.displayName ?? '',
    created:      f.created?.slice(0, 10) ?? '',
    updated:      f.updated?.slice(0, 10) ?? '',
    duedate:        f.duedate ?? null,
    story_points:   f.customfield_10016 ?? null,
    labels:         f.labels ?? [],
    fixVersions:    (f.fixVersions ?? []).map((v) => v.name),
    components:     (f.components ?? []).map((c) => c.name),
    resolution:     f.resolution?.name ?? null,
    resolutiondate: f.resolutiondate?.slice(0, 10) ?? null,
    timetracking: f.timetracking
      ? {
          original:  f.timetracking.originalEstimate ?? null,
          remaining: f.timetracking.remainingEstimate ?? null,
          spent:     f.timetracking.timeSpent ?? null,
        }
      : null,
    attachments: (f.attachment ?? []).map((a) => ({
      filename: a.filename,
      url:      a.content,
      mimeType: a.mimeType,
      size:     a.size,
    })),
    sprint: (() => {
      const sprints = f.customfield_10020;
      if (!Array.isArray(sprints) || sprints.length === 0) return null;
      const s = sprints[sprints.length - 1]; // most recent sprint
      return {
        id:        s.id,
        name:      s.name,
        state:     s.state,
        startDate: s.startDate?.slice(0, 10) ?? null,
        endDate:   s.endDate?.slice(0, 10) ?? null,
      };
    })(),
    description:  adfToText(f.description),
    subtasks: (f.subtasks ?? []).map((st) => ({
      key:     st.key,
      summary: st.fields?.summary ?? '',
      status:  st.fields?.status?.name ?? '',
    })),
    issuelinks: (f.issuelinks ?? []).map((l) => ({
      type:  l.type?.name ?? '',
      issue: (l.inwardIssue ?? l.outwardIssue)?.key ?? '',
    })),
    comments: (f.comment?.comments ?? []).map((c) => ({
      author:  c.author?.displayName ?? '',
      created: c.created?.slice(0, 10) ?? '',
      body:    adfToText(c.body),
    })),
  };
}

// ── Agile API v1 data fetchers ────────────────────────────────────────────────

/**
 * Fetches all boards associated with a Jira project.
 * Boards are required to look up sprints (sprints belong to boards, not projects).
 *
 * @param {string} projectKey - Jira project key, e.g. "PROJ"
 * @returns {Promise<{ id, name, type }[]>} Array of board summaries
 */
async function fetchBoards(projectKey) {
  const data = await jiraFetch(
    `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}`
  );
  return (data?.values ?? []).map((b) => ({
    id:   b.id,
    name: b.name,
    type: b.type,  // "scrum", "kanban", or "simple"
  }));
}

/**
 * Fetches all sprints for a given board.
 *
 * @param {number} boardId  - Board ID (from fetchBoards)
 * @param {string} [state]  - Optional filter: "active" | "future" | "closed"
 * @returns {Promise<object[]>} Array of sprint objects with id, name, state, dates, goal
 */
async function fetchSprints(boardId, state) {
  const stateParam = state ? `&state=${state}` : '';
  const data = await jiraFetch(
    `/rest/agile/1.0/board/${boardId}/sprint?maxResults=50${stateParam}`
  );
  return (data?.values ?? []).map((s) => ({
    id:           s.id,
    name:         s.name,
    state:        s.state,              // "active", "future", or "closed"
    startDate:    s.startDate?.slice(0, 10) ?? null,
    endDate:      s.endDate?.slice(0, 10) ?? null,
    completeDate: s.completeDate?.slice(0, 10) ?? null,
    goal:         s.goal ?? '',
  }));
}

/**
 * Fetches all issues within a specific sprint using the Agile API.
 * Returns the same summary format as fetchIssuesByJQL for consistency.
 *
 * @param {number} sprintId   - Sprint ID (from fetchSprints)
 * @param {number} maxResults - Max issues to return (default 50)
 * @returns {Promise<object[]>} Array of formatted issue summaries
 */
async function fetchSprintIssues(sprintId, maxResults = 50) {
  const data = await jiraFetch(
    `/rest/agile/1.0/sprint/${sprintId}/issue?fields=${ISSUE_LIST_FIELDS.join(',')}&maxResults=${maxResults}`
  );
  return (data?.issues ?? []).map(formatIssueSummary);
}

// ── Bulk move ──────────────────────────────────────────────────────────────────

/**
 * Fetches project details including issue types (id, name).
 *
 * @param {string} projectKey - Jira project key
 * @returns {Promise<{ id, key, name, issueTypes: { id, name }[] }>}
 */
async function fetchProjectWithIssueTypes(projectKey) {
  const data = await jiraFetch(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
  return {
    id:   data.id,
    key:  data.key,
    name: data.name,
    issueTypes: (data.issueTypes ?? []).map((it) => ({ id: it.id, name: it.name })),
  };
}

/**
 * Runs a bulk move of issues from one project to another.
 * Uses POST /rest/api/3/bulk/issues/move (async), then polls until complete.
 *
 * @param {string} sourceProject - Source project key
 * @param {string} targetProject - Target project key
 * @param {string} jql           - JQL to select issues (default: all Epic + Task in source)
 * @returns {Promise<object>} Result with status, moved count, errors
 */
async function bulkMoveIssues(sourceProject, targetProject, jql) {
  const resolvedJql = jql ?? `project = ${sourceProject} AND issuetype in (Epic, Task) ORDER BY key ASC`;
  const issues = await fetchIssuesByJQL(resolvedJql, 1000);
  if (issues.length === 0) {
    return { ok: true, moved: 0, message: 'No issues to move' };
  }

  const targetProjectData = await fetchProjectWithIssueTypes(targetProject);
  const typeByName = Object.fromEntries(
    targetProjectData.issueTypes.map((it) => [it.name, it.id])
  );

  const byType = {};
  for (const issue of issues) {
    const typeName = issue.issuetype;
    if (!typeByName[typeName]) {
      throw new Error(
        `Target project ${targetProject} has no issue type "${typeName}". ` +
        `Available: ${targetProjectData.issueTypes.map((it) => it.name).join(', ')}`
      );
    }
    if (!byType[typeName]) byType[typeName] = [];
    byType[typeName].push(issue.key);
  }

  const targetToSourcesMapping = {};
  for (const [typeName, keys] of Object.entries(byType)) {
    const targetKey = `${targetProject},${typeByName[typeName]}`;
    targetToSourcesMapping[targetKey] = {
      issueIdsOrKeys: keys,
      inferFieldDefaults: true,
      inferStatusDefaults: true,
      inferClassificationDefaults: true,
      inferSubtaskTypeDefault: true,
    };
  }

  const movePayload = {
    sendBulkNotification: true,
    targetToSourcesMapping,
  };

  const moveRes = await jiraFetch('/rest/api/3/bulk/issues/move', {
    method: 'POST',
    body: JSON.stringify(movePayload),
  });

  const taskId = moveRes?.taskId;
  if (!taskId) throw new Error('Bulk move did not return taskId');

  const maxAttempts = 60;
  const pollIntervalMs = 2000;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const progress = await jiraFetch(`/rest/api/3/bulk/queue/${taskId}`);
    const status = progress?.status ?? '';
    if (status === 'COMPLETE') {
      return {
        ok: true,
        moved: progress.totalIssueCount ?? issues.length,
        taskId,
        progressPercent: progress.progressPercent,
        invalidOrInaccessibleIssueCount: progress.invalidOrInaccessibleIssueCount ?? 0,
      };
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(
        `Bulk move ${status}: ${progress?.message ?? JSON.stringify(progress)}`
      );
    }
  }
  throw new Error(`Bulk move timed out after ${maxAttempts} polls`);
}

// ── Tool definitions ──────────────────────────────────────────────────────────
/**
 * MCP tool schema definitions.
 * Each tool's `description` is shown to the AI when it decides which tool to call.
 * `inputSchema` follows JSON Schema format.
 *
 * Tool index:
 *   0  list_projects     → REST /rest/api/3/project
 *   1  list_issues       → REST /rest/api/3/search/jql  (with project JQL)
 *   2  get_issue         → REST /rest/api/3/issue/:key
 *   3  search_issues     → REST /rest/api/3/search/jql  (custom JQL)
 *   4  get_my_issues     → REST /rest/api/3/search/jql  (assignee = currentUser())
 *   5  list_sprints      → Agile /rest/agile/1.0/board + /sprint
 *   6  get_sprint_issues → Agile /rest/agile/1.0/sprint/:id/issue
 */
const TOOLS = [
  {
    name: 'list_projects',
    description: 'List all Jira projects accessible to the current user.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_issues',
    description: 'List issues in a Jira project. Optionally filter with a JQL clause appended to the project filter.',
    inputSchema: {
      type: 'object',
      properties: {
        project:     { type: 'string', description: 'Jira project key, e.g. PROJ' },
        jql:         { type: 'string', description: 'Optional additional JQL, e.g. "status = \'In Progress\'"' },
        max_results: { type: 'number', description: 'Max issues to return (default 50)' },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_issue',
    description: 'Get full details for a single Jira issue including description, comments, subtasks, and linked issues.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Issue key, e.g. PROJ-1' },
      },
      required: ['key'],
    },
  },
  {
    name: 'search_issues',
    description: 'Search Jira issues using any JQL query.',
    inputSchema: {
      type: 'object',
      properties: {
        jql:         { type: 'string', description: 'JQL query string, e.g. "project = PROJ AND status = \'In Progress\'"' },
        max_results: { type: 'number', description: 'Max issues to return (default 50)' },
      },
      required: ['jql'],
    },
  },
  {
    name: 'get_my_issues',
    description: 'Get all Jira issues currently assigned to the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'Max issues to return (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'list_sprints',
    description: 'List sprints for a Jira project. Returns sprint id, name, state (active/future/closed), dates, and goal.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Jira project key, e.g. PROJ' },
        state:   { type: 'string', description: 'Filter by state: active, future, or closed. Omit for all.' },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_sprint_issues',
    description: 'Get all issues in a specific sprint.',
    inputSchema: {
      type: 'object',
      properties: {
        sprint_id:   { type: 'number', description: 'Sprint ID (from list_sprints)' },
        max_results: { type: 'number', description: 'Max issues to return (default 50)' },
      },
      required: ['sprint_id'],
    },
  },
  {
    name: 'get_active_project',
    description: 'Returns the currently active Jira project key and board from local state. Call this before any project-scoped query when the user has not specified a project explicitly.',
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
  {
    name: 'bulk_move_issues',
    description: 'Move multiple issues from one project to another. Uses Jira bulk move API. Specify source_project, target_project, and optional jql to filter issues.',
    inputSchema: {
      type: 'object',
      properties: {
        source_project: { type: 'string', description: 'Source project key, e.g. JM' },
        target_project: { type: 'string', description: 'Target project key, e.g. TEST' },
        jql:            { type: 'string', description: 'Optional JQL to select issues. Default: all Epic and Task in source project.' },
      },
      required: ['source_project', 'target_project'],
    },
  },
];

// ── MCP Server setup ──────────────────────────────────────────────────────────

const server = new Server(
  { name: 'jira', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Handler: Cursor asks "what tools are available?"
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// Handler: Cursor calls a specific tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;

    if (name === 'list_projects') {
      const projects = await jiraFetch('/rest/api/3/project');
      result = (projects ?? []).map((p) => ({ key: p.key, name: p.name }));

    } else if (name === 'list_issues') {
      const { project, jql: extraJql, max_results } = args;
      // Combine project filter with optional extra JQL
      const jql = extraJql
        ? `project = ${project} AND ${extraJql}`
        : `project = ${project} ORDER BY updated DESC`;
      result = await fetchIssuesByJQL(jql, max_results ?? 50);

    } else if (name === 'get_issue') {
      result = await fetchIssueDetail(args.key);

    } else if (name === 'search_issues') {
      result = await fetchIssuesByJQL(args.jql, args.max_results ?? 50);

    } else if (name === 'get_my_issues') {
      result = await fetchIssuesByJQL(
        'assignee = currentUser() ORDER BY updated DESC',
        args?.max_results ?? 50
      );

    } else if (name === 'list_sprints') {
      // Sprint lookup requires going through board: project → board(s) → sprints
      const boards = await fetchBoards(args.project);
      if (boards.length === 0) throw new Error(`No boards found for project ${args.project}`);
      const allSprints = await Promise.all(
        boards.map((b) => fetchSprints(b.id, args.state))
      );
      result = { boards, sprints: allSprints.flat() };

    } else if (name === 'get_sprint_issues') {
      result = await fetchSprintIssues(args.sprint_id, args.max_results ?? 50);

    } else if (name === 'get_active_project') {
      result = { ...loadState(), domain: loadSecrets().JIRA_DOMAIN };

    } else if (name === 'set_active_project') {
      const { project, boardId = null, boardName = null } = args;
      const state = { project, boardId, boardName };
      const statePath = join(dirname(fileURLToPath(import.meta.url)), 'state.json');
      writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
      result = { ok: true, active: state };

    } else if (name === 'bulk_move_issues') {
      const { source_project, target_project, jql } = args;
      result = await bulkMoveIssues(source_project, target_project, jql);

    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    // MCP response: content array with a single text item (JSON-stringified result)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    // MCP error response: isError flag tells Cursor the tool call failed
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// Connect to stdio transport — this blocks and keeps the process alive
const transport = new StdioServerTransport();
await server.connect(transport);
