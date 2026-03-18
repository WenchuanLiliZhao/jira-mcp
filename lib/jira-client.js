/**
 * Shared Jira & Confluence API client.
 *
 * Provides authenticated fetch wrappers, field constants, data formatters,
 * and high-level data fetchers used by both the MCP server and CLI scripts.
 */

import { loadSecrets } from './config.js';

// ── Authenticated fetch wrappers ─────────────────────────────────────────────

/**
 * Authenticated fetch for Jira REST APIs (v3 and Agile v1).
 * Re-reads credentials on every call so account switches take effect immediately.
 */
export async function jiraFetch(path, opts = {}) {
  const { JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN } = loadSecrets();
  if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_TOKEN) {
    throw new Error('Missing Jira credentials. Run /Jira-MCP/install to configure.');
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

/**
 * Authenticated fetch for Confluence REST API v2.
 * Uses the same Atlassian credentials as jiraFetch.
 */
export async function confluenceFetch(path, opts = {}) {
  const { JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN } = loadSecrets();
  if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_TOKEN) {
    throw new Error('Missing credentials. Run /Jira-MCP/install to configure.');
  }
  const base = `https://${JIRA_DOMAIN}/wiki`;
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
    try { msg = JSON.parse(text).message || text; } catch {}
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

// ── Field constants ──────────────────────────────────────────────────────────

/** Fields for issue list / summary views. */
export const ISSUE_LIST_FIELDS = [
  'summary', 'status', 'assignee', 'issuetype', 'priority',
  'created', 'updated', 'labels', 'fixVersions',
];

/**
 * Fields for full issue detail.
 * customfield_10016 = Story Points
 * customfield_10020 = Sprint (Jira Software Agile field)
 */
export const ISSUE_DETAIL_FIELDS = [
  'summary', 'description', 'status', 'priority', 'issuetype',
  'assignee', 'reporter', 'created', 'updated', 'duedate',
  'labels', 'fixVersions', 'components',
  'resolution', 'resolutiondate',
  'timetracking', 'attachment',
  'subtasks', 'issuelinks', 'comment',
  'customfield_10016', 'customfield_10020', 'parent',
];

// ── Data formatters ──────────────────────────────────────────────────────────

/** Normalise a raw Jira issue into a clean summary object. */
export function formatIssueSummary(issue) {
  const f = issue.fields ?? {};
  return {
    key:          issue.key,
    summary:      f.summary ?? '',
    status:       f.status?.name ?? '',
    assignee:     f.assignee?.displayName ?? 'Unassigned',
    issuetype:    f.issuetype?.name ?? '',
    priority:     f.priority?.name ?? '',
    created:      f.created?.slice(0, 10) ?? '',
    updated:      f.updated?.slice(0, 10) ?? '',
    labels:       f.labels ?? [],
    fixVersions:  (f.fixVersions ?? []).map((v) => v.name),
  };
}

/** Convert Atlassian Document Format (ADF) to Markdown-flavoured plain text. */
export function adfToText(node) {
  if (!node || typeof node !== 'object') return '';
  // Smart-link / inline issue card — extract the issue key from the URL.
  if (node.type === 'inlineCard') {
    const url = node.attrs?.url ?? '';
    return url.match(/browse\/([\w]+-\d+)/)?.[1] ?? url;
  }
  if (node.type === 'text' && typeof node.text === 'string') {
    const linkMark = node.marks?.find((m) => m.type === 'link');
    if (linkMark?.attrs?.href) return `[${node.text}](${linkMark.attrs.href})`;
    return node.text;
  }
  if (Array.isArray(node.content)) return node.content.map(adfToText).join('');
  return '';
}

// ── REST API v3 data fetchers ────────────────────────────────────────────────

/** Run a JQL query and return formatted issue summaries. */
export async function fetchIssuesByJQL(jql, maxResults = 50, fields = ISSUE_LIST_FIELDS) {
  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, fields, maxResults }),
  });
  return (data?.issues ?? []).map(formatIssueSummary);
}

