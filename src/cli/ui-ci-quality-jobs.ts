/**
 * Live-status probe for the CI Quality jobs Active column.
 *
 * Three-input join: `ci.yml` skip/gate inputs, Lisa gate config, and
 * presence-only `gh secret list`. READ-ONLY — never fabricates "off" for
 * secrets when authentication is unavailable.
 * @module cli/ui-ci-quality-jobs
 */
import { execFile } from "node:child_process";
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import {
  computeCiQualityJobs,
  type CiQualityJobsValue,
  type RepoSecretsPresence,
} from "./ui-ci-quality-jobs-compute.js";
import {
  parseCiWorkflowInputs,
  readCiYmlFile,
} from "./ui-ci-quality-jobs-parse.js";
import type { StatusProbe } from "./ui-status.js";

export {
  computeCiQualityJobs,
  type CiQualityJobEntry,
  type CiQualityJobsValue,
  type CiWorkflowInputs,
  type RepoSecretsPresence,
} from "./ui-ci-quality-jobs-compute.js";
export { parseCiWorkflowInputs } from "./ui-ci-quality-jobs-parse.js";

/** Stable probe id consumed by the console Active-column hydrator. */
export const CI_QUALITY_JOBS_PROBE_ID = "ci-quality-jobs";

/** Injectable collaborators for focused unit tests. */
export interface CiQualityJobsDependencies {
  readonly listSecrets?: (
    cwd: string,
    timeoutMs: number,
    signal: AbortSignal,
    repo: string | undefined
  ) => Promise<RepoSecretsPresence>;
  readonly readCiYml?: (cwd: string) => Promise<string>;
  readonly resolveRepo?: (
    cwd: string,
    config: JsonObject
  ) => string | undefined;
}

/**
 * Resolve `owner/repo` from Lisa config when both fields are non-empty strings.
 * @param config - Merged Lisa config
 * @returns Repo slug, or undefined when absent
 */
function repoFromConfig(config: JsonObject): string | undefined {
  if (!isJsonObject(config.github)) {
    return undefined;
  }
  const org = config.github.org;
  const repo = config.github.repo;
  if (
    typeof org === "string" &&
    org.trim().length > 0 &&
    typeof repo === "string" &&
    repo.trim().length > 0
  ) {
    return `${org.trim()}/${repo.trim()}`;
  }
  return undefined;
}

/**
 * Classify a failed `gh secret list` into not-authenticated vs other unknown.
 * @param error - Child-process or parse error
 * @returns Unknown secrets presence
 */
function classifySecretListError(error: unknown): RepoSecretsPresence {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "Unable to list repository secrets";
  const lower = message.toLowerCase();
  const notAuthenticated =
    lower.includes("401") ||
    lower.includes("bad credentials") ||
    lower.includes("not logged in") ||
    lower.includes("authentication required") ||
    lower.includes("to re-authenticate") ||
    lower.includes("gh auth login");
  return {
    state: "unknown",
    reason: notAuthenticated ? "not-authenticated" : "secret-list-failed",
    message: notAuthenticated ? "GitHub CLI is not authenticated" : message,
  };
}

/**
 * Parse `gh secret list --json name` stdout into a presence set.
 * @param stdout - Command stdout
 * @returns Presence-only secret names
 */
function secretNamesFromJson(stdout: string): ReadonlySet<string> {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new TypeError("gh secret list did not return an array");
  }
  return new Set(
    parsed.flatMap(entry => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }
      const name = Reflect.get(entry, "name");
      return typeof name === "string" && name.trim().length > 0 ? [name] : [];
    })
  );
}

/**
 * List Actions secret *names* only via `gh secret list --json name`.
 * @param cwd - Project root
 * @param timeoutMs - Child-process timeout
 * @param signal - Probe cancellation
 * @param repo - Optional `owner/repo` for `-R`
 * @returns Presence set or unknown
 */
const listRepoSecretNames: NonNullable<
  CiQualityJobsDependencies["listSecrets"]
> = async (cwd, timeoutMs, signal, repo) =>
  await new Promise((resolve, reject) => {
    const args =
      repo !== undefined && repo.length > 0
        ? (["secret", "list", "--json", "name", "-R", repo] as const)
        : (["secret", "list", "--json", "name"] as const);
    const ghExecutable = "gh";
    execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed gh executable
      ghExecutable,
      [...args],
      { cwd, signal, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        try {
          resolve({ state: "value", names: secretNamesFromJson(stdout) });
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });

/**
 * Load secret presence, mapping command failures to honest unknown states.
 * @param listSecrets - Injectable secret lister
 * @param cwd - Project root
 * @param timeoutMs - Child-process timeout
 * @param signal - Probe cancellation
 * @param repo - Optional repo slug
 * @returns Presence inventory or unknown
 */
async function loadSecretsPresence(
  listSecrets: NonNullable<CiQualityJobsDependencies["listSecrets"]>,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
  repo: string | undefined
): Promise<RepoSecretsPresence> {
  try {
    return await listSecrets(cwd, timeoutMs + 250, signal, repo);
  } catch (error) {
    return classifySecretListError(error);
  }
}

/**
 * Create the CI quality-jobs Active-column probe.
 * @param cwd - Project root
 * @param config - Merged Lisa config (mutation gate, github slug)
 * @param dependencies - Injectable readers for tests
 * @returns Live-status probe
 */
export function createCiQualityJobsProbe(
  cwd: string,
  config: JsonObject,
  dependencies: CiQualityJobsDependencies = {}
): StatusProbe<CiQualityJobsValue> {
  const timeoutMs = 5_000;
  const listSecrets = dependencies.listSecrets ?? listRepoSecretNames;
  const readCiYml = dependencies.readCiYml ?? readCiYmlFile;
  const resolveRepo =
    dependencies.resolveRepo ?? ((_projectRoot, cfg) => repoFromConfig(cfg));
  return {
    id: CI_QUALITY_JOBS_PROBE_ID,
    timeoutMs,
    run: async signal => {
      try {
        const inputs = await parseCiWorkflowInputs(cwd, readCiYml);
        const secrets = await loadSecretsPresence(
          listSecrets,
          cwd,
          timeoutMs,
          signal,
          resolveRepo(cwd, config)
        );
        return {
          state: "value",
          value: computeCiQualityJobs(inputs, config, secrets),
        };
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Unable to read ci.yml quality inputs";
        const missing =
          message.includes("ENOENT") ||
          message.toLowerCase().includes("no such file");
        return {
          state: "unknown",
          reason: missing ? "ci-yml-missing" : "ci-yml-unreadable",
          message,
        };
      }
    },
  };
}
