/** Native GitHub read-only transport and response validation for the issue reader. */
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import { runGh } from "./gh-cli.js";
import type { GitHubIssueRef } from "./github-reader-target.js";

const REQUEST_TIMEOUT_MS = 120_000;
const RESPONSE_BYTES = 32 * 1024 * 1024;

/** A shell-free GitHub CLI request through the selected native session. */
export type GitHubRead = (args: readonly string[]) => Promise<unknown>;

/**
 * Preserve the provider's actual complaint when it supplied one.
 * @param error - Native request failure.
 * @returns The provider diagnostic or the local execution error.
 */
export function githubReadError(error: unknown): string {
  if (
    isJsonObject(error) &&
    typeof error.stderr === "string" &&
    error.stderr.trim()
  )
    return error.stderr.trimEnd();
  return error instanceof Error ? error.message : String(error);
}

/**
 * Bind requests to one working directory and preserve native gh authentication.
 * @param cwd - Root used for the native calls.
 * @returns A JSON request with bounded output and a per-request deadline.
 */
export function nativeGitHubRead(cwd: string): GitHubRead {
  return async args => {
    const output = await runGh(
      args,
      cwd,
      REQUEST_TIMEOUT_MS,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      RESPONSE_BYTES
    );
    if (args[0] === "auth") return undefined;
    return JSON.parse(output) as unknown;
  };
}

/**
 * Require an object where a successful call promises one.
 * @param value - Provider result or field.
 * @param subject - Description for diagnostics.
 * @returns A validated object.
 */
export function responseObject(value: unknown, subject: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`GitHub did not return ${subject}`);
  return value;
}

/**
 * Require an array of records instead of silently dropping malformed entries.
 * @param value - Provider result or field.
 * @param subject - Description for diagnostics.
 * @returns Validated records.
 */
export function responseObjects(value: unknown, subject: string): JsonObject[] {
  if (!Array.isArray(value))
    throw new Error(`GitHub did not return ${subject}`);
  return value.map(item => responseObject(item, subject));
}

/**
 * Flatten all native REST pages for one repository resource.
 * @param read - The native GitHub request function.
 * @param route - A repository-scoped REST read endpoint.
 * @returns Records in native page order.
 */
export async function restPages(
  read: GitHubRead,
  route: string
): Promise<JsonObject[]> {
  const pages = await read(["api", route, "--paginate", "--slurp"]);
  if (!Array.isArray(pages) || pages.length === 0)
    throw new Error(`GitHub did not return all pages for ${route}`);
  return pages.flatMap(page => responseObjects(page, route));
}

/**
 * Read one GraphQL query, with explicit pagination for its one connection.
 * @param read - Native GitHub JSON reader.
 * @param query - Constant query from the reader.
 * @param variables - Typed input bindings.
 * @param paginate - Follow the query's $endCursor connection.
 * @returns GraphQL data objects, in response order.
 */
export async function graphql(
  read: GitHubRead,
  query: string,
  variables: Readonly<Record<string, string | number>>,
  paginate = false
): Promise<JsonObject[]> {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    ...Object.entries(variables).flatMap(([name, value]) => [
      typeof value === "number" ? "-F" : "-f",
      `${name}=${value}`,
    ]),
    ...(paginate ? ["--paginate", "--slurp"] : []),
  ];
  const result = await read(args);
  const pages = paginate
    ? responseObjects(result, "GraphQL pages")
    : [responseObject(result, "GraphQL response")];
  if (pages.length === 0) throw new Error("GitHub returned no GraphQL pages");
  return pages.map(page => responseObject(page.data, "GraphQL data"));
}

/**
 * Verify the complete sequence of a GitHub paginated connection.
 * @param pages - Projected connection page objects.
 * @param subject - Name shown in failures.
 * @returns Nodes in native page order.
 */
export function connectionNodes(
  pages: readonly JsonObject[],
  subject: string
): JsonObject[] {
  return pages.flatMap((page, index) => {
    const info = responseObject(page.pageInfo, `${subject} pagination`);
    const hasSuccessor = index < pages.length - 1;
    if (info.hasNextPage !== hasSuccessor)
      throw new Error(`GitHub returned incomplete ${subject}`);
    return responseObjects(page.nodes, subject);
  });
}

/**
 * Get one issue or PR response within a repository selected by native variables.
 * @param page - GraphQL data page.
 * @param kind - Issue or PR field.
 * @returns A validated repository item.
 */
export function repositoryItem(
  page: JsonObject,
  kind: "issue" | "pullRequest"
): JsonObject {
  return responseObject(
    responseObject(page.repository, "a repository")[kind],
    kind
  );
}

/**
 * Bind repository, owner and item number as separate native variables.
 * @param ref - The selected GitHub reference.
 * @returns Bindings accepted by the issue and PR queries.
 */
export function itemVariables(ref: GitHubIssueRef) {
  return { owner: ref.owner, repo: ref.repo, number: ref.number };
}
