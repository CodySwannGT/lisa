// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-tracker-wire.mjs
 * @description Credentials, bounded JSON transport and the lossless managed-text codecs
 * shared by the npm updater's Jira and Linear adapters (CodySwannGT/lisa#4859).
 * @module npm-updater
 */
import {
  required,
  operatorRefusal,
  withProviderOperation,
} from "./npm-update-invariants.mjs";
import { jiraServerOrigin } from "../lisa-work-item.mjs";

const RESPONSE_BOUND = 3_145_728;
const NOTHING_CREATED =
  "Add it as a repository secret and pass it to the npm updater workflow. Nothing was created.";

/** A fixed operator sentence naming exactly one missing variable or key; never its value. */
function missing(name, what) {
  return operatorRefusal(
    "tracker credential is absent",
    `${name} is not set, so the npm updater cannot ${what}. ${NOTHING_CREATED}`
  );
}

/**
 * Jira login, token and base URL. The site comes only from committed config
 * (never JIRA_SERVER), because that origin receives the token.
 */
function jiraCredentials(config, env) {
  const token = env.JIRA_API_TOKEN || env.ATLASSIAN_API_TOKEN;
  if (!token) throw missing("JIRA_API_TOKEN", "create Jira work items");
  const login = env.JIRA_LOGIN || String(config.atlassian?.email ?? "").trim();
  if (!login) throw missing("JIRA_LOGIN", "create Jira work items");
  const cloudId = String(config.atlassian?.cloudId ?? "").trim();
  const server = String(config.atlassian?.site ?? "");
  if (!cloudId && !server)
    throw operatorRefusal(
      "tracker site is absent",
      "Neither atlassian.cloudId nor atlassian.site is configured, so the npm updater cannot reach Jira. Nothing was created."
    );
  const baseUrl = cloudId
    ? `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}`
    : jiraServerOrigin(server);
  const basic = Buffer.from(`${login}:${token}`).toString("base64");
  return { baseUrl, authorization: `Basic ${basic}` };
}

/** Linear accepts LINEAR_API_KEY or the workspace-scoped LINEAR_API_KEY_<workspace>. */
function linearCredentials(config, env) {
  const suffix = String(config.linear?.workspace ?? "")
    .toLowerCase()
    .replace(/-/g, "_");
  const key = env.LINEAR_API_KEY || (suffix && env[`LINEAR_API_KEY_${suffix}`]);
  if (!key) throw missing("LINEAR_API_KEY", "create Linear work items");
  return { baseUrl: "https://api.linear.app/graphql", authorization: key };
}

/** A Jira accountId or a Linear user id, the same grammar the policy maintainer uses. */
const ACTOR = {
  jira: /^[A-Za-z0-9][A-Za-z0-9:-]{0,127}$/,
  linear: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};
const ACTOR_NAME = { jira: "Jira accountId", linear: "Linear user id" };
const ACTOR_CREDENTIAL = { jira: "JIRA_API_TOKEN", linear: "LINEAR_API_KEY" };

/**
 * The automation identity the project declares for its tracker (#4873). A claim,
 * checkpoint or closure counts as the updater's own only when this account wrote
 * it, so an absent or malformed declaration refuses before any provider call.
 */
export function declaredActor(config) {
  const tracker = config.tracker;
  const value = config[tracker]?.claimActorRef;
  if (typeof value !== "string" || !ACTOR[tracker]?.test(value))
    throw operatorRefusal(
      "tracker automation identity is not declared",
      `${tracker}.claimActorRef is not set in .lisa.config.json, so the npm updater cannot tell its own claims from anyone else's. Set it to the ${ACTOR_NAME[tracker]} of the account its ${ACTOR_CREDENTIAL[tracker]} signs in as. Nothing was created.`
    );
  return value;
}

/** The credential must sign in as the declared identity; any other account fails closed. */
export function assertDeclaredActor(tracker, actual, declared) {
  if (actual !== declared)
    throw operatorRefusal(
      "tracker credential is not the declared automation identity",
      `The ${ACTOR_CREDENTIAL[tracker]} signs in as a different account than ${tracker}.claimActorRef, so the npm updater cannot prove its claims were made by the automation. Use the automation account's credential or correct ${tracker}.claimActorRef. Nothing was changed.`
    );
  return actual;
}

/** A claim written by any account but the declared automation identity never authorizes (#4873). */
export function assertClaimAuthor(tracker, ref, author, declared) {
  if (author !== declared)
    throw operatorRefusal(
      "tracker claim author differs",
      `The claim on ${ref} was not made by the npm updater's automation account (${tracker}.claimActorRef), so nothing was published or changed. Remove that claim and let the updater claim the item again.`
    );
}

