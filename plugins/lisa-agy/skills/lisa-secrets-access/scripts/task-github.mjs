/** Scoped GitHub probe. Selected credentials exist only in the child environment. */
import { execFileSync } from "node:child_process";
import { AccessFailure } from "./config-layers.mjs";
/** Fixed HTTPS host and selected credential only in child memory. */
export function githubEnvironment(credential) {
  const env = { ...process.env, GH_HOST: "github.com" };
  if (credential?.available) {
    env.GH_TOKEN = credential.value;
    delete env.GITHUB_TOKEN;
    delete env.GH_ENTERPRISE_TOKEN;
    delete env.GITHUB_ENTERPRISE_TOKEN;
  }
  return env;
}

/** Observe authenticated user separately from repository ownership. */
export function githubAccess(cfg, requirement, credential) {
  const github = cfg.effective?.github;
  const resource = github && `${github.org}/${github.repo}`;
  if (
    !github ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(resource) ||
    requirement.resource !== resource ||
    requirement.operation !== "repository-read"
  )
    throw new AccessFailure("requirements-stale");
  const env = githubEnvironment(credential);
  const api = endpoint =>
    JSON.parse(
      execFileSync("gh", ["api", endpoint], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      })
    );
  let user, repo;
  try {
    user = api("user");
  } catch {
    user = null;
  }
  try {
    repo = api(`repos/${resource}`);
  } catch (error) {
    return {
      outcome: "DENIED",
      established: false,
      code: error.code === "ENOENT" ? "tool-missing" : "capability-unreachable",
      tool: "gh",
      provider_health: credential?.provider_health ?? "not-observed",
    };
  }
  if (
    (user &&
      (!Number.isSafeInteger(user.id) ||
        user.id <= 0 ||
        typeof user.login !== "string" ||
        !/^[A-Za-z0-9-]+$/.test(user.login))) ||
    repo.full_name !== resource ||
    repo.owner?.login !== github.org ||
    repo.permissions?.pull !== true
  )
    return {
      outcome: "DENIED",
      established: false,
      code: "identity-mismatch",
      tool: "gh",
    };
  return {
    outcome: "ESTABLISHED",
    established: true,
    code: "ok",
    source: credential?.available
      ? "supported-github-credential"
      : "native-github",
    authenticated_actor_observed: Boolean(user),
    ...(user ? { authenticated_actor_id: user.id } : {}),
    repository_observed: true,
    provider_health: credential?.provider_health ?? "not-observed",
  };
}
