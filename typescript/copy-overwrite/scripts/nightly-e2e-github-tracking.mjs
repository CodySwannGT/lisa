// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * GitHub transport for the combined nightly-E2E condition tracker.
 *
 * @module scripts/nightly-e2e-github-tracking
 */

/**
 * Call GitHub GraphQL and reject error-bearing success envelopes.
 * @param input - Injected bounded transport and diagnostics
 * @param operation - Stable operation classification
 * @param headers - GitHub request headers
 * @param query - Static GraphQL operation
 * @param variables - Bounded GraphQL variables
 */
async function graphql(input, operation, headers, query, variables) {
  const result = await input.request(
    operation,
    "https://api.github.com/graphql",
    { method: "POST", headers, body: JSON.stringify({ query, variables }) }
  );
  if (result.errors?.length) input.refuse(operation, "GraphQL error");
  return result.data;
}

/**
 * Read the sole marker-owned pinned issue.
 * @param input - Injected tracker authority
 * @param headers - GitHub request headers
 * @param owner - Repository owner
 * @param name - Repository name
 */
async function pinnedTracker(input, headers, owner, name) {
  const data = await graphql(
    input,
    "list",
    headers,
    "query($owner:String!,$name:String!){repository(owner:$owner,name:$name)" +
      "{pinnedIssues(first:3){nodes{id body}}}}",
    { owner, name }
  );
  return input.sole(
    (data.repository?.pinnedIssues?.nodes ?? []).filter(issue =>
      issue.body?.includes(input.marker)
    )
  );
}

/**
 * Reconcile and pin one GitHub issue in the caller repository.
 * @param input - Marker, desired state, and bounded transport authority
 */
export async function reconcileGitHubTracking(input) {
  const repository = input.required("GITHUB_REPOSITORY");
  const token = input.required("PROVIDER_TOKEN");
  const base = `https://api.github.com/repos/${repository}/issues`;
  const [owner, name, extra] = repository.split("/");
  if (!owner || !name || extra) {
    input.refuse("configuration", "invalid repository");
  }
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const query = `repo:${repository} is:issue in:body "${input.marker}"`;
  const listed = await input.request(
    "list",
    `https://api.github.com/search/issues?q=${encodeURIComponent(query)}` +
      "&per_page=100",
    { headers }
  );
  if (listed.total_count > listed.items.length) {
    input.refuse("list", "matching tracker result set exceeds 100");
  }
  const existing = input.sole(
    listed.items.filter(
      issue => !issue.pull_request && issue.body?.includes(input.marker)
    )
  );
  const pinned = await pinnedTracker(input, headers, owner, name);
  if (pinned && existing?.node_id !== pinned.id) {
    input.refuse("list", "pinned tracker identity mismatch");
  }
  if (input.action === "close") {
    if (!existing) return;
    if (pinned) {
      await graphql(
        input,
        "unpin",
        headers,
        "mutation($id:ID!){unpinIssue(input:{issueId:$id}){issue{id}}}",
        { id: existing.node_id }
      );
    }
    await input.request("close", `${base}/${existing.number}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ state: "closed" }),
    });
    return;
  }
  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    state: "open",
  });
  const current = existing
    ? await input.request("refresh", `${base}/${existing.number}`, {
        method: "PATCH",
        headers,
        body: payload,
      })
    : await input.request("create", base, {
        method: "POST",
        headers,
        body: payload,
      });
  if (!pinned) {
    await graphql(
      input,
      "pin",
      headers,
      "mutation($id:ID!){pinIssue(input:{issueId:$id}){issue{id}}}",
      { id: current.node_id }
    );
  }
}