/** Resolved before any provider call, so a gap can never follow a partial write. */
export function trackerCredentials(config, env) {
  required(
    config.tracker === "jira" || config.tracker === "linear",
    "configured tracker has no API adapter"
  );
  return config.tracker === "jira"
    ? jiraCredentials(config, env)
    : linearCredentials(config, env);
}

/** Bytes past the bound are never buffered: a declared length refuses unread, a stream stops mid-read. */
async function boundedText(response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > RESPONSE_BOUND) {
    await response.body?.cancel();
    required(false, "provider response exceeds bound");
  }
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  for (let next = await reader?.read(); next && !next.done; ) {
    size += next.value.byteLength;
    if (size > RESPONSE_BOUND) {
      await reader.cancel();
      required(false, "provider response exceeds bound");
    }
    chunks.push(next.value);
    next = await reader.read();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks)
  );
}

/**
 * One bounded JSON request; a refused status is opaque, never echoed. Only a
 * caller that sets `missing: true` reads a 404 as an absent record (null).
 */
export async function jsonCall(transport, url, request, purpose) {
  const method = request.method ?? "GET";
  return withProviderOperation(purpose, method, async () => {
    const response = await transport(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: request.authorization,
        ...(request.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await boundedText(response);
    if (request.missing === true && response.status === 404) return null;
    required(response.ok, "tracker provider refused request");
    return text ? JSON.parse(text) : null;
  });
}

/** Jira stores rich text as ADF; a single code block keeps every managed byte, markers included. */
export function adfCodeBlock(text) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "codeBlock",
        content: text ? [{ type: "text", text }] : [],
      },
    ],
  };
}

/** Text nodes of any ADF subtree, in document order. */
function textNodes(node) {
  if (!node || typeof node !== "object") return [];
  if (node.type === "text") return [String(node.text ?? "")];
  return (Array.isArray(node.content) ? node.content : []).flatMap(textNodes);
}

/**
 * The managed form (exactly one code block) reads back losslessly. Anything a
 * human wrote reads as its paragraphs joined by newlines: enough to classify a
 * hold, and never equal to a managed body because it was not one code block.
 */
export function adfText(document) {
  const blocks = Array.isArray(document?.content) ? document.content : [];
  if (blocks.length === 1 && blocks[0]?.type === "codeBlock")
    return textNodes(blocks[0]).join("");
  return blocks.map(block => textNodes(block).join("")).join("\n");
}

