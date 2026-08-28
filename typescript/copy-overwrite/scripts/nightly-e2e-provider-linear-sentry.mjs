// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Linear and Sentry adapters for combined nightly-E2E tracking. */
import { CONDITION_MARKER } from "./reconcile-nightly-e2e-tracking.mjs";
import { readback, refuse, required } from "./nightly-e2e-provider-support.mjs";

const MARKER_TAG = "lisa_nightly_e2e_condition";

/** Resolve one listed Sentry group through authenticated event authority. */
async function sentryListedGroup(input, operation, issue, headers) {
  if (typeof issue?.id !== "string" || !issue.id) {
    refuse("sentry", operation, "issue identity authority");
  }
  const raw = await input.request({
    operation,
    url: `https://sentry.io/api/0/issues/${issue.id}/events/latest/`,
    options: { method: "GET", headers },
  });
  const markers = Array.isArray(raw?.tags)
    ? raw.tags.filter(tag => tag?.key === MARKER_TAG)
    : [];
  if (
    raw?.groupID !== issue.id ||
    markers.length !== 1 ||
    markers[0].value !== CONDITION_MARKER
  ) {
    refuse("sentry", operation, "issue marker authority");
  }
  return { id: issue.id, marker: markers[0].value, pinned: false };
}

/** Call Linear GraphQL and reject error-bearing or unsuccessful mutations. */
async function linearApi(input, operation, query, variables) {
  const raw = await input.request({
    operation,
    url: "https://api.linear.app/graphql",
    options: {
      method: "POST",
      headers: {
        Authorization: required(input, "linear", "PROVIDER_TOKEN"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    },
  });
  if (raw?.errors?.length || !raw?.data) {
    refuse("linear", operation, "GraphQL error");
  }
  const mutation = raw.data.issueCreate ?? raw.data.issueUpdate;
  if (mutation && mutation.success !== true) {
    refuse("linear", operation, "success false");
  }
  return raw.data;
}

/** Build Linear's issue adapter over the injected JSON transport. */
export function linearAdapter(input) {
  const key = required(input, "linear", "LINEAR_TEAM_KEY");
  let team;
  const list = async (operation = "list") => {
    const data = await linearApi(
      input,
      operation,
      "query($key:String!){teams(filter:{key:{eq:$key}}){nodes{id " +
        "states{nodes{id type}} issues(first:100){nodes{id description " +
        "state{type}}}}}}",
      { key }
    );
    const teams = data.teams?.nodes ?? [];
    if (teams.length !== 1) {
      refuse("linear", operation, "exact team unavailable");
    }
    [team] = teams;
    return (team.issues?.nodes ?? [])
      .filter(
        issue =>
          issue.description?.includes(CONDITION_MARKER) &&
          !["completed", "canceled"].includes(issue.state?.type)
      )
      .map(issue => ({
        id: issue.id,
        marker: CONDITION_MARKER,
        pinned: false,
      }));
  };
  return linearActions(input, { list, team: () => team });
}

/** Materialize Linear's write operations around the shared readback. */
function linearActions(input, context) {
  const { list, team } = context;
  const mutate = async (operation, query, variables, id, present) => {
    await linearApi(input, operation, query, variables);
    return readback("linear", list, id, present);
  };
  return {
    async list() {
      return list();
    },
    async create(draft) {
      const data = await linearApi(
        input,
        "create",
        "mutation($team:String!,$title:String!,$body:String!){issueCreate" +
          "(input:{teamId:$team,title:$title,description:$body})" +
          "{success issue{id}}}",
        { team: team().id, title: draft.title, body: draft.body }
      );
      const id = data.issueCreate?.issue?.id;
      if (!id) refuse("linear", "create", "missing issue identity");
      return readback("linear", list, id, true);
    },
    async refresh(id, draft) {
      return mutate(
        "refresh",
        "mutation($id:String!,$title:String!,$body:String!){issueUpdate" +
          "(id:$id,input:{title:$title,description:$body})" +
          "{success issue{id}}}",
        { id, title: draft.title, body: draft.body },
        id,
        true
      );
    },
    async close(id) {
      const done = (team().states?.nodes ?? []).filter(
        state => state.type === "completed"
      );
      if (done.length !== 1) {
        refuse("linear", "close", "terminal state unavailable");
      }
      await mutate(
        "close",
        "mutation($id:String!,$state:String!){issueUpdate" +
          "(id:$id,input:{stateId:$state}){success issue{id}}}",
        { id, state: done[0].id },
        id,
        false
      );
    },
  };
}

/** Build Sentry's issue adapter over the injected JSON transport. */
export function sentryAdapter(input) {
  const org = required(input, "sentry", "SENTRY_ORG");
  const project = required(input, "sentry", "SENTRY_PROJECT");
  const token = required(input, "sentry", "PROVIDER_TOKEN");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const base = `https://sentry.io/api/0/projects/${org}/${project}`;
  const list = async (operation = "list") => {
    const marker = JSON.stringify(CONDITION_MARKER);
    const query = `is:unresolved ${MARKER_TAG}:${marker}`;
    const raw = await input.request({
      operation,
      url: `${base}/issues/?query=${encodeURIComponent(query)}` + "&limit=100",
      options: { method: "GET", headers },
    });
    if (!Array.isArray(raw)) refuse("sentry", operation, "malformed response");
    if (raw.length > 100) refuse("sentry", operation, "result overflow");
    return await Promise.all(
      raw.map(issue => sentryListedGroup(input, operation, issue, headers))
    );
  };
  return sentryActions(input, { base, headers, list });
}

/** Resolve the public ingestion target from Sentry's authenticated key list. */
async function sentryIngestion(input, operation, base, headers) {
  const raw = await input.request({
    operation,
    url: `${base}/keys/`,
    options: { method: "GET", headers },
  });
  const publicDsn = Array.isArray(raw) ? raw[0]?.dsn?.public : null;
  let dsn;
  try {
    dsn = new URL(publicDsn);
  } catch {
    refuse("sentry", operation, "invalid public DSN");
  }
  const projectId = dsn.pathname.match(/^\/(\d+)$/u)?.[1];
  if (
    dsn.protocol !== "https:" ||
    !dsn.username ||
    dsn.password ||
    !projectId ||
    dsn.search ||
    dsn.hash
  ) {
    refuse("sentry", operation, "invalid public DSN");
  }
  return {
    url: `https://${dsn.host}/api/${projectId}/store/`,
    key: decodeURIComponent(dsn.username),
  };
}

/** Resolve one ingested event to its separately owned Sentry group. */
async function sentryGroup(input, eventId, base, headers) {
  const raw = await input.request({
    operation: "readback",
    url: `${base}/events/${eventId}/`,
    options: { method: "GET", headers },
  });
  const marker = Array.isArray(raw?.tags)
    ? raw.tags.filter(
        tag => tag?.key === MARKER_TAG && tag.value === CONDITION_MARKER
      )
    : [];
  if (
    raw?.eventID !== eventId ||
    typeof raw?.groupID !== "string" ||
    !raw.groupID ||
    raw.groupID === eventId ||
    marker.length !== 1
  ) {
    refuse("sentry", "readback", "event identity or marker authority");
  }
  return raw.groupID;
}

/** Materialize Sentry's write operations around the shared readback. */
function sentryActions(input, context) {
  const { base, headers, list } = context;
  const write = async (operation, id, draft) => {
    const ingestion = await sentryIngestion(input, operation, base, headers);
    const raw = await input.request({
      operation,
      url: ingestion.url,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth":
            "Sentry sentry_version=7, " + `sentry_key=${ingestion.key}`,
        },
        body: JSON.stringify({
          message: draft.title,
          fingerprint: [draft.marker],
          level: "error",
          tags: { [MARKER_TAG]: draft.marker },
          extra: { body: draft.body },
        }),
      },
    });
    const eventId = raw?.id;
    if (typeof eventId !== "string" || !eventId) {
      refuse("sentry", operation, "missing event identity");
    }
    const groupId = await sentryGroup(input, eventId, base, headers);
    if (id !== null && id !== groupId) {
      refuse("sentry", "readback", "group identity mismatch");
    }
    return readback("sentry", list, groupId, true);
  };
  return {
    async list() {
      return list();
    },
    async create(draft) {
      return write("create", null, draft);
    },
    async refresh(id, draft) {
      return write("refresh", id, draft);
    },
    async close(id) {
      await input.request({
        operation: "close",
        url: `https://sentry.io/api/0/issues/${id}/`,
        options: {
          method: "PUT",
          headers,
          body: '{"status":"resolved"}',
        },
      });
      await readback("sentry", list, id, false);
    },
  };
}
