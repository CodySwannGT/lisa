/* eslint-disable sonarjs/no-duplicate-string, max-lines -- shell mock fixtures intentionally repeat gh argv fragments */
import type { SpawnSyncReturns } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_NAME = "lisa-github-rulesets.sh";
const GENERATOR_NAME = "lisa-ruleset-payload.mjs";
const REACH_DETECTOR_NAME = "lisa-ruleset-reach.mjs";
const GATES_NAME = "lisa-gates.mjs";
const QUALITY_RULESET = "quality checks";
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", SCRIPT_NAME);
const BASH_BIN = "/bin/bash";
const GIT_BIN = resolveGit();
const REPO_NAME = "CodySwannGT/lisa";
const ACTIVE_ENFORCEMENT = "active";

/**
 * Creates a minimal git project that the ruleset script can inspect.
 *
 * @returns Temporary project directory path.
 */
function createProject(): string {
  const projectDir = mkdtempSync(path.join(tmpdir(), "lisa-rulesets-"));
  boundedExecFileSync({
    label: "git init",
    command: GIT_BIN,
    args: ["init"],
    cwd: projectDir,
    stdio: "ignore",
    env: cleanGitEnv(process.env),
  });
  writeFileSync(path.join(projectDir, "tsconfig.json"), "{}\n");
  return projectDir;
}

/**
 * Creates a mock gh executable that returns deterministic ruleset responses.
 *
 * @returns Temporary bin directory containing the mock gh executable.
 */
function createMockGhBin(): string {
  const binDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-bin-"));
  const ghPath = path.join(binDir, "gh");
  writeFileSync(
    ghPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ "$1 $2" == "auth status" ]]; then',
      "  exit 0",
      "fi",
      'if [[ "$1 $2" == "repo view" ]]; then',
      `  echo "${REPO_NAME}"`,
      "  exit 0",
      "fi",
      `if [[ "$1" == "api" && "$2" == "repos/${REPO_NAME}/rulesets" ]]; then`,
      '  echo "[]"',
      "  exit 0",
      "fi",
      'echo "unexpected gh invocation: $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return binDir;
}

/**
 * Creates a temporary Lisa install layout with a ruleset template.
 *
 * The install carries the payload generator and the gate registry it imports,
 * because the `base` ruleset is no longer a shipped JSON file — it is built
 * from `.lisa.config.json` on every run. There is deliberately no `base.json`
 * fixture: a second template of that name would collide with the generated one.
 *
 * @returns Temporary Lisa install root and copied script path.
 */
function createLisaInstall(): { scriptPath: string; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-install-"));
  const scriptsDir = path.join(root, "scripts");
  const scriptPath = path.join(scriptsDir, SCRIPT_NAME);
  const rulesetDir = path.join(root, "typescript", "github-rulesets");
  const gatesDir = path.join(root, "all", "copy-overwrite", "scripts");

  mkdirSync(scriptsDir, { recursive: true });
  copyFileSync(SCRIPT_PATH, scriptPath);
  copyFileSync(
    path.join(REPO_ROOT, "scripts", GENERATOR_NAME),
    path.join(scriptsDir, GENERATOR_NAME)
  );
  copyFileSync(
    path.join(REPO_ROOT, "scripts", REACH_DETECTOR_NAME),
    path.join(scriptsDir, REACH_DETECTOR_NAME)
  );
  mkdirSync(path.join(gatesDir, "lib"), { recursive: true });
  copyFileSync(
    path.join(REPO_ROOT, "all", "copy-overwrite", "scripts", GATES_NAME),
    path.join(gatesDir, GATES_NAME)
  );
  // Every shared module the registry reaches into `lib/` for, as a DIRECTORY.
  // This named `invoked-as-script.mjs` and stopped being a faithful copy the
  // moment the registry imported a second sibling (CodySwannGT/lisa#2980).
  // CodySwannGT/lisa#3082.
  cpSync(
    path.join(REPO_ROOT, "all", "copy-overwrite", "scripts", "lib"),
    path.join(gatesDir, "lib"),
    { recursive: true }
  );
  mkdirSync(rulesetDir, { recursive: true });
  writeFileSync(
    path.join(rulesetDir, "extra.json"),
    JSON.stringify({ name: "extra", enforcement: ACTIVE_ENFORCEMENT })
  );
  return { scriptPath, root };
}

/** One captured `gh api` ruleset payload, projected to what the tests read. */
type RulesetPayload = {
  readonly name?: string;
  readonly rules?: readonly {
    readonly type?: string;
    readonly parameters?: {
      readonly required_status_checks?: readonly {
        readonly context: string;
        readonly integration_id?: number;
      }[];
    };
  }[];
};

