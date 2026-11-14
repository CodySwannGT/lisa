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

/** One bounded JSON request; a refused status is opaque, never echoed. */
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

/**
 * Labels, sub-issues and relations decide holds and blockers, so a partial
 * page is never read as the whole inventory: one more page refuses.
 */
export function completeLinearConnections(node) {
  const partial = ["labels", "children", "inverseRelations"].some(
    name => node[name]?.pageInfo?.hasNextPage !== false
  );
  if (partial)
    throw operatorRefusal(
      "issue connection is incomplete",
      "This Linear issue has more than 100 labels, sub-issues or relations, so the npm updater cannot confirm there is no hold or open blocker. Remove the extra ones or handle this update by hand."
    );
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
