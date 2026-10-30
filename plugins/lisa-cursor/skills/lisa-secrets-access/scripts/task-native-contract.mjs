/** Fixed Notion/MCP result boundary. No page-text parsing or supplied attestations. */
import { createHash } from "node:crypto";
import { AccessFailure, plainObject } from "./config-layers.mjs";
const stable = value =>
  Array.isArray(value)
    ? value.map(stable)
    : plainObject(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(k => [k, stable(value[k])])
        )
      : value;
export const fingerprint = value =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
const unsupported = () => {
  throw new AccessFailure("native-response-unrepresented");
};
const mismatch = () => {
  throw new AccessFailure("identity-mismatch");
};
const uuid =
  /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;

/** Normalize only an ID or a canonical Notion resource URL, never page content. */
export function notionId(value) {
  if (typeof value !== "string") return null;
  if (uuid.test(value)) return value.replaceAll("-", "").toLowerCase();
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !["notion.so", "www.notion.so", "notion.com", "www.notion.com"].includes(
        url.hostname
      )
    )
      return null;
    const segment = url.pathname.split("/").filter(Boolean).at(-1);
    const id = segment?.match(
      /[a-f0-9]{32}$|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
    )?.[0];
    return id ? id.replaceAll("-", "").toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Runtime-owned provenance is required; repository-configured lookalikes cannot mint proof. */
export function notionProbe(event, requirement) {
  const server = event.mcp_server;
  if (
    !plainObject(server) ||
    Object.keys(server).sort().join() !== "name,source" ||
    server.source !== "claudeai" ||
    server.name !== "claude_ai_Notion"
  )
    return null;
  const input = event.tool_input;
  if (!plainObject(input)) return null;
  if (
    event.tool_name === "mcp__claude_ai_Notion__notion-get-self" &&
    !Object.keys(input).length
  )
    return { kind: "self", connection: fingerprint(server) };
  if (
    event.tool_name === "mcp__claude_ai_Notion__notion-fetch" &&
    Object.keys(input).length === 1 &&
    input.id === requirement.resource &&
    notionId(input.id)
  )
    return { kind: "fetch", connection: fingerprint(server) };
  return null;
}

/** MCP JSON text must be one complete object, not a fragment embedded in prose. */
function resultObject(result) {
  if (!plainObject(result) || result.isError === true || result.error)
    unsupported();
  let value = result.structuredContent;
  if (
    value === undefined &&
    result.content?.length === 1 &&
    result.content[0].type === "text"
  ) {
    try {
      value = JSON.parse(result.content[0].text);
    } catch {
      unsupported();
    }
  }
  if (!plainObject(value) || value.error) unsupported();
  return value;
}

/** Stable notion-get-self fields, documented by the existing Notion producer. */
export function validateNotionSelf(result, cfg) {
  const value = resultObject(result),
    workspace = value.workspace,
    user = value.user;
  if (
    !plainObject(workspace) ||
    !plainObject(user) ||
    !uuid.test(workspace.id ?? "") ||
    !uuid.test(user.id ?? "") ||
    !["person", "bot"].includes(user.type) ||
    typeof workspace.name !== "string"
  )
    unsupported();
  const anchor = cfg.effective?.notion?.workspaceId;
  if (typeof anchor !== "string" || !anchor) mismatch();
  if (
    uuid.test(anchor)
      ? notionId(anchor) !== notionId(workspace.id)
      : anchor !== workspace.name
  )
    mismatch();
}

/** Positive standard MCP embedded-resource contract; arbitrary standard text is unrepresented.
 * MCP tools specification defines resource{uri,mimeType,text}. This does not assert
 * every installed Notion connection emits that variant. ChatGPT's fetch JSON is
 * a different producer contract and is deliberately NOT accepted on this route.
 */
export function validateNotionFetch(result, requirement) {
  if (
    !plainObject(result) ||
    result.isError === true ||
    result.error ||
    result.structuredContent?.error
  )
    unsupported();
  if (result.content?.length !== 1 || result.content[0].type !== "resource")
    unsupported();
  const resource = result.content[0].resource;
  if (
    !plainObject(resource) ||
    !["text/markdown", "text/plain"].includes(resource.mimeType) ||
    typeof resource.text !== "string" ||
    !resource.text.trim()
  )
    unsupported();
  const actual = notionId(resource.uri),
    expected = notionId(requirement.resource);
  if (!actual) unsupported();
  if (!expected || actual !== expected) mismatch();
  // Reject conflicting structured identity when an installed producer supplies it.
  const returned = result.structuredContent;
  for (const key of ["id", "url"])
    if (returned?.[key] !== undefined && notionId(returned[key]) !== expected)
      mismatch();
}
