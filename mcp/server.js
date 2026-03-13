/**
 * @file mcp/server.js
 * @description Jira MCP Server
 *
 * Exposes Jira and Confluence data as MCP tools so that Cursor AI can
 * query and mutate project data in real time during conversations.
 *
 * TRANSPORT
 *   stdio (JSON-RPC 2.0) — Cursor spawns this process and communicates
 *   via stdin/stdout.  Do NOT add console.log — it corrupts JSON-RPC.
 *
 * REGISTRATION
 *   ~/.cursor/mcp.json:
 *   { "jira": { "command": "node", "args": ["<path>/mcp/server.js"] } }
 */

import markdownToAdf from 'md-to-adf';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadSecrets, loadState, saveState } from '../lib/config.js';
import {
  jiraFetch,
  confluenceFetch,
  fetchIssuesByJQL,
  fetchIssueDetail,
  fetchBoards,
  fetchSprints,
  fetchSprintIssues,
  fetchProjectWithIssueTypes,
  bulkMoveIssues,
} from '../lib/jira-client.js';

// ── Startup validation ───────────────────────────────────────────────────────
{
  const { JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN } = loadSecrets();
  if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_TOKEN) {
    process.stderr.write('Jira MCP: Missing credentials. Create config/secrets.json or set JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN in env.\n');
    process.exit(1);
  }
}

// ── Tool definitions ─────────────────────────────────────────────────────────

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
    name: 'create_issue',
    description: 'Create a new Jira issue in the specified project.',
    inputSchema: {
      type: 'object',
      properties: {
        project:     { type: 'string', description: 'Jira project key, e.g. PROJ' },
        summary:     { type: 'string', description: 'Issue title / summary' },
        issuetype:   { type: 'string', description: 'Issue type name, e.g. Task, Story, Bug, Epic' },
        description: { type: 'string', description: 'Issue description in plain text' },
        assignee:    { type: 'string', description: 'Assignee account ID (from get_user). Omit to leave unassigned.' },
        priority:    { type: 'string', description: 'Priority name, e.g. High, Medium, Low' },
        labels:      { type: 'array', items: { type: 'string' }, description: 'Labels to attach' },
        parent:      { type: 'string', description: 'Parent issue key (e.g. epic key) to link this issue under' },
        story_points:{ type: 'number', description: 'Story point estimate' },
      },
      required: ['project', 'summary', 'issuetype'],
    },
  },
  {
    name: 'update_issue',
    description: 'Update fields on an existing Jira issue. Only provided fields are changed; omitted fields are left as-is.',
    inputSchema: {
      type: 'object',
      properties: {
        key:         { type: 'string', description: 'Issue key to update, e.g. PROJ-42' },
        summary:     { type: 'string', description: 'New summary / title' },
        description: { type: 'string', description: 'New description in plain text' },
        issuetype:   { type: 'string', description: 'New issue type name, e.g. Bug, Story, Task' },
        assignee:    { type: 'string', description: 'New assignee account ID. Pass null to unassign.' },
        priority:    { type: 'string', description: 'New priority name, e.g. High, Medium, Low' },
        labels:      { type: 'array', items: { type: 'string' }, description: 'Replace labels with this list' },
        parent:      { type: 'string', description: 'Parent issue key to re-parent this issue' },
        story_points:{ type: 'number', description: 'New story point estimate' },
      },
      required: ['key'],
    },
  },
  {
    name: 'transition_issue',
    description: 'Move a Jira issue to a new status (e.g. "In Progress", "Done"). Call get_transitions first to discover valid transition IDs for the issue.',
    inputSchema: {
      type: 'object',
      properties: {
        key:           { type: 'string', description: 'Issue key, e.g. PROJ-42' },
        transition_id: { type: 'string', description: 'Transition ID from get_transitions' },
        comment:       { type: 'string', description: 'Optional comment to post when transitioning' },
      },
      required: ['key', 'transition_id'],
    },
  },
  {
    name: 'get_transitions',
    description: 'List the available workflow transitions for an issue. Use this before transition_issue to find the correct transition_id.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Issue key, e.g. PROJ-42' },
      },
      required: ['key'],
    },
  },
  {
    name: 'assign_issue',
    description: 'Assign or reassign a Jira issue to a user. Use search_users to look up the accountId first.',
    inputSchema: {
      type: 'object',
      properties: {
        key:        { type: 'string', description: 'Issue key, e.g. PROJ-42' },
        account_id: { type: 'string', description: 'Assignee accountId from search_users. Pass null to unassign.' },
      },
      required: ['key'],
    },
  },
  {
    name: 'search_users',
    description: 'Search for Jira users by name or email. Returns accountId, displayName, and email — use accountId with assign_issue or create_issue.',
    inputSchema: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Name or email to search for' },
        max_results: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['query'],
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
  {
    name: 'list_confluence_spaces',
    description: 'List all Confluence spaces accessible to the current user. Returns space id, key, name, and type.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_confluence_pages',
    description: 'Search Confluence pages. Optionally filter by space_id and/or title keyword. Returns page id, title, space, and URL.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Confluence space ID to search within (from list_confluence_spaces). Omit to search all spaces.' },
        title:    { type: 'string', description: 'Page title keyword to filter by (exact or partial match).' },
        limit:    { type: 'number', description: 'Max pages to return (default 25).' },
      },
      required: [],
    },
  },
  {
    name: 'get_confluence_page',
    description: 'Get the full content of a single Confluence page by its ID. Returns title, HTML body (storage format), version, and URL.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Confluence page ID (from search_confluence_pages).' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'create_confluence_page',
    description: 'Create a new Confluence page in a given space. Body must be HTML in Confluence storage format.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id:  { type: 'string', description: 'Numeric Confluence space ID — NOT the space key (e.g. not "CNTDS"). Get it from list_confluence_spaces (id field) or get_confluence_page (spaceId field).' },
        title:     { type: 'string', description: 'Page title.' },
        body:      { type: 'string', description: 'Page body in Confluence storage format (HTML-like markup).' },
        parent_id: { type: 'string', description: 'Optional parent page ID. If omitted, page is created at the space root.' },
      },
      required: ['space_id', 'title', 'body'],
    },
  },
  {
    name: 'update_confluence_page',
    description: 'Update the title and/or body of an existing Confluence page. Requires the current version number (from get_confluence_page) — Confluence uses optimistic locking.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Confluence page ID to update.' },
        title:   { type: 'string', description: 'New page title.' },
        body:    { type: 'string', description: 'New page body in Confluence storage format (HTML-like markup).' },
        version: { type: 'number', description: 'Current version number of the page (from get_confluence_page). The server will store version+1.' },
        status:  { type: 'string', description: 'Page status after update: "current" (published, default) or "draft".' },
      },
      required: ['page_id', 'title', 'body', 'version'],
    },
  },
];

