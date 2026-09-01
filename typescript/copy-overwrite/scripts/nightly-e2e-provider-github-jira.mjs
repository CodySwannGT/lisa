// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** GitHub and Jira adapters for combined nightly-E2E tracking. */
import { CONDITION_MARKER } from "./reconcile-nightly-e2e-tracking.mjs";
import { readback, refuse, required } from "./nightly-e2e-provider-support.mjs";

const MAX_GITHUB_PAGES = 10;
const MAX_JIRA_PAGES = 3;

/** Return whether a GitHub issue has the strict REST identity shape. */
function isGitHubIssue(issue) {
  return (
    issue !== null &&
    typeof issue === "object" &&
    Number.isSafeInteger(issue.number) &&
    issue.number > 0 &&
    typeof issue.node_id === "string" &&
    issue.node_id !== "" &&
    (typeof issue.body === "string" || issue.body === null)
  );
}

/** Build GitHub's issue adapter over the injected JSON transport. */
export function githubAdapter(input) {
  const destination = "github";
  const repository = required(input, destination, "GITHUB_REPOSITORY");
  const token = required(input, destination, "PROVIDER_TOKEN");
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) refuse(destination, "configuration");
  const base = `https://api.github.com/repos/${repository}/issues`;
  const headers = { Authorization: `Bearer ${token}` };
  const numbers = new Map();
  const list = async (operation = "list") => {
    const issues = [];
    for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
      const raw = await input.request({
        operation,
        url: `${base}?state=open&per_page=100&page=${page}`,
        options: { method: "GET", headers },
      });
      if (!Array.isArray(raw) || !raw.every(isGitHubIssue)) {
        refuse(destination, operation, "malformed response");
      }
      issues.push(...raw);
      if (raw.length < 100) break;
      if (page === MAX_GITHUB_PAGES) {
        refuse(destination, operation, "result overflow");
      }
    }
    return issues
      .filter(
        issue => !issue.pull_request && issue.body?.includes(CONDITION_MARKER)
      )
      .map(issue => {
        const id = issue.node_id ?? String(issue.number);
        numbers.set(id, issue.number);
        return { id, marker: CONDITION_MARKER, pinned: false };
      });
  };
  return githubActions(input, { destination, base, headers, numbers, list });
}

/** Materialize GitHub's write operations around the shared readback. */
function githubActions(input, context) {
  const { destination, base, headers, numbers, list } = context;
  return {
    async list() {
      return list();
    },
    async create(draft) {
      const issue = await input.request({
        operation: "create",
        url: base,
        options: {
          method: "POST",
          headers,
          body: JSON.stringify({ title: draft.title, body: draft.body }),
        },
      });
      const id = issue?.node_id ?? String(issue?.number ?? "");
      if (!id) refuse(destination, "create", "missing issue identity");
      return readback(destination, list, id, true);
    },
    async refresh(id, draft) {
      const number = numbers.get(id);
      if (!number) refuse(destination, "refresh", "unknown issue identity");
      await input.request({
        operation: "refresh",
        url: `${base}/${number}`,
        options: {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: draft.title, body: draft.body }),
        },
      });
      return readback(destination, list, id, true);
    },
    async close(id) {
      const number = numbers.get(id);
      if (!number) refuse(destination, "close", "unknown issue identity");
      await input.request({
        operation: "close",
        url: `${base}/${number}`,
        options: { method: "PATCH", headers, body: '{"state":"closed"}' },
      });
      await readback(destination, list, id, false);
    },
    async pin(id) {
      await githubPin(input, headers, "pin", id);
      await readback(destination, list, id, true);
    },
    async unpin(id) {
      await githubPin(input, headers, "unpin", id);
    },
  };
}

/** Invoke one GitHub pin lifecycle mutation. */
async function githubPin(input, headers, operation, id) {
  const field = operation === "pin" ? "pinIssue" : "unpinIssue";
  const query =
    operation === "pin"
      ? "mutation($id:ID!){pinIssue(input:{issueId:$id}){issue{id}}}"
      : "mutation($id:ID!){unpinIssue(input:{issueId:$id}){issue{id}}}";
  const raw = await input.request({
    operation,
    url: "https://api.github.com/graphql",
    options: {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables: { id } }),
    },
  });
  const errorsValid =
    raw?.errors === undefined ||
    (Array.isArray(raw.errors) && raw.errors.length === 0);
  if (
    !errorsValid ||
    raw?.data === null ||
    typeof raw?.data !== "object" ||
    raw.data[field]?.issue?.id !== id
  ) {
    refuse("github", operation, "issue identity authority");
  }
}