/** Fetch full detail for a single issue by key. */
export async function fetchIssueDetail(key) {
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
      const s = sprints[sprints.length - 1];
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

// ── Agile API v1 data fetchers ───────────────────────────────────────────────

/** Fetch boards for a Jira project. */
export async function fetchBoards(projectKey) {
  const data = await jiraFetch(
    `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}`
  );
  return (data?.values ?? []).map((b) => ({
    id:   b.id,
    name: b.name,
    type: b.type,
  }));
}

/** Fetch sprints for a board. */
export async function fetchSprints(boardId, state) {
  const stateParam = state ? `&state=${state}` : '';
  const data = await jiraFetch(
    `/rest/agile/1.0/board/${boardId}/sprint?maxResults=50${stateParam}`
  );
  return (data?.values ?? []).map((s) => ({
    id:           s.id,
    name:         s.name,
    state:        s.state,
    startDate:    s.startDate?.slice(0, 10) ?? null,
    endDate:      s.endDate?.slice(0, 10) ?? null,
    completeDate: s.completeDate?.slice(0, 10) ?? null,
    goal:         s.goal ?? '',
  }));
}

/** Fetch issues within a sprint. */
export async function fetchSprintIssues(sprintId, maxResults = 50) {
  const data = await jiraFetch(
    `/rest/agile/1.0/sprint/${sprintId}/issue?fields=${ISSUE_LIST_FIELDS.join(',')}&maxResults=${maxResults}`
  );
  return (data?.issues ?? []).map(formatIssueSummary);
}

/** Create a new sprint on a board. */
export async function createSprint(boardId, { name, startDate, endDate, goal }) {
  const body = { name, originBoardId: boardId };
  if (startDate) body.startDate = startDate;
  if (endDate) body.endDate = endDate;
  if (goal) body.goal = goal;
  const data = await jiraFetch('/rest/agile/1.0/sprint', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return {
    id:        data.id,
    name:      data.name,
    state:     data.state,
    startDate: data.startDate?.slice(0, 10) ?? null,
    endDate:   data.endDate?.slice(0, 10) ?? null,
    goal:      data.goal ?? '',
  };
}

/** Update an existing sprint's name, dates, goal, or state. */
export async function updateSprint(sprintId, fields) {
  const body = {};
  if (fields.name !== undefined) body.name = fields.name;
  if (fields.startDate !== undefined) body.startDate = fields.startDate;
  if (fields.endDate !== undefined) body.endDate = fields.endDate;
  if (fields.goal !== undefined) body.goal = fields.goal;
  if (fields.state !== undefined) body.state = fields.state;
  const data = await jiraFetch(`/rest/agile/1.0/sprint/${sprintId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return {
    id:           data.id,
    name:         data.name,
    state:        data.state,
    startDate:    data.startDate?.slice(0, 10) ?? null,
    endDate:      data.endDate?.slice(0, 10) ?? null,
    completeDate: data.completeDate?.slice(0, 10) ?? null,
    goal:         data.goal ?? '',
  };
}

/** Delete a sprint. Only future (not-started) sprints can be deleted. */
export async function deleteSprint(sprintId) {
  await jiraFetch(`/rest/agile/1.0/sprint/${sprintId}`, { method: 'DELETE' });
  return { ok: true };
}

/** Move issues into a sprint. */
export async function moveIssuesToSprint(sprintId, issueKeys) {
  await jiraFetch(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
    method: 'POST',
    body: JSON.stringify({ issues: issueKeys }),
  });
  return { ok: true, sprintId, moved: issueKeys.length };
}

/** Move issues out of any sprint back to the backlog. */
export async function moveIssuesToBacklog(issueKeys) {
  await jiraFetch('/rest/agile/1.0/backlog/issue', {
    method: 'POST',
    body: JSON.stringify({ issues: issueKeys }),
  });
  return { ok: true, moved: issueKeys.length };
}

/**
 * Rank (reorder) issues on the board / backlog.
 * Place `issueKeys` immediately before or after a reference issue.
 */
export async function rankIssues(issueKeys, { rankBeforeIssue, rankAfterIssue }) {
  const body = { issues: issueKeys };
  if (rankBeforeIssue) body.rankBeforeIssue = rankBeforeIssue;
  else if (rankAfterIssue) body.rankAfterIssue = rankAfterIssue;
  else throw new Error('Either rankBeforeIssue or rankAfterIssue is required');
  await jiraFetch('/rest/agile/1.0/issue/rank', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return { ok: true, ranked: issueKeys.length };
}

// ── Issue link helpers ───────────────────────────────────────────────────────

/** List all available issue link types for this Jira instance. */
export async function fetchLinkTypes() {
  const data = await jiraFetch('/rest/api/3/issueLinkType');
  return (data?.issueLinkTypes ?? []).map((lt) => ({
    id:      lt.id,
    name:    lt.name,
    inward:  lt.inward,
    outward: lt.outward,
  }));
}

/**
 * Create a formal Jira issue link between two issues.
 * linkTypeName should match the `name` from fetchLinkTypes(), e.g. "Relates", "Blocks".
 * direction controls which issue is treated as inward vs. outward:
 *   "outward" (default) — sourceKey is the outward issue, targetKey is the inward issue
 *   "inward"            — sourceKey is the inward issue,  targetKey is the outward issue
 */
export async function linkIssues(sourceKey, targetKey, linkTypeName = 'Relates') {
  await jiraFetch('/rest/api/3/issueLink', {
    method: 'POST',
    body: JSON.stringify({
      type:         { name: linkTypeName },
      inwardIssue:  { key: targetKey },
      outwardIssue: { key: sourceKey },
    }),
  });
  return { ok: true, outward: sourceKey, type: linkTypeName, inward: targetKey };
}

// ── Project helpers ──────────────────────────────────────────────────────────

/** Fetch project details including issue types. */
export async function fetchProjectWithIssueTypes(projectKey) {
  const data = await jiraFetch(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
  return {
    id:   data.id,
    key:  data.key,
    name: data.name,
    issueTypes: (data.issueTypes ?? []).map((it) => ({ id: it.id, name: it.name })),
  };
}

/**
 * Bulk-move issues between projects via the async Jira API.
 * Polls until the task completes or times out.
 */
export async function bulkMoveIssues(sourceProject, targetProject, jql) {
  const resolvedJql = jql ?? `project = ${sourceProject} AND issuetype in (Epic, Task) ORDER BY key ASC`;
  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql: resolvedJql, fields: ['summary', 'issuetype'], maxResults: 1000 }),
  });
  const issues = (data?.issues ?? []).map((i) => ({
    key: i.key,
    issuetype: i.fields?.issuetype?.name ?? '',
  }));
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

  const moveRes = await jiraFetch('/rest/api/3/bulk/issues/move', {
    method: 'POST',
    body: JSON.stringify({ sendBulkNotification: true, targetToSourcesMapping }),
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
