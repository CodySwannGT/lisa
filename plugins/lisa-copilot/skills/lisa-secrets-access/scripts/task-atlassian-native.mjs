/** Existing Atlassian owner's fixed tenant and resource probes; no text scraping. */
import { AccessFailure, plainObject } from "./config-layers.mjs";
const prefix = "mcp__plugin_atlassian_atlassian__";
const fail = code => {
  throw new AccessFailure(code);
};
const unsupported = () => fail("native-response-unrepresented");
const mismatch = () => fail("identity-mismatch");
function host(value) {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.hostname
      : null;
  } catch {
    return null;
  }
}
export const atlassianSupported = r =>
  r?.access_layer === "atlassian" &&
  ["issue-type-metadata", "list-spaces"].includes(r.operation);
export function atlassianProbe(event, r, cfg) {
  if (
    !atlassianSupported(r) ||
    event.mcp_server?.name !== "plugin:atlassian:atlassian" ||
    event.mcp_server?.source !== "plugin" ||
    Object.keys(event.mcp_server).sort().join() !== "name,source" ||
    !plainObject(event.tool_input)
  )
    return null;
  const input = event.tool_input;
  if (
    event.tool_name === prefix + "getAccessibleAtlassianResources" &&
    !Object.keys(input).length
  )
    return { kind: "self" };
  if (input.cloudId !== cfg.effective.atlassian.cloudId) return null;
  if (
    r.operation === "list-spaces" &&
    event.tool_name === prefix + "getConfluenceSpaces" &&
    Object.keys(input).join() === "cloudId"
  )
    return { kind: "fetch" };
  if (
    r.operation === "issue-type-metadata" &&
    event.tool_name === prefix + "getJiraProjectIssueTypesMetadata" &&
    Object.keys(input).sort().join() === "cloudId,projectIdOrKey" &&
    input.projectIdOrKey === r.resource
  )
    return { kind: "fetch" };
  return null;
}
function valueOf(result) {
  if (!plainObject(result) || result.isError === true || result.error)
    unsupported();
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (result.content?.length !== 1 || result.content[0].type !== "text")
    unsupported();
  try {
    return JSON.parse(result.content[0].text);
  } catch {
    unsupported();
  }
}
export function validateAtlassian(kind, result, r, cfg) {
  const value = valueOf(result),
    tenant = cfg.effective.atlassian;
  if (kind === "self") {
    if (!Array.isArray(value)) unsupported();
    if (!host(tenant.site)) mismatch();
    if (
      !value.some(
        row =>
          plainObject(row) &&
          row.id === tenant.cloudId &&
          host(row.url ?? "") === host(tenant.site) &&
          Array.isArray(row.scopes) &&
          row.scopes.every(s => typeof s === "string")
      )
    )
      mismatch();
    return;
  }
  if (
    !plainObject(value) ||
    value.error ||
    value.errors ||
    value.errorMessages?.length
  )
    unsupported();
  for (const key of ["cloudId", "cloudid"])
    if (value[key] !== undefined && value[key] !== tenant.cloudId) mismatch();
  if (
    value._links?.base !== undefined &&
    host(value._links.base) !== host(tenant.site)
  )
    mismatch();
  if (r.operation === "issue-type-metadata") {
    if (
      !Array.isArray(value.issueTypes) ||
      !Number.isInteger(value.startAt) ||
      !Number.isInteger(value.maxResults) ||
      !Number.isInteger(value.total) ||
      value.startAt < 0 ||
      value.total < 0 ||
      !value.issueTypes.every(
        row =>
          plainObject(row) &&
          typeof row.id === "string" &&
          row.id &&
          typeof row.name === "string" &&
          typeof row.subtask === "boolean"
      )
    )
      unsupported();
    if (
      value.projectIdOrKey !== undefined &&
      value.projectIdOrKey !== r.resource
    )
      mismatch();
    for (const row of value.issueTypes)
      if (row.self !== undefined && host(row.self) !== host(tenant.site))
        mismatch();
  } else if (
    !Array.isArray(value.results) ||
    !value.results.every(
      row =>
        plainObject(row) &&
        typeof row.id === "string" &&
        row.id &&
        typeof row.key === "string" &&
        row.key &&
        typeof row.name === "string" &&
        ["global", "personal"].includes(row.type)
    )
  )
    unsupported();
}
export const isAtlassianProbe = event =>
  [
    "getAccessibleAtlassianResources",
    "getConfluenceSpaces",
    "getJiraProjectIssueTypesMetadata",
  ].some(suffix => event.tool_name === prefix + suffix);