/**
 * Runs the ruleset script with the mock gh first on PATH.
 *
 * @param scriptPath Copied script under the temporary Lisa install.
 * @param args Arguments to pass to the script.
 * @param ghBin Directory holding the mock gh executable.
 * @returns The completed process result.
 */
function runRulesetScript(
  scriptPath: string,
  args: readonly string[],
  ghBin: string
): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    label: "lisa-github-rulesets.sh",
    command: BASH_BIN,
    args: [scriptPath, ...args],
    cwd: REPO_ROOT,
    env: cleanGitEnv(process.env, {
      PATH: `${ghBin}:${process.env.PATH ?? ""}`,
    }),
  });
}

/**
 * Creates a mock gh that records every ruleset payload the script sends.
 *
 * @param captureDir Directory the mock writes each `--input` payload into.
 * @returns Temporary bin directory containing the mock gh executable.
 */
function createCapturingGhBin(captureDir: string): string {
  const binDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-capture-"));
  const ghPath = path.join(binDir, "gh");
  writeFileSync(
    ghPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ "$1 $2" == "auth status" ]]; then',
      "  exit 0",
      "fi",
      'if [[ "$1 $2" == "repo view" ]]; then',
      `  echo "${REPO_NAME}"`,
      "  exit 0",
      "fi",
      `if [[ "$1" == "api" && "$2" == "repos/${REPO_NAME}/rulesets" ]]; then`,
      '  echo "[]"',
      "  exit 0",
      "fi",
      'if [[ "$1" == "api" && "$2" == "-X" ]]; then',
      '  input="${!#}"',
      `  cp "$input" "${captureDir}/$(date +%s%N).json"`,
      '  echo "{}"',
      "  exit 0",
      "fi",
      'echo "unexpected gh invocation: $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return binDir;
}

/**
 * Creates a mock gh for an update path with one live ruleset detail.
 *
 * @param captureDir Directory the mock writes the update payload into.
 * @param liveRuleset Existing detailed ruleset payload returned by GitHub.
 * @returns Temporary bin directory containing the mock gh executable.
 */
function createUpdatingGhBin(
  captureDir: string,
  liveRuleset: RulesetPayload,
  liveName: string = "base"
): string {
  const binDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-update-"));
  const ghPath = path.join(binDir, "gh");
  writeFileSync(
    ghPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ "$1 $2" == "auth status" ]]; then',
      "  exit 0",
      "fi",
      'if [[ "$1 $2" == "repo view" ]]; then',
      `  echo "${REPO_NAME}"`,
      "  exit 0",
      "fi",
      `if [[ "$1" == "api" && "$2" == "repos/${REPO_NAME}/rulesets" ]]; then`,
      `  echo '[{"id":7,"name":"${liveName}"}]'`,
      "  exit 0",
      "fi",
      `if [[ "$1 $2 $3" == "api -X GET" && "$4" == "repos/${REPO_NAME}/rulesets/7" ]]; then`,
      `  cat <<'JSON'\n${JSON.stringify(liveRuleset)}\nJSON`,
      "  exit 0",
      "fi",
      `if [[ "$1 $2 $3" == "api -X PUT" && "$4" == "repos/${REPO_NAME}/rulesets/7" ]]; then`,
      '  input="${!#}"',
      `  cp "$input" "${captureDir}/updated.json"`,
      '  echo "{}"',
      "  exit 0",
      "fi",
      'if [[ "$1 $2 $3" == "api -X POST" ]]; then',
      '  echo "{}"',
      "  exit 0",
      "fi",
      'echo "unexpected gh invocation: $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return binDir;
}

