/**
 * Live-status probe for the console GitHub repository panel.
 *
 * Every input is `gh`-derived. Unauthenticated `gh` takes the whole panel to
 * unknown — never a partial concrete value. Secret values are never read.
 * @module cli/ui-github-repo
 */
import type { JsonObject } from "../sync/json-path.js";
import {
  configuredGithubRepo,
  EXPECTED_GITHUB_SECRETS,
  expectedLabelsFromConfig,
} from "./ui-github-repo-expected.js";
import {
  defaultGithubRepoGhReads,
  type GithubRemoteLabel,
  type GithubRepoGhReads,
  type GithubRepoSettings,
  type GithubRulesetRow,
} from "./ui-github-repo-gh.js";
import {
  createGithubAuthProbe,
  type ProbeResult,
  type StatusProbe,
} from "./ui-status.js";

export type { GithubRepoGhReads } from "./ui-github-repo-gh.js";
export { expectedLabelsFromConfig } from "./ui-github-repo-expected.js";

const GITHUB_REPO_PROBE_ID = "github-repo";
const PROBE_TIMEOUT_MS = 15_000;
const NOT_AUTHENTICATED = "not-authenticated" as const;
const GITHUB_NOT_AUTHENTICATED = "GitHub CLI is not authenticated";

/** Label row for the panel (presence vs config expectation). */
export interface GithubRepoLabelRow {
  readonly name: string;
  readonly role: string;
  readonly color: string;
  readonly present: boolean;
}

/** Secret row — presence only; never a value. */
export interface GithubRepoSecretRow {
  readonly name: string;
  readonly purpose: string;
  readonly set: boolean;
}

/**
 * Structured value emitted by the github-repo live-status probe.
 * Stored as JsonObject for the probe transport; shape is validated in tests.
 */
export type GithubRepoPanelValue = JsonObject & {
  readonly owner: string;
  readonly repo: string;
  readonly settings: GithubRepoSettings;
  readonly rulesets: readonly GithubRulesetRow[];
  readonly labels: readonly GithubRepoLabelRow[];
  readonly secrets: readonly GithubRepoSecretRow[];
};

/** Optional overrides for focused unit tests. */
export interface GithubRepoProbeDependencies {
  readonly authenticate?: (
    signal: AbortSignal
  ) => Promise<"authenticated" | "not-authenticated">;
  readonly reads?: Partial<GithubRepoGhReads>;
}

/**
 * Compare expected labels against the remote label set.
 * @param expected - Labels from config
 * @param remote - Labels returned by gh
 * @returns Panel rows with present/missing
 */
function compareLabels(
  expected: ReturnType<typeof expectedLabelsFromConfig>,
  remote: readonly GithubRemoteLabel[]
): readonly GithubRepoLabelRow[] {
  const byName = new Map(remote.map(label => [label.name, label]));
  return expected.map(label => {
    const found = byName.get(label.name);
    return found === undefined
      ? { name: label.name, role: label.role, color: "", present: false }
      : {
          name: label.name,
          role: label.role,
          color: found.color,
          present: true,
        };
  });
}

/**
 * Compare expected secrets against names from `gh secret list`.
 * @param presentNames - Secret names that exist on the repo
 * @returns Presence-only rows (no values)
 */
function compareSecrets(
  presentNames: readonly string[]
): readonly GithubRepoSecretRow[] {
  const present = new Set(presentNames);
  return EXPECTED_GITHUB_SECRETS.map(secret => ({
    name: secret.name,
    purpose: secret.purpose,
    set: present.has(secret.name),
  }));
}

/**
 * Build the panel value after all gh reads succeed.
 * @param owner - github.org
 * @param repo - github.repo
 * @param settings - Live repository settings
 * @param rulesets - Live rulesets
 * @param labels - Compared label rows
 * @param secrets - Presence-only secret rows
 * @returns Probe value payload
 */
function panelValue(
  owner: string,
  repo: string,
  settings: GithubRepoSettings,
  rulesets: readonly GithubRulesetRow[],
  labels: readonly GithubRepoLabelRow[],
  secrets: readonly GithubRepoSecretRow[]
): GithubRepoPanelValue {
  return {
    owner,
    repo,
    settings: { ...settings },
    rulesets: rulesets.map(row => ({ ...row })),
    labels: labels.map(row => ({ ...row })),
    secrets: secrets.map(row => ({ ...row })),
  } as GithubRepoPanelValue;
}

/**
 * Create the probe that populates the GitHub repository panel.
 * @param cwd - Project root used as the command working directory
 * @param config - Merged Lisa project config
 * @param dependencies - Injectable auth and gh reads for focused tests
 * @returns Live-status probe for GET /api/status
 */
export function createGithubRepoProbe(
  cwd: string,
  config: JsonObject,
  dependencies: GithubRepoProbeDependencies = {}
): StatusProbe<GithubRepoPanelValue> {
  const reads: GithubRepoGhReads = {
    ...defaultGithubRepoGhReads,
    ...dependencies.reads,
  };
  const authenticate =
    dependencies.authenticate ??
    (async (signal: AbortSignal) => {
      const auth = await createGithubAuthProbe(cwd).run(signal);
      return auth.state === "value" && auth.value === true
        ? "authenticated"
        : "not-authenticated";
    });

  return {
    id: GITHUB_REPO_PROBE_ID,
    timeoutMs: PROBE_TIMEOUT_MS,
    run: async signal => {
      const authState = await authenticate(signal);
      if (authState !== "authenticated") {
        return {
          state: "unknown",
          reason: NOT_AUTHENTICATED,
          message: GITHUB_NOT_AUTHENTICATED,
        };
      }
      const target = configuredGithubRepo(config);
      if (target === undefined) {
        return {
          state: "unknown",
          reason: "repo-not-configured",
          message: "github.org and github.repo must be set in Lisa config",
        };
      }
      const timeoutMs = PROBE_TIMEOUT_MS + 250;
      const [settings, rulesets, remoteLabels, secretNames] = await Promise.all(
        [
          reads.readSettings(target.owner, target.repo, cwd, timeoutMs, signal),
          reads.listRulesets(target.owner, target.repo, cwd, timeoutMs, signal),
          reads.listLabels(target.owner, target.repo, cwd, timeoutMs, signal),
          reads.listSecretNames(
            target.owner,
            target.repo,
            cwd,
            timeoutMs,
            signal
          ),
        ]
      );
      const value = panelValue(
        target.owner,
        target.repo,
        settings,
        rulesets,
        compareLabels(expectedLabelsFromConfig(config), remoteLabels),
        compareSecrets(secretNames)
      );
      const result: ProbeResult<GithubRepoPanelValue> = {
        state: "value",
        value,
      };
      return result;
    },
  };
}
