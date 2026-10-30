/** Fixed preclaim intake admission, never a generic tool or shell exception. */
import {
  issueFields,
  relatedFields,
  prFields,
  queries,
  reviewThreadsQuery,
  threadCommentsQuery,
  intakeRequest,
} from "../../lisa-github-read-issue/read-contract.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const owner = join(
  dirname(fileURLToPath(import.meta.url)),
  "preflight-secrets.mjs"
);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
/** Exact fixed owner invocation, containing values-free identifiers only. */
function intakeOwner(input, cfg) {
  if (
    input.tool_name !== "Bash" ||
    typeof input.tool_input?.command !== "string"
  )
    return false;
  const command = input.tool_input.command;
  for (const runtime of ["node", process.execPath, quote(process.execPath)])
    for (const script of [owner, quote(owner)]) {
      const prefix = `${runtime} ${script} `;
      if (
        command.startsWith(prefix) &&
        intakeRequest(command.slice(prefix.length).split(" "), cfg)
      )
        return true;
    }
  return false;
}
const refs =
  /^(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*|[A-Z][A-Z0-9]+-[1-9]\d*)$/;
export function configuredRef(cfg, ref) {
  if (typeof ref !== "string" || !refs.test(ref)) return false;
  const c = cfg.effective;
  if (c.tracker === "github" || (!c.tracker && c.github))
    return ref.startsWith(`${c.github?.org}/${c.github?.repo}#`);
  if (c.tracker === "jira") return ref.startsWith(`${c.jira?.project}-`);
  if (c.tracker === "linear") return ref.startsWith(`${c.linear?.teamKey}-`);
  return true;
}
export const resolverPrompt = ref =>
  `Invoke lisa-track ${ref}; resolve the complete live issue, comments and graph; prepare requirements and prove access before any claim. Do not implement or change source.`;
function loadOwner(input, cfg) {
  const tool = input.tool_input;
  if (!tool || Object.keys(tool).some(k => !["skill", "args"].includes(k)))
    return false;
  const tracker = cfg.effective.tracker ?? "github";
  const fixed = new Set([
    "lisa-implement",
    "lisa-track",
    "lisa-tracker-read",
    "lisa-secrets-access",
    `lisa-${tracker}-read-${tracker === "jira" ? "ticket" : "issue"}`,
  ]);
  for (const [role, route] of Object.entries(cfg.routing ?? {})) {
    if (["notion", "atlassian", "linear", "sentry"].includes(route))
      fixed.add(`lisa-${route}-access`);
    if (["jira", "confluence"].includes(route))
      fixed.add("lisa-atlassian-access");
  }
  const skill =
    typeof tool.skill === "string" ? tool.skill.replace(/^lisa:/, "lisa-") : "";
  return (
    fixed.has(skill) &&
    (tool.args === undefined || configuredRef(cfg, tool.args))
  );
}
function delegate(input, cfg) {
  const a = input.tool_input;
  if (
    !a ||
    Object.keys(a).sort().join() !== "description,name,prompt,subagent_type" ||
    a.name !== "input-resolver" ||
    a.subagent_type !== "general-purpose" ||
    a.description !== "Resolve Lisa input"
  )
    return false;
  const prefix = "Invoke lisa-track ",
    suffix =
      "; resolve the complete live issue, comments and graph; prepare requirements and prove access before any claim. Do not implement or change source.";
  return (
    typeof a.prompt === "string" &&
    a.prompt.startsWith(prefix) &&
    a.prompt.endsWith(suffix) &&
    configuredRef(cfg, a.prompt.slice(prefix.length, -suffix.length))
  );
}
/** Exact owning reader commands; no general shell or GraphQL parser. */
function trackerRead(input, cfg) {
  if (input.tool_name !== "Bash") return false;
  const c = cfg.effective,
    command = input.tool_input?.command;
  if (
    typeof command !== "string" ||
    !c.github ||
    (c.tracker && c.tracker !== "github")
  )
    return false;
  const repo = `${c.github.org}/${c.github.repo}`;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return false;
  const prefix = `gh api repos/${repo}/issues/`;
  const quotedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    new RegExp(
      `^gh issue view [1-9]\\d* --repo ${quotedRepo} --json (?:${issueFields}|${relatedFields})$`
    ).test(command)
  )
    return true;
  if (
    new RegExp(
      `^gh pr view [1-9]\\d* --repo ${quotedRepo} --json ${prFields}$`
    ).test(command)
  )
    return true;
  for (const query of [...queries, reviewThreadsQuery]) {
    const base = `gh api graphql --paginate --slurp -f query='${query}' -F org=${c.github.org} -F repo=${c.github.repo} -F number=`;
    if (
      command.startsWith(base) &&
      /^[1-9]\d*$/.test(command.slice(base.length))
    )
      return true;
  }
  const thread = `gh api graphql --paginate --slurp -f query='${threadCommentsQuery}' -F id=`;
  if (
    command.startsWith(thread) &&
    /^[A-Za-z0-9_+/=-]{1,256}$/.test(command.slice(thread.length))
  )
    return true;
  if (!command.startsWith(prefix)) return false;
  return (
    /^[1-9]\d*(?: --jq \.comments)?$/.test(command.slice(prefix.length)) ||
    /^[1-9]\d*\/comments --paginate --slurp \| jq 'add \/\/ \[\](?: \| length)?'$/.test(
      command.slice(prefix.length)
    ) ||
    /^[1-9]\d*\/(?:comments|timeline|sub_issues|dependencies\/(?:blocked_by|blocking)) --paginate --slurp$/.test(
      command.slice(prefix.length)
    )
  );
}
export function intakeRead(input, cfg) {
  return (
    (input.tool_name === "Skill" && loadOwner(input, cfg)) ||
    (input.tool_name === "Agent" && delegate(input, cfg)) ||
    trackerRead(input, cfg) ||
    intakeOwner(input, cfg)
  );
}