describe("lisa-github-rulesets.sh", () => {
  it("continues past the first successful template under set -e", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();
    const lisaInstall = createLisaInstall();

    try {
      const result = boundedSpawnSync({
        label: "lisa-github-rulesets.sh --dry-run",
        command: BASH_BIN,
        args: [lisaInstall.scriptPath, "--dry-run", projectDir],
        cwd: REPO_ROOT,
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- Test-only PATH shim injects the mock gh executable.
        env: cleanGitEnv(process.env, {
          PATH: `${ghBin}:${process.env.PATH ?? ""}`,
        }),
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Found 2 ruleset template(s)");
      expect(result.stdout).toContain("Dry run complete. 2 ruleset(s)");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
      rmSync(lisaInstall.root, { recursive: true, force: true });
    }
  });

  it("does not use post-increment counters that fail under GNU bash set -e", async () => {
    const script = readFileSync(SCRIPT_PATH, "utf8");

    expect(script).not.toMatch(/\(\(\s*(?:success|fail)_count\+\+\s*\)\)/);
  });

  // #2485: a repository-specific high-signal check (Lisa's own
  // `🧩 Plugin artifacts match source`) has to become required WITHOUT being
  // written into a shared template, because host projects do not run that
  // workflow and a required context that never reports blocks every PR (#2476).
  describe("github.rulesets.requiredChecks", () => {
    const REPO_ONLY_CONTEXT = "🧩 Repo Only";
    const CONTESTED_CONTEXT = "🧩 Contested";
    const VENDOR_CONTEXT = "GitGuardian Security Checks";
    const VENDOR_APP = 46_505;

    /**
     * Runs the script for real against a capturing mock gh.
     *
     * @param config The `.lisa.config.json` contents to write, or undefined.
     * @returns Every ruleset payload the script sent, parsed.
     */
    function sentPayloads(config?: unknown): readonly RulesetPayload[] {
      const projectDir = createProject();
      const captureDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-payloads-"));
      const ghBin = createCapturingGhBin(captureDir);
      const lisaInstall = createLisaInstall();

      mkdirSync(path.join(projectDir, ".github", "workflows"), {
        recursive: true,
      });
      if (config !== undefined) {
        writeFileSync(
          path.join(projectDir, ".lisa.config.json"),
          JSON.stringify(config)
        );
      }

      try {
        const result = runRulesetScript(
          lisaInstall.scriptPath,
          ["--yes", projectDir],
          ghBin
        );
        expect(result.status).toBe(0);
        return readdirSync(captureDir).map(
          file =>
            JSON.parse(
              readFileSync(path.join(captureDir, file), "utf8")
            ) as RulesetPayload
        );
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(captureDir, { recursive: true, force: true });
        rmSync(ghBin, { recursive: true, force: true });
        rmSync(lisaInstall.root, { recursive: true, force: true });
      }
    }

    /**
     * Extracts the required contexts from one sent ruleset payload.
     *
     * @param payload A captured ruleset payload.
     * @returns The contexts the payload requires.
     */
    function contextsOf(payload: RulesetPayload): readonly string[] {
      return (payload.rules ?? []).flatMap(rule =>
        rule.type === "required_status_checks"
          ? (rule.parameters?.required_status_checks ?? []).map(
              check => check.context
            )
          : []
      );
    }

    it("adds the configured context to the named ruleset only", () => {
      const payloads = sentPayloads({
        github: {
          rulesets: {
            addRequiredChecks: {
              base: [{ context: REPO_ONLY_CONTEXT, integration_id: 15368 }],
            },
          },
        },
      });

      const base = payloads.find(payload => payload.name === "base");
      const extra = payloads.find(payload => payload.name === "extra");
      expect(base).toBeDefined();
      expect(extra).toBeDefined();
      expect(contextsOf(base as RulesetPayload)).toContain(REPO_ONLY_CONTEXT);
      expect(contextsOf(extra as RulesetPayload)).not.toContain(
        REPO_ONLY_CONTEXT
      );
    });

    it("defaults a missing integration_id to GitHub Actions", () => {
      const payloads = sentPayloads({
        github: {
          rulesets: { addRequiredChecks: { base: [{ context: "🧩 Bare" }] } },
        },
      });

      const base = payloads.find(payload => payload.name === "base");
      const rule = (base?.rules ?? []).find(
        item => item.type === "required_status_checks"
      );
      expect(rule?.parameters?.required_status_checks).toContainEqual({
        context: "🧩 Bare",
        integration_id: 15368,
      });
    });

    // The safe resolution of contradictory operator instructions: a context in
    // both lists is DROPPED. Requiring a check the same file says to drop would
    // block every pull request on the strength of a typo.
    it("lets dropRequiredChecks win over an addition of the same context", () => {
      const payloads = sentPayloads({
        github: {
          rulesets: {
            addRequiredChecks: { base: [{ context: CONTESTED_CONTEXT }] },
            dropRequiredChecks: [CONTESTED_CONTEXT],
          },
        },
      });

      for (const payload of payloads) {
        expect(contextsOf(payload)).not.toContain(CONTESTED_CONTEXT);
      }
    });

    it("sends no required checks when nothing is configured", () => {
      const payloads = sentPayloads();

      for (const payload of payloads) {
        expect(contextsOf(payload)).toEqual([]);
      }
    });

    // #2917. `all/github-rulesets/base.json` is deleted; the `base` ruleset is
    // built from .lisa.config.json on every run. Without this the applier would
    // send every OTHER ruleset and report success while the repository had no
    // branch protection at all.
    it("sends a generated base ruleset built from the declared policy", () => {
      const payloads = sentPayloads({
        policy: {
          ruleset: { enforcement: "active", include_refs: ["refs/heads/main"] },
          review: { required_approving_review_count: 2 },
          merge: { merge_commit: true, squash: false, rebase: false },
        },
        gates: {
          "credential-leakage": {
            "pull-request": {
              level: "required",
              await: VENDOR_CONTEXT,
              posted_by: VENDOR_APP,
            },
          },
        },
      });

      const base = payloads.find(payload => payload.name === "base");
      expect(base).toBeDefined();
      expect(contextsOf(base as RulesetPayload)).toEqual([VENDOR_CONTEXT]);
      expect(
        (base as RulesetPayload).rules?.find(
          rule => rule.type === "required_status_checks"
        )?.parameters?.required_status_checks
      ).toEqual([{ context: VENDOR_CONTEXT, integration_id: VENDOR_APP }]);
    });

    // The whole point of moving the vendor contexts into config: a project that
    // proves credential leakage with a different scanner can say so, and the
    // context a shipped template used to pin is simply not required.
    it("requires no vendor context when the project awaits none", () => {
      const payloads = sentPayloads({ policy: {} });
      const base = payloads.find(payload => payload.name === "base");

      expect(base).toBeDefined();
      expect(contextsOf(base as RulesetPayload)).toEqual([]);
    });

    // The generated `base` ruleset gets no exemption from live preservation.
    // Exempting it made removal unconditional on every run of a script
    // `lisa-github-repo-setup.sh` invokes with `--yes`, so a context required
    // today that no gate awaits and no `requiredChecks.base` names would be
    // deleted with nobody opting in — a protection lost by default, reading in
    // the audit log as a routine reconciliation.
    it("keeps a live base context that config does not declare, absent an opt-in", () => {
      const projectDir = createProject();
      const captureDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-basekeep-"));
      const lisaInstall = createLisaInstall();
      const undeclared = "SonarCloud Code Analysis";
      const ghBin = createUpdatingGhBin(captureDir, {
        name: "base",
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: undeclared }],
            },
          },
        ],
      });

      mkdirSync(path.join(projectDir, ".github", "workflows"), {
        recursive: true,
      });
      writeFileSync(
        path.join(projectDir, ".lisa.config.json"),
        JSON.stringify({
          gates: {
            "credential-leakage": {
              "pull-request": {
                level: "required",
                await: VENDOR_CONTEXT,
                posted_by: VENDOR_APP,
              },
            },
          },
        })
      );

      try {
        const result = runRulesetScript(
          lisaInstall.scriptPath,
          ["--yes", projectDir],
          ghBin
        );
        expect(result.status).toBe(0);
        const updated = JSON.parse(
          readFileSync(path.join(captureDir, "updated.json"), "utf8")
        ) as RulesetPayload;

        // The declared await is added; the undeclared live context survives.
        expect(contextsOf(updated)).toContain(VENDOR_CONTEXT);
        expect(contextsOf(updated)).toContain(undeclared);
        expect(result.stdout).not.toContain("- no longer required:");
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(captureDir, { recursive: true, force: true });
        rmSync(ghBin, { recursive: true, force: true });
        rmSync(lisaInstall.root, { recursive: true, force: true });
      }
    });

    // The bite. `addRequiredChecks` was additive by construction: the applier
    // unioned the LIVE required list back into every payload, so a context
    // could be added and never removed, and a required check outlived the job
    // that posted it. Declaring a ruleset's list stops that union.
    it("stops requiring a context the declared list no longer names", () => {
      const projectDir = createProject();
      const captureDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-declared-"));
      const lisaInstall = createLisaInstall();
      const keptContext = "🔗 Work-Item Traceability";
      const retiredContext = "🧭 Retired Check";
      const ghBin = createUpdatingGhBin(
        captureDir,
        {
          name: QUALITY_RULESET,
          rules: [
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: [
                  { context: keptContext, integration_id: 15_368 },
                  { context: retiredContext, integration_id: 15_368 },
                ],
              },
            },
          ],
        },
        QUALITY_RULESET
      );

      mkdirSync(path.join(projectDir, ".github", "workflows"), {
        recursive: true,
      });
      writeFileSync(
        path.join(projectDir, ".lisa.config.json"),
        JSON.stringify({
          github: {
            rulesets: { requiredChecks: { [QUALITY_RULESET]: [] } },
          },
        })
      );
      writeFileSync(
        path.join(
          lisaInstall.root,
          "typescript",
          "github-rulesets",
          "quality-checks.json"
        ),
        JSON.stringify({
          name: QUALITY_RULESET,
          enforcement: ACTIVE_ENFORCEMENT,
          rules: [
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: [
                  { context: keptContext, integration_id: 15_368 },
                ],
              },
            },
          ],
        })
      );

      try {
        const result = runRulesetScript(
          lisaInstall.scriptPath,
          ["--yes", projectDir],
          ghBin
        );
        expect(result.status).toBe(0);
        const updated = JSON.parse(
          readFileSync(path.join(captureDir, "updated.json"), "utf8")
        ) as RulesetPayload;

        expect(contextsOf(updated)).toEqual([keptContext]);
        // Reported by name. A declarative list that quietly dropped a check
        // would read in the audit log as a routine reconciliation.
        expect(result.stdout).toContain(
          `- no longer required: ${retiredContext}`
        );
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(captureDir, { recursive: true, force: true });
        rmSync(ghBin, { recursive: true, force: true });
        rmSync(lisaInstall.root, { recursive: true, force: true });
      }
    });

    it("preserves live-only required checks when updating a ruleset", () => {
      const projectDir = createProject();
      const captureDir = mkdtempSync(
        path.join(tmpdir(), "lisa-gh-update-payloads-")
      );
      const lisaInstall = createLisaInstall();
      const shippedContext = "🔗 Work-Item Traceability";
      const hostContext = "🧭 E2E Route Coverage";
      const ghBin = createUpdatingGhBin(
        captureDir,
        {
          name: QUALITY_RULESET,
          rules: [
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: [
                  { context: hostContext, integration_id: 15_368 },
                ],
              },
            },
          ],
        },
        QUALITY_RULESET
      );

      mkdirSync(path.join(projectDir, ".github", "workflows"), {
        recursive: true,
      });
      writeFileSync(
        path.join(
          lisaInstall.root,
          "typescript",
          "github-rulesets",
          "quality-checks.json"
        ),
        JSON.stringify({
          name: QUALITY_RULESET,
          enforcement: ACTIVE_ENFORCEMENT,
          rules: [
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: [
                  { context: shippedContext, integration_id: 15_368 },
                ],
              },
            },
          ],
        })
      );

      try {
        const result = runRulesetScript(
          lisaInstall.scriptPath,
          ["--yes", projectDir],
          ghBin
        );
        expect(result.status).toBe(0);
        const updated = JSON.parse(
          readFileSync(path.join(captureDir, "updated.json"), "utf8")
        ) as RulesetPayload;
        expect(contextsOf(updated)).toEqual([shippedContext, hostContext]);
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(captureDir, { recursive: true, force: true });
        rmSync(ghBin, { recursive: true, force: true });
        rmSync(lisaInstall.root, { recursive: true, force: true });
      }
    });
  });

  // #2828: a context added to a template never reaches an already-configured
  // repository on its own, so the reconciliation has to be legible — it must
  // name the checks it just made blocking, and a second run must be visibly a
  // no-op rather than an indistinguishable write.
  describe("drift reporting", () => {
    const LINT_CONTEXT = "🔍 Quality Checks / 🧹 Lint";
    const SG_CONTEXT = "🔍 Quality Checks / 🔎 Structural Rules";
    const ACTIONS_INTEGRATION_ID = 15_368;

    /**
     * Builds a ruleset document requiring the given contexts.
     *
     * @param contexts Contexts the ruleset requires.
     * @param extraParameters Fields GitHub echoes back that no template names.
     * @returns A ruleset document.
     */
    function rulesetRequiring(
      contexts: readonly string[],
      extraParameters: Readonly<Record<string, unknown>> = {}
    ): Record<string, unknown> {
      return {
        name: QUALITY_RULESET,
        enforcement: ACTIVE_ENFORCEMENT,
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              ...extraParameters,
              required_status_checks: contexts.map(context => ({
                context,
                integration_id: ACTIONS_INTEGRATION_ID,
              })),
            },
          },
        ],
      };
    }

    /**
     * Runs the script against a live `base` ruleset the mock gh serves.
     *
     * @param templateContexts Contexts the shipped template requires.
     * @param live The live ruleset GitHub returns for the existing id.
     * @returns The script stdout and the files the mock captured.
     */
    function reconcile(
      templateContexts: readonly string[],
      live: Record<string, unknown>
    ): { captured: readonly string[]; stdout: string } {
      const projectDir = createProject();
      const captureDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-drift-"));
      const lisaInstall = createLisaInstall();
      const ghBin = createUpdatingGhBin(
        captureDir,
        live as RulesetPayload,
        QUALITY_RULESET
      );

      mkdirSync(path.join(projectDir, ".github", "workflows"), {
        recursive: true,
      });
      const rulesetDir = path.join(
        lisaInstall.root,
        "typescript",
        "github-rulesets"
      );
      rmSync(path.join(rulesetDir, "extra.json"));
      writeFileSync(
        path.join(rulesetDir, "quality-checks.json"),
        JSON.stringify(rulesetRequiring(templateContexts))
      );

      try {
        const result = runRulesetScript(
          lisaInstall.scriptPath,
          ["--yes", projectDir],
          ghBin
        );
        expect(result.status).toBe(0);
        return {
          captured: readdirSync(captureDir),
          stdout: result.stdout as string,
        };
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(captureDir, { recursive: true, force: true });
        rmSync(ghBin, { recursive: true, force: true });
        rmSync(lisaInstall.root, { recursive: true, force: true });
      }
    }

    it("names each context it makes required when the live ruleset has drifted", () => {
      const { captured, stdout } = reconcile(
        [LINT_CONTEXT, SG_CONTEXT],
        rulesetRequiring([LINT_CONTEXT])
      );

      expect(stdout).toContain(`+ now required: ${SG_CONTEXT}`);
      expect(stdout).not.toContain(`+ now required: ${LINT_CONTEXT}`);
      expect(captured).toContain("updated.json");
    });

    it("reports nothing to do and sends no update when the live ruleset matches", () => {
      const { captured, stdout } = reconcile(
        [LINT_CONTEXT, SG_CONTEXT],
        rulesetRequiring([LINT_CONTEXT, SG_CONTEXT])
      );

      expect(stdout).toContain(
        `Ruleset '${QUALITY_RULESET}' already matches the template — nothing to do`
      );
      expect(stdout).not.toContain("+ now required:");
      expect(captured).not.toContain("updated.json");
    });

    // GitHub fills in rule parameters no template names and echoes them back.
    // Treating those as drift would make "nothing to do" unreachable.
    // The live read is what makes reconciliation additive. If it fails, the
    // payload has no live checks to preserve, so sending it anyway would
    // REPLACE the repository's required checks with the template's — the exact
    // silent unrequiring the read exists to prevent.
    it("sends nothing and fails when the live ruleset cannot be read", () => {
      const projectDir = createProject();
      const captureDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-unread-"));
      const lisaInstall = createLisaInstall();
      const ghBin = createUpdatingGhBin(captureDir, {}, QUALITY_RULESET);
      const ghPath = path.join(ghBin, "gh");

      mkdirSync(path.join(projectDir, ".github", "workflows"), {
        recursive: true,
      });
      const rulesetDir = path.join(
        lisaInstall.root,
        "typescript",
        "github-rulesets"
      );
      rmSync(path.join(rulesetDir, "extra.json"));
      writeFileSync(
        path.join(rulesetDir, "quality-checks.json"),
        JSON.stringify(rulesetRequiring([LINT_CONTEXT]))
      );
      writeFileSync(
        ghPath,
        readFileSync(ghPath, "utf8").replace(
          `if [[ "$1 $2 $3" == "api -X GET" && "$4" == "repos/${REPO_NAME}/rulesets/7" ]]; then`,
          `if [[ "$1 $2 $3" == "api -X GET" && "$4" == "repos/${REPO_NAME}/rulesets/7" ]]; then\n  exit 1`
        ),
        { mode: 0o755 }
      );

      try {
        const result = runRulesetScript(
          lisaInstall.scriptPath,
          ["--yes", projectDir],
          ghBin
        );

        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
          "refusing to silently replace required checks"
        );
        expect(readdirSync(captureDir)).not.toContain("updated.json");
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(captureDir, { recursive: true, force: true });
        rmSync(ghBin, { recursive: true, force: true });
        rmSync(lisaInstall.root, { recursive: true, force: true });
      }
    });

    it("treats parameters GitHub added itself as matching, not as drift", () => {
      const { captured, stdout } = reconcile(
        [LINT_CONTEXT],
        rulesetRequiring([LINT_CONTEXT], {
          do_not_enforce_on_create: true,
          strict_required_status_checks_policy: false,
        })
      );

      expect(stdout).toContain("nothing to do");
      expect(captured).not.toContain("updated.json");
    });
  });

  describe("retired required contexts in rulesets Lisa does not manage", () => {
    // #3067. Everything else in this script is scoped per MANAGED ruleset
    // name. A hand-made ruleset requiring a context Lisa retired is therefore
    // invisible to it — and a required context that never reports does not
    // fail a pull request, it holds every one of them at "Expected — Waiting
    // for status to be reported" forever, with nothing naming the cause.
    const HAND_MADE = "enforce pr rules";
    const RETIRED = "🔍 Quality Checks / 🔎 AST Grep Scan";
    const CURRENT = "🔍 Quality Checks / 🔎 Structural Rules";

    /**
     * Creates a mock gh whose repository holds one hand-made ruleset.
     *
     * @param contexts Contexts that ruleset requires.
     * @param detailReadable Whether the detail endpoint answers at all.
     * @returns Temporary bin directory containing the mock gh executable.
     */
    function createUnmanagedGhBin(
      contexts: readonly string[],
      detailReadable = true
    ): string {
      const binDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-unmanaged-"));
      const detail = JSON.stringify({
        id: 9,
        name: HAND_MADE,
        target: "branch",
        enforcement: ACTIVE_ENFORCEMENT,
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: contexts.map(context => ({ context })),
            },
          },
        ],
      });
      writeFileSync(
        path.join(binDir, "gh"),
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'if [[ "$1 $2" == "auth status" ]]; then exit 0; fi',
          `if [[ "$1 $2" == "repo view" ]]; then echo "${REPO_NAME}"; exit 0; fi`,
          `if [[ "$1" == "api" && "$2" == "repos/${REPO_NAME}/rulesets" ]]; then`,
          `  echo '[{"id":9,"name":"${HAND_MADE}","enforcement":"${ACTIVE_ENFORCEMENT}"}]'`,
          "  exit 0",
          "fi",
          `if [[ "$*" == *"repos/${REPO_NAME}/rulesets/9"* ]]; then`,
          detailReadable
            ? `  cat <<'JSON'\n${detail}\nJSON`
            : '  echo "HTTP 403" >&2; exit 1',
          detailReadable ? "  exit 0" : "",
          "fi",
          'if [[ "$1" == "api" ]]; then echo "{}"; exit 0; fi',
          'echo "unexpected gh invocation: $*" >&2',
          "exit 1",
          "",
        ].join("\n"),
        { mode: 0o755 }
      );
      return binDir;
    }

    /**
     * Runs a dry run against a repository holding the given hand-made ruleset.
     *
     * @param contexts Contexts the hand-made ruleset requires.
     * @param detailReadable Whether the detail endpoint answers at all.
     * @returns The script's stdout.
     */
    function sweep(contexts: readonly string[], detailReadable = true): string {
      const projectDir = createProject();
      const ghBin = createUnmanagedGhBin(contexts, detailReadable);
      const lisaInstall = createLisaInstall();
      try {
        return runRulesetScript(
          lisaInstall.scriptPath,
          ["--dry-run", "--yes", projectDir],
          ghBin
        ).stdout;
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(ghBin, { recursive: true, force: true });
        rmSync(lisaInstall.root, { recursive: true, force: true });
      }
    }

    it("names a retired context surviving in a ruleset it does not manage", () => {
      const stdout = sweep([RETIRED, CURRENT]);

      expect(stdout).toContain("RETIRED REQUIRED CONTEXTS");
      expect(stdout).toContain(RETIRED);
      expect(stdout).toContain(HAND_MADE);
      expect(stdout).toContain(CURRENT);
    });

    // A check run's reported name is the `/`-joined chain of the JOB names
    // reaching it, and the depth varies with nesting: the pull-request path is
    // one level, the release path two. The registry renders ONE default chain,
    // so a sweep comparing whole context strings finds the pull-request
    // spelling and walks past the release one — omitting a retired required
    // context, which is the defect #3067 exists to detect, surviving inside
    // the detector. The replacement must carry the chain the ruleset pinned,
    // not the default one, or the operator is told to require a name their
    // release path never posts.
    it("names a retired context required under a nested caller chain", () => {
      const stdout = sweep([`Release / ${RETIRED}`]);

      expect(stdout).toContain("RETIRED REQUIRED CONTEXTS");
      expect(stdout).toContain(`Release / ${RETIRED}`);
      expect(stdout).toContain(`Release / ${CURRENT}`);
    });

    it("says it changed nothing, because it does not own that ruleset", () => {
      const stdout = sweep([RETIRED]);

      expect(stdout).toContain("does NOT edit a ruleset it does not manage");
      expect(stdout).toContain("remove the OLD context");
    });

    // THE NEGATIVE CONTROL. A hand-made ruleset requiring only contexts that
    // ARE produced — Lisa's current label and a third-party app status — must
    // produce no report at all.
    it("stays silent when every required context is still produced", () => {
      const stdout = sweep([CURRENT, "CodeRabbit"]);

      expect(stdout).not.toContain("RETIRED REQUIRED CONTEXTS");
    });

    it("says it could not check rather than reporting a ruleset clean", () => {
      // The list endpoint answers with summaries and no `rules`, so the only
      // place a required context lives is the detail payload. A detail this
      // run could not read must not read as "nothing retired in there".
      const stdout = sweep([RETIRED], false);

      expect(stdout).not.toContain("RETIRED REQUIRED CONTEXTS");
      expect(stdout).toContain("This is not a clean result");
    });
  });
  describe("rulesets that govern no branch in the repository", () => {
    // CodySwannGT/lisa#2781. GitHub accepts an include entry naming a branch
    // that does not exist — the entries are patterns, not references — so a
    // ruleset can be live, active, and matching nothing while every surface
    // reads it as healthy. The cost lands on whoever merges next: a required
    // context is only required on the refs its ruleset matches, so a gate
    // whose ruleset matches nothing blocks no one, and the operator learns
    // which of those two it is at the moment they are blocked, or never.
    const DEAD_RULESET = "nightly e2e health";
    const LIVE_RULESET = "bdd coverage";
    const REACH_HEADING = "RULESETS THAT GOVERN NO BRANCH";
    const REACH_UNCHECKED = "ruleset branch reach was NOT checked";

    /**
     * Creates a mock gh for a repository whose only branch is `main`.
     *
     * @param include Include entries of the one live ruleset.
     * @param branchesReadable Whether the branch listing answers at all.
     * @returns Temporary bin directory containing the mock gh executable.
     */
    function createReachGhBin(
      include: readonly string[],
      branchesReadable = true
    ): string {
      const binDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-reach-"));
      const name = include.includes("~DEFAULT_BRANCH")
        ? LIVE_RULESET
        : DEAD_RULESET;
      const detail = JSON.stringify({
        id: 9,
        name,
        target: "branch",
        enforcement: ACTIVE_ENFORCEMENT,
        conditions: { ref_name: { include: [...include], exclude: [] } },
        rules: [],
      });
      writeFileSync(
        path.join(binDir, "gh"),
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'if [[ "$1 $2" == "auth status" ]]; then exit 0; fi',
          `if [[ "$1 $2" == "repo view" ]]; then echo "${REPO_NAME}"; exit 0; fi`,
          'if [[ "$1 $2" == "api --paginate" ]]; then',
          branchesReadable
            ? `  echo '[{"name":"main"}]'; exit 0`
            : '  echo "HTTP 403" >&2; exit 1',
          "fi",
          `if [[ "$1 $2" == "api repos/${REPO_NAME}" ]]; then echo "main"; exit 0; fi`,
          `if [[ "$1" == "api" && "$2" == "repos/${REPO_NAME}/rulesets" ]]; then`,
          `  echo '[{"id":9,"name":"${name}","enforcement":"${ACTIVE_ENFORCEMENT}"}]'`,
          "  exit 0",
          "fi",
          `if [[ "$*" == *"repos/${REPO_NAME}/rulesets/9"* ]]; then`,
          `  cat <<'JSON'\n${detail}\nJSON`,
          "  exit 0",
          "fi",
          'if [[ "$1" == "api" ]]; then echo "{}"; exit 0; fi',
          'echo "unexpected gh invocation: $*" >&2',
          "exit 1",
          "",
        ].join("\n"),
        { mode: 0o755 }
      );
      return binDir;
    }

    /**
     * Runs a dry run against a repository whose only branch is `main`.
     *
     * @param include Include entries of the one live ruleset.
     * @param branchesReadable Whether the branch listing answers at all.
     * @returns The script's stdout.
     */
    function reachSweep(
      include: readonly string[],
      branchesReadable = true
    ): string {
      const projectDir = createProject();
      const ghBin = createReachGhBin(include, branchesReadable);
      const lisaInstall = createLisaInstall();
      try {
        return runRulesetScript(
          lisaInstall.scriptPath,
          ["--dry-run", "--yes", projectDir],
          ghBin
        ).stdout;
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(ghBin, { recursive: true, force: true });
        rmSync(lisaInstall.root, { recursive: true, force: true });
      }
    }

    it("names a ruleset whose include patterns match no branch", () => {
      const stdout = reachSweep(["refs/heads/dev"]);

      expect(stdout).toContain(REACH_HEADING);
      expect(stdout).toContain(DEAD_RULESET);
      expect(stdout).toContain("refs/heads/dev");
    });

    it("says it changed nothing, because both repairs would loosen a control", () => {
      const stdout = reachSweep(["refs/heads/dev"]);

      expect(stdout).toContain("Lisa changed nothing above");
      expect(stdout).toContain("LOOSEN a control nobody asked to loosen");
    });

    // THE NEGATIVE CONTROL. The dead ruleset's sibling in the same directory
    // includes ~DEFAULT_BRANCH — same stack, same author, same directory — and
    // it governs `main`. A sweep that flagged it too would be reporting a
    // convention as a defect, and a report an operator learns to ignore
    // protects nothing.
    it("stays silent for a ruleset that governs the default branch", () => {
      const stdout = reachSweep(["~DEFAULT_BRANCH"]);

      expect(stdout).not.toContain(REACH_HEADING);
      expect(stdout).not.toContain(REACH_UNCHECKED);
    });

    // FAIL CLOSED. An unread branch list is not an empty repository. Comparing
    // include patterns against zero branches would report EVERY ruleset as
    // governing nothing, and reading the failure as silence would report the
    // repository clean on the strength of a read that never happened.
    it("says it could not check rather than reporting a ruleset clean", () => {
      const stdout = reachSweep(["refs/heads/dev"], false);

      expect(stdout).not.toContain(REACH_HEADING);
      expect(stdout).toContain(REACH_UNCHECKED);
      expect(stdout).toContain("This is not a clean result");
    });
  });
});
/* eslint-enable sonarjs/no-duplicate-string, max-lines -- restore repository defaults */