/** Backticks inside code are made inert so a projected code boundary cannot be closed early. */
function inert(text) {
  return String(text ?? "").replace(/`/g, "'");
}

/** One ADF node as Markdown-shaped prose: code stays inside a code boundary. */
function proseOf(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "codeBlock")
    return `\n\`\`\`\n${inert(textNodes(node).join(""))}\n\`\`\`\n`;
  if (node.type === "text")
    return (Array.isArray(node.marks) ? node.marks : []).some(
      mark => mark?.type === "code"
    )
      ? `\`${inert(node.text).replace(/\n/g, " ")}\``
      : // A stray plain-text backtick would pair with a projected code boundary
        // and move the hold classifier's view of what is code (#4873).
        inert(node.text);
  if (node.type === "hardBreak") return "\n";
  const inline = node.type === "paragraph" || node.type === "heading";
  return (Array.isArray(node.content) ? node.content : [])
    .map(proseOf)
    .join(inline ? "" : "\n");
}

/**
 * What the human-hold classifier reads for a Jira comment. Unlike adfText
 * (the lossless managed-record form), a code block or inline code keeps a
 * Markdown code boundary, so a marker written inside an example is
 * documentation, never a release — the same rule GitHub and Linear text get.
 */
export function adfProse(document) {
  return proseOf(document);
}

const OPEN = "````lisa\n";
const CLOSE = "\n````";

/** Linear stores Markdown; a four-backtick fence nests the leaf's own ``` blocks unchanged. */
export function fence(text) {
  return `${OPEN}${text}${CLOSE}`;
}

/** Exact managed fence → its bytes; any other body (a human's) is returned as written. */
export function unfence(body) {
  const value = String(body ?? "");
  return value.startsWith(OPEN) &&
    value.endsWith(CLOSE) &&
    value.length >= OPEN.length + CLOSE.length
    ? value.slice(OPEN.length, -CLOSE.length)
    : value;
}

/**
 * A vendor status read back in any letter case is reported in the configured
 * spelling, the way the build-intake skills match it; other names pass unchanged.
 */
export function lifecycleName(lifecycle, name) {
  const value = String(name ?? "");
  return (
    lifecycle.roles.find(role => role.toLowerCase() === value.toLowerCase()) ??
    value
  );
}

/** Statuses, issue types and priorities are workflow configuration; the updater never provisions them. */
export function vocabularyRefusal(vendor) {
  return operatorRefusal(
    "tracker vocabulary lacks a lifecycle role",
    `The ${vendor} project is missing a status, issue type or priority the npm updater needs (Task, Medium priority, and the configured ready and in-progress statuses). Add it in ${vendor} or change the lifecycle configuration. Nothing was created.`
  );
}

/** Jira's documented 32,767-character rich-text field limit, refused before that write. */
export function withinJiraLimit(text) {
  if (typeof text !== "string" || text.length > 32_767)
    throw operatorRefusal(
      "managed text exceeds the Jira field limit",
      "A description or comment the npm updater must write is longer than Jira's 32,767-character limit, so it stopped before writing it."
    );
  return text;
}

/** A ticket that exists but never reached Ready is named, so the operator can finish or remove it. */
export function strandedRefusal(ref, ready) {
  return operatorRefusal(
    "created work item is not build-ready",
    `${ref} was created but could not be moved to ${ready}. Move it to ${ready} by hand or fix the workflow transition, then rerun.`
  );
}

/**
 * Typed labels are free text anyone can add, so a label spelled like a
 * lifecycle status, a `type:` or a `priority:` is dropped before it can stand
 * in for the value derived from the tracker's own fields. Other labels, such
 * as the human-hold marker, pass through.
 */
export function vendorLabels(lifecycle, names) {
  const reserved = new Set(lifecycle.roles.map(role => role.toLowerCase()));
  return (names ?? []).filter(name => {
    const value = String(name).toLowerCase();
    return (
      !reserved.has(value) &&
      !value.startsWith("type:") &&
      !value.startsWith("priority:")
    );
  });
}

// Linear connection helpers, shared here to keep the Linear adapter within its size budget.

/** The node selection each issue connection reads; the issue query and its page queries share it. */
export const LINEAR_CONNECTIONS = {
  labels: "name",
  children: "id",
  inverseRelations: "type issue { state { type } archivedAt }",
};
/** Pages per connection, 100 nodes each, before the inventory is called unbounded. */
const LINEAR_CONNECTION_PAGES = 10;

/** One connection's next page, addressed by the issue identifier and an opaque cursor. */
function connectionPageQuery(name) {
  const operation = `LisaNpmIssue${name[0].toUpperCase()}${name.slice(1)}`;
  return `query ${operation}($id: String!, $after: String) { issue(id: $id) { ${name}(first: 100, after: $after) { nodes { ${LINEAR_CONNECTIONS[name]} } pageInfo { hasNextPage endCursor } } } }`;
}

/**
 * Labels, sub-issues and relations decide holds and blockers, so a partial
 * page is never read as the whole inventory: each connection is read to its
 * end by cursor, and one past the fixed bound refuses, naming the issue
 * (CodySwannGT/lisa#4873).
 * @param {object} node - The issue node, its connections on their first page.
 * @param {(query: string, variables: object) => Promise<object>} graphql - Data-returning call.
 * @returns {Promise<object>} The node with every connection's complete node list.
 */
export async function completeLinearConnections(node, graphql) {
  const complete = {};
  for (const name of Object.keys(LINEAR_CONNECTIONS)) {
    let connection = node[name];
    const nodes = [...(connection?.nodes ?? [])];
    for (let page = 1; connection?.pageInfo?.hasNextPage !== false; page++) {
      if (
        page >= LINEAR_CONNECTION_PAGES ||
        typeof connection?.pageInfo?.endCursor !== "string"
      )
        throw operatorRefusal(
          "issue connection is incomplete",
          `Linear issue ${node.identifier} has more than ${LINEAR_CONNECTION_PAGES * 100} labels, sub-issues or relations, so the npm updater cannot confirm there is no hold or open blocker. Remove the extra ones or handle this update by hand.`
        );
      connection = (
        await graphql(connectionPageQuery(name), {
          id: node.identifier,
          after: connection.pageInfo.endCursor,
        })
      ).issue?.[name];
      required(
        Array.isArray(connection?.nodes),
        "provider page is not an array"
      );
      nodes.push(...connection.nodes);
    }
    complete[name] = { nodes };
  }
  return { ...node, ...complete };
}

/** Completed, cancelled and archived issues are closed history, never claimable. */
export function linearClosed(node) {
  return (
    Boolean(node?.archivedAt) ||
    ["completed", "canceled"].includes(node?.state?.type)
  );
}

/** A GraphQL connection page in the bounded search shape discoverPrior already checks. */
export function linearSearchResult(connection) {
  const nodes = connection?.nodes;
  required(Array.isArray(nodes), "tracker search reply differs");
  return {
    incomplete_results: connection.pageInfo?.hasNextPage !== false,
    total_count: nodes.length,
    items: nodes.map(node => ({
      number: node.number,
      state: linearClosed(node) ? "closed" : "open",
    })),
  };
}