// ── MCP Server setup ─────────────────────────────────────────────────────────

const server = new Server(
  { name: 'jira', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;

    if (name === 'list_projects') {
      const projects = await jiraFetch('/rest/api/3/project');
      result = (projects ?? []).map((p) => ({ key: p.key, name: p.name }));

    } else if (name === 'list_issues') {
      const { project, jql: extraJql, max_results } = args;
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
      saveState(state);
      result = { ok: true, active: state };

    } else if (name === 'create_issue') {
      const { project, summary, issuetype, description, assignee, priority, labels, parent, story_points } = args;
      const fields = {
        project:   { key: project },
        summary,
        issuetype: { name: issuetype },
      };
      if (description) {
        fields.description = markdownToAdf(description);
      }
      if (assignee !== undefined) fields.assignee = assignee ? { accountId: assignee } : null;
      if (priority)      fields.priority = { name: priority };
      if (labels?.length) fields.labels = labels;
      if (parent)        fields.parent = { key: parent };
      if (story_points != null) fields.story_points = story_points;
      const data = await jiraFetch('/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });
      result = { key: data.key, id: data.id, url: `https://${loadSecrets().JIRA_DOMAIN}/browse/${data.key}` };

    } else if (name === 'update_issue') {
      const { key, summary, description, issuetype, assignee, priority, labels, parent, story_points } = args;
      const fields = {};
      if (summary !== undefined)    fields.summary = summary;
      if (issuetype !== undefined) {
        const editmeta = await jiraFetch(`/rest/api/3/issue/${key}/editmeta`);
        const allowed = editmeta?.fields?.issuetype?.allowedValues ?? [];
        const match = allowed.find((a) => a.name.toLowerCase() === issuetype.toLowerCase());
        if (!match) {
          throw new Error(
            `Issue type "${issuetype}" not allowed for this issue. ` +
            `Allowed: ${allowed.map((a) => a.name).join(', ') || 'none'}`
          );
        }
        fields.issuetype = { id: match.id };
      }
      if (description !== undefined) {
        fields.description = markdownToAdf(description);
      }
      if (assignee !== undefined) fields.assignee = assignee ? { accountId: assignee } : null;
      if (priority !== undefined)  fields.priority = { name: priority };
      if (labels !== undefined)    fields.labels = labels;
      if (parent !== undefined)    fields.parent = { key: parent };
      if (story_points !== undefined) fields.story_points = story_points;
      await jiraFetch(`/rest/api/3/issue/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
      });
      result = { ok: true, key, url: `https://${loadSecrets().JIRA_DOMAIN}/browse/${key}` };

    } else if (name === 'get_transitions') {
      const data = await jiraFetch(`/rest/api/3/issue/${args.key}/transitions`);
      result = (data?.transitions ?? []).map((t) => ({ id: t.id, name: t.name, to: t.to?.name }));

    } else if (name === 'transition_issue') {
      const { key, transition_id, comment } = args;
      const payload = { transition: { id: transition_id } };
      if (comment) {
        payload.update = {
          comment: [{ add: { body: markdownToAdf(comment) } }],
        };
      }
      await jiraFetch(`/rest/api/3/issue/${key}/transitions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      result = { ok: true, key, url: `https://${loadSecrets().JIRA_DOMAIN}/browse/${key}` };

    } else if (name === 'assign_issue') {
      const { key, account_id } = args;
      await jiraFetch(`/rest/api/3/issue/${key}/assignee`, {
        method: 'PUT',
        body: JSON.stringify({ accountId: account_id ?? null }),
      });
      result = { ok: true, key, url: `https://${loadSecrets().JIRA_DOMAIN}/browse/${key}` };

    } else if (name === 'search_users') {
      const { query, max_results = 10 } = args;
      const data = await jiraFetch(
        `/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=${max_results}`
      );
      result = (data ?? []).map((u) => ({
        accountId:   u.accountId,
        displayName: u.displayName,
        email:       u.emailAddress ?? null,
        active:      u.active,
      }));

    } else if (name === 'bulk_move_issues') {
      const { source_project, target_project, jql } = args;
      result = await bulkMoveIssues(source_project, target_project, jql);

    } else if (name === 'list_confluence_spaces') {
      const data = await confluenceFetch('/api/v2/spaces?limit=50');
      result = (data?.results ?? []).map((s) => ({
        id: s.id, key: s.key, name: s.name, type: s.type,
      }));

    } else if (name === 'search_confluence_pages') {
      const { space_id, title, limit = 25 } = args ?? {};
      let url = `/api/v2/pages?limit=${limit}`;
      if (space_id) url += `&space-id=${space_id}`;
      if (title)    url += `&title=${encodeURIComponent(title)}`;
      const data = await confluenceFetch(url);
      const { JIRA_DOMAIN } = loadSecrets();
      result = (data?.results ?? []).map((p) => ({
        id: p.id, title: p.title, spaceId: p.spaceId,
        url: `https://${JIRA_DOMAIN}/wiki${p._links?.webui ?? ''}`,
      }));

    } else if (name === 'get_confluence_page') {
      const data = await confluenceFetch(
        `/api/v2/pages/${args.page_id}?body-format=storage`
      );
      const { JIRA_DOMAIN } = loadSecrets();
      result = {
        id: data.id, title: data.title, spaceId: data.spaceId,
        body: data.body?.storage?.value ?? '',
        url: `https://${JIRA_DOMAIN}/wiki${data._links?.webui ?? ''}`,
        version: data.version?.number,
      };

    } else if (name === 'create_confluence_page') {
      const { space_id, title, body, parent_id } = args;
      const payload = {
        spaceId: space_id,
        title,
        ...(parent_id ? { parentId: parent_id } : {}),
        body: { storage: { value: body, representation: 'storage' } },
      };
      const data = await confluenceFetch('/api/v2/pages', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const { JIRA_DOMAIN } = loadSecrets();
      result = {
        id: data.id, title: data.title, spaceId: data.spaceId,
        url: `https://${JIRA_DOMAIN}/wiki${data._links?.webui ?? ''}`,
        version: data.version?.number,
      };

    } else if (name === 'update_confluence_page') {
      const { page_id, title, body, version, status = 'current' } = args;
      const payload = {
        id: page_id,
        title,
        status,
        version: { number: version + 1 },
        body: { storage: { value: body, representation: 'storage' } },
      };
      const data = await confluenceFetch(`/api/v2/pages/${page_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const { JIRA_DOMAIN } = loadSecrets();
      result = {
        id: data.id, title: data.title,
        url: `https://${JIRA_DOMAIN}/wiki${data._links?.webui ?? ''}`,
        version: data.version?.number,
      };

    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
