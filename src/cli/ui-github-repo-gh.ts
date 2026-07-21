/**
 * Injectable `gh` reads for the GitHub repository live-status panel.
 * @module cli/ui-github-repo-gh
 */
import { execFile } from "node:child_process";
import {
  mapRepoSettings,
  mapRulesetRow,
  requireNamedString,
} from "./ui-github-repo-map.js";

/** Live repository settings surfaced in the console panel. */
export interface GithubRepoSettings {
  readonly allow_merge_commit: boolean;
  readonly allow_squash_merge: boolean;
  readonly allow_rebase_merge: boolean;
  readonly allow_auto_merge: boolean;
  readonly allow_update_branch: boolean;
  readonly delete_branch_on_merge: boolean;
  readonly merge_commit_title: string;
  readonly has_issues: boolean;
  readonly has_wiki: boolean;
  readonly secret_scanning: boolean;
  readonly default_branch: string;
}

/** One ruleset row for the panel. */
export interface GithubRulesetRow {
  readonly name: string;
  readonly appliesTo: string;
  readonly enforces: string;
  readonly active: boolean;
  /** Structured default-branch targeting retained beside display text. */
  readonly targetsDefaultBranch?: boolean;
  /** Structured pull-request enforcement retained beside display text. */
  readonly requiresPullRequest?: boolean;
  /** At least one required status-check context is configured. */
  readonly requiresStatusChecks?: boolean;
}

/** One label present on the remote repository. */
export interface GithubRemoteLabel {
  readonly name: string;
  readonly color: string;
}

/** Injectable collaborators used by the github-repo probe. */
export interface GithubRepoGhReads {
  readonly readSettings: (
    owner: string,
    repo: string,
    cwd: string,
    timeoutMs: number,
    signal: AbortSignal
  ) => Promise<GithubRepoSettings>;
  readonly listRulesets: (
    owner: string,
    repo: string,
    cwd: string,
    timeoutMs: number,
    signal: AbortSignal
  ) => Promise<readonly GithubRulesetRow[]>;
  readonly listLabels: (
    owner: string,
    repo: string,
    cwd: string,
    timeoutMs: number,
    signal: AbortSignal
  ) => Promise<readonly GithubRemoteLabel[]>;
  readonly listSecretNames: (
    owner: string,
    repo: string,
    cwd: string,
    timeoutMs: number,
    signal: AbortSignal
  ) => Promise<readonly string[]>;
}

/**
 * Run `gh` without a shell and return stdout.
 * @param args - gh argv after the executable
 * @param cwd - Working directory
 * @param timeoutMs - Child-process timeout
 * @param signal - Probe cancellation signal
 * @returns Trimmed stdout
 */
function runGh(
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
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
        resolve(stdout.trim());
      }
    );
  });
}

/**
 * Parse JSON from a gh command, rejecting non-JSON payloads.
 * @param stdout - Command stdout
 * @returns Parsed JSON value
 */
function parseJson(stdout: string): unknown {
  return JSON.parse(stdout) as unknown;
}

/**
 * Load detailed ruleset rows for every ruleset id in the list response.
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param listed - Parsed rulesets list payload
 * @param cwd - Working directory
 * @param timeoutMs - Child-process timeout
 * @param signal - Probe cancellation signal
 * @returns Panel ruleset rows
 */
async function loadRulesetDetails(
  owner: string,
  repo: string,
  listed: unknown,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<readonly GithubRulesetRow[]> {
  if (!Array.isArray(listed)) {
    throw new TypeError("Rulesets list was not an array");
  }
  return await Promise.all(
    listed.map(async entry => {
      if (entry === null || typeof entry !== "object") {
        throw new TypeError("Ruleset list entry was not an object");
      }
      const id = Reflect.get(entry, "id");
      if (typeof id !== "number") {
        throw new TypeError("Ruleset list entry omitted numeric id");
      }
      const detailStdout = await runGh(
        ["api", `repos/${owner}/${repo}/rulesets/${String(id)}`],
        cwd,
        timeoutMs,
        signal
      );
      return mapRulesetRow(parseJson(detailStdout));
    })
  );
}

/** Default `gh` implementations used by `lisa ui`. */
export const defaultGithubRepoGhReads: GithubRepoGhReads = {
  readSettings: async (owner, repo, cwd, timeoutMs, signal) => {
    const stdout = await runGh(
      ["api", `repos/${owner}/${repo}`],
      cwd,
      timeoutMs,
      signal
    );
    return mapRepoSettings(parseJson(stdout));
  },
  listRulesets: async (owner, repo, cwd, timeoutMs, signal) => {
    const listStdout = await runGh(
      ["api", `repos/${owner}/${repo}/rulesets`],
      cwd,
      timeoutMs,
      signal
    );
    return loadRulesetDetails(
      owner,
      repo,
      parseJson(listStdout),
      cwd,
      timeoutMs,
      signal
    );
  },
  listLabels: async (owner, repo, cwd, timeoutMs, signal) => {
    const stdout = await runGh(
      [
        "label",
        "list",
        "--repo",
        `${owner}/${repo}`,
        "--limit",
        "200",
        "--json",
        "name,color",
      ],
      cwd,
      timeoutMs,
      signal
    );
    const parsed = parseJson(stdout);
    if (!Array.isArray(parsed)) {
      throw new TypeError("Label list was not an array");
    }
    return parsed.map(entry => {
      if (entry === null || typeof entry !== "object") {
        throw new TypeError("Label entry was not an object");
      }
      return {
        name: requireNamedString(entry, "name"),
        color: requireNamedString(entry, "color"),
      };
    });
  },
  listSecretNames: async (owner, repo, cwd, timeoutMs, signal) => {
    const stdout = await runGh(
      ["secret", "list", "--repo", `${owner}/${repo}`, "--json", "name"],
      cwd,
      timeoutMs,
      signal
    );
    const parsed = parseJson(stdout);
    if (!Array.isArray(parsed)) {
      throw new TypeError("Secret list was not an array");
    }
    return parsed.map(entry => {
      if (entry === null || typeof entry !== "object") {
        throw new TypeError("Secret entry was not an object");
      }
      return requireNamedString(entry, "name");
    });
  },
};
