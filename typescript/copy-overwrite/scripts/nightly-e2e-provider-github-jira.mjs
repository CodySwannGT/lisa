// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** GitHub and Jira adapters for combined nightly-E2E tracking. */
import { CONDITION_MARKER } from "./reconcile-nightly-e2e-tracking.mjs";
import { readback, refuse, required } from "./nightly-e2e-provider-support.mjs";

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
    const query =
      `repo:${repository} is:issue is:open in:body ` + `"${CONDITION_MARKER}"`;
    const search = encodeURIComponent(query);
    const raw = await input.request({
      operation,
      url: `https://api.github.com/search/issues?q=${search}`,
      options: { headers },
    });
    if (!Array.isArray(raw?.items)) {
      refuse(destination, operation, "malformed response");
    }
    if (raw.total_count > raw.items.length) {
      refuse(destination, operation, "result overflow");
    }
    return raw.items
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
  if (raw?.errors?.length || raw?.data?.[field]?.issue?.id !== id) {
    refuse("github", operation, "issue identity authority");
  }
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
    const raw = await input.request({
      operation,
      url: `${base}/rest/api/2/search`,
      options: {
        method: "POST",
        headers,
        body: JSON.stringify({
          jql,
          fields: ["description"],
          maxResults: 100,
        }),
      },
    });
    if (!Array.isArray(raw?.issues)) {
      refuse(destination, operation, "malformed response");
    }
    return raw.issues
      .filter(issue => issue.fields?.description?.includes(CONDITION_MARKER))
      .map(issue => ({
        id: issue.key,
        marker: CONDITION_MARKER,
        pinned: false,
      }));
  };
  const fields = draft => ({
    project: { key: project },
    summary: draft.title,
    description: draft.body,
    issuetype: { name: "Bug" },
    labels: ["nightly-e2e", "automation"],
  });
  return jiraActions(input, { destination, base, headers, list, fields });
}

/** Materialize Jira's write operations around the shared readback. */
function jiraActions(input, context) {
  const { destination, base, headers, list, fields } = context;
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
          body: JSON.stringify({ fields: fields(draft) }),
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
          body: JSON.stringify({ fields: fields(draft) }),
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