/** Read all bounded Jira search pages through the enhanced-search API. */
async function jiraSearch(input, operation, base, headers, jql) {
  const issues = [];
  const tokens = new Set();
  let nextPageToken;
  for (let page = 1; page <= MAX_JIRA_PAGES; page += 1) {
    const requestBody = {
      jql,
      fields: ["description"],
      maxResults: 100,
      ...(nextPageToken === undefined ? {} : { nextPageToken }),
    };
    const raw = await input.request({
      operation,
      url: `${base}/rest/api/3/search/jql`,
      options: {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      },
    });
    if (!Array.isArray(raw?.issues) || typeof raw.isLast !== "boolean") {
      refuse("jira", operation, "malformed response");
    }
    issues.push(...raw.issues);
    if (raw.isLast) break;
    if (
      typeof raw.nextPageToken !== "string" ||
      raw.nextPageToken === "" ||
      tokens.has(raw.nextPageToken) ||
      page === MAX_JIRA_PAGES
    ) {
      refuse("jira", operation, "pagination authority");
    }
    tokens.add(raw.nextPageToken);
    nextPageToken = raw.nextPageToken;
  }
  return issues;
}

/** Build Jira's issue adapter over the injected JSON transport. */
export function jiraAdapter(input) {
  const destination = "jira";
  const base = required(input, destination, "JIRA_BASE_URL").replace(
    /\/$/u,
    ""
  );
  const email = required(input, destination, "JIRA_USER_EMAIL");
  const project = required(input, destination, "JIRA_PROJECT_KEY");
  const token = required(input, destination, "PROVIDER_TOKEN");
  const credentials = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/json",
  };
  const list = async (operation = "list") => {
    const marker = JSON.stringify(`"${CONDITION_MARKER}"`);
    const jql =
      `project = ${JSON.stringify(project)} AND statusCategory != Done AND ` +
      `description ~ ${marker}`;
    const issues = await jiraSearch(input, operation, base, headers, jql);
    return issues
      .filter(issue => issue.fields?.description?.includes(CONDITION_MARKER))
      .map(issue => ({
        id: issue.key,
        marker: CONDITION_MARKER,
        pinned: false,
      }));
  };
  const createFields = draft => ({
    project: { key: project },
    summary: draft.title,
    description: draft.body,
    issuetype: { name: "Bug" },
    labels: ["nightly-e2e", "automation"],
  });
  const updateFields = draft => ({
    summary: draft.title,
    description: draft.body,
  });
  return jiraActions(input, {
    destination,
    base,
    headers,
    list,
    createFields,
    updateFields,
  });
}

/** Materialize Jira's write operations around the shared readback. */
function jiraActions(input, context) {
  const { destination, base, headers, list, createFields, updateFields } =
    context;
  return {
    async list() {
      return list();
    },
    async create(draft) {
      const issue = await input.request({
        operation: "create",
        url: `${base}/rest/api/2/issue`,
        options: {
          method: "POST",
          headers,
          body: JSON.stringify({ fields: createFields(draft) }),
        },
      });
      if (!issue?.key) refuse(destination, "create", "missing issue identity");
      return readback(destination, list, issue.key, true);
    },
    async refresh(id, draft) {
      await input.request({
        operation: "refresh",
        url: `${base}/rest/api/2/issue/${id}`,
        options: {
          method: "PUT",
          headers,
          body: JSON.stringify({ fields: updateFields(draft) }),
        },
      });
      return readback(destination, list, id, true);
    },
    async close(id) {
      const url = `${base}/rest/api/2/issue/${id}/transitions`;
      const raw = await input.request({
        operation: "close",
        url,
        options: { headers },
      });
      const done = (raw?.transitions ?? []).filter(
        item => item.to?.statusCategory?.key === "done"
      );
      if (done.length !== 1) {
        refuse(destination, "close", "done transition unavailable");
      }
      await input.request({
        operation: "close",
        url,
        options: {
          method: "POST",
          headers,
          body: JSON.stringify({ transition: { id: done[0].id } }),
        },
      });
      await readback(destination, list, id, false);
    },
  };
}
