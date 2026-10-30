/** Fixed GitHub reader bootstrap through the existing secrets and scoped access owners. */
import { execFileSync } from "node:child_process";
import { candidate, failure } from "./task-readiness.mjs";
import { githubAccess, githubEnvironment } from "./task-github.mjs";
import { AccessFailure } from "./config-layers.mjs";
import { readConfig } from "./surfaces.mjs";
import { taskBinding } from "./task-requirements.mjs";
import {
  intakeRequest,
  issueFields,
  prFields,
  graphQuery,
  historyQuery,
  pullRequestsQuery,
  reviewThreadsQuery,
  threadCommentsQuery,
} from "../../lisa-github-read-issue/read-contract.mjs";

/** Construct only the existing documented read argv; all remote values remain data. */
function readArguments(request, cfg) {
  const { operation: o, value: n, repo } = request,
    issue = `repos/${repo}/issues/${n}`;
  if (o === "issue" || o === "pr")
    return [
      o === "issue" ? "issue" : "pr",
      "view",
      n,
      "--repo",
      repo,
      "--json",
      o === "issue" ? issueFields : prFields,
    ];
  if (o === "comment-count") return ["api", issue, "--jq", ".comments"];
  if (o === "comments")
    return ["api", `${issue}/comments`, "--paginate", "--slurp"];
  if (o === "blocked-by" || o === "blocking")
    return [
      "api",
      `${issue}/dependencies/${o === "blocked-by" ? "blocked_by" : "blocking"}`,
      "--paginate",
      "--slurp",
    ];
  const query = {
    graph: graphQuery,
    history: historyQuery,
    "closing-prs": pullRequestsQuery,
    "review-threads": reviewThreadsQuery,
    "thread-comments": threadCommentsQuery,
  }[o];
  const params =
    o === "thread-comments"
      ? ["-F", `id=${n}`]
      : [
          "-F",
          `org=${cfg.effective.github.org}`,
          "-F",
          `repo=${cfg.effective.github.repo}`,
          "-F",
          `number=${n}`,
        ];
  return [
    "api",
    "graphql",
    "--paginate",
    "--slurp",
    "-f",
    `query=${query}`,
    ...params,
  ];
}
/** Probe native first; only genuine unavailability may select the supported fallback. */
function selectedAccess(cfg, repo) {
  const requirement = { operation: "repository-read", resource: repo };
  const native = githubAccess(cfg, requirement);
  if (native.code === "identity-mismatch" || native.code === "tool-missing")
    throw new AccessFailure(native.code);
  if (native.established) return null;
  let credential;
  try {
    credential = candidate(cfg, "GH_TOKEN");
    if (!credential.available) throw new AccessFailure(credential.code);
  } catch (error) {
    throw Object.assign(
      new AccessFailure(
        error instanceof AccessFailure ? error.code : "provider-unreachable"
      ),
      { sourceFailure: true }
    );
  }
  const supported = githubAccess(cfg, requirement, credential);
  if (!supported.established) throw new AccessFailure(supported.code);
  return credential;
}
/** No header is fabricated: access is exercised now and only this read runs. */
export function runIntakeRead(args = process.argv.slice(2)) {
  let cfg;
  try {
    cfg = readConfig();
    const request = intakeRequest(args, cfg),
      binding = taskBinding(cfg.projectRoot);
    if (
      !request ||
      (binding &&
        (binding.provider !== "github" ||
          !binding.ref.startsWith(`${request.repo}#`)))
    )
      throw new AccessFailure("requirements-stale");
    const credential = selectedAccess(cfg, request.repo),
      env = githubEnvironment(credential);
    let raw;
    try {
      raw = execFileSync("gh", readArguments(request, cfg), {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      throw new AccessFailure(
        error.code === "ENOENT" ? "tool-missing" : "capability-unreachable"
      );
    }
    if (env.GH_TOKEN && raw.includes(env.GH_TOKEN))
      throw new AccessFailure("capability-unreachable");
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new AccessFailure("capability-unreachable");
    }
    if (request.operation === "comments") {
      if (!Array.isArray(value) || !value.every(Array.isArray))
        throw new AccessFailure("capability-unreachable");
      value = value.flat();
    }
    console.log(JSON.stringify(value));
  } catch (error) {
    const result = failure(
      error instanceof AccessFailure ? error.code : "config-invalid",
      { cfg, name: "GH_TOKEN", tool: error.sourceFailure ? undefined : "gh" }
    );
    console.error(`${result.code}: ${result.action}`);
    process.exitCode = 2;
  }
}
