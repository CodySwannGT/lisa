/** Opt-in multi-issue routing; the existing single-state transport is unchanged. */
import { readFileSync } from "node:fs";

/**
 * Resolve one explicitly registered issue and reject cross-repository selectors.
 * @param {string[]} args Actual native CLI arguments.
 * @param {object} env Owned provider environment.
 * @param {function(string[]): string|undefined} option Existing option reader.
 * @param {string|undefined} query Actual GraphQL query.
 * @returns {object|undefined} Selected registry row, or the original single-state mode.
 */
export function selectProviderIssue(args, env, option, query) {
  if (!env.FAKE_GH_ISSUES_FILE) return undefined;
  const registry = JSON.parse(readFileSync(env.FAKE_GH_ISSUES_FILE, "utf8"));
  const endpoint = args.find(value => value.startsWith("repos/"));
  const parts = endpoint?.split("/") ?? [];
  const repository = parts.length >= 3 ? `${parts[1]}/${parts[2]}` : undefined;
  const declared = option(["--repo", "-R"]);
  const hierarchy = args[1] === "graphql" && query?.includes("subIssues");
  const field = name =>
    args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
  if (
    (repository && repository !== registry.repository) ||
    (declared && declared !== registry.repository) ||
    (hierarchy && `${field("owner")}/${field("repo")}` !== registry.repository)
  )
    throw new Error("Controlled provider rejected another repository");
  const number =
    args[0] === "issue" && args[1] !== "list"
      ? args[2]
      : parts[3] === "issues"
        ? parts[4]?.split("?")[0]
        : hierarchy
          ? field("number")
          : registry.default_number;
  const row = registry.issues[number];
  if (!row) throw new Error("Unknown controlled issue selector");
  const state = JSON.parse(readFileSync(row.state_file, "utf8"));
  if (String(state.number) !== String(number))
    throw new Error("Controlled issue state identity mismatch");
  env.FAKE_GH_STATE_FILE = row.state_file;
  return { registry, row };
}

/**
 * Return only open registered issues carrying the requested lifecycle role.
 * @param {object} selected Selected owned registry.
 * @param {string} label Exact requested role.
 * @returns {object[]} Native-shaped issue listing.
 */
export function providerIssueList(selected, label) {
  return Object.values(selected.registry.issues)
    .map(row => JSON.parse(readFileSync(row.state_file, "utf8")))
    .filter(
      issue =>
        issue.state === "OPEN" && issue.labels.some(row => row.name === label)
    )
    .map(issue => ({
      number: issue.number,
      title: issue.title ?? "Synthetic issue",
    }));
}
