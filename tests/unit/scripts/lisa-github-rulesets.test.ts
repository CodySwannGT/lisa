/* eslint-disable sonarjs/no-duplicate-string, max-lines -- shell mock fixtures intentionally repeat gh argv fragments */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
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
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_NAME = "lisa-github-rulesets.sh";
const GENERATOR_NAME = "lisa-ruleset-payload.mjs";
const GATES_NAME = "lisa-gates.mjs";
const INVOKED_AS_SCRIPT_NAME = "invoked-as-script.mjs";
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
  execFileSync(GIT_BIN, ["init"], {
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
  mkdirSync(path.join(gatesDir, "lib"), { recursive: true });
  copyFileSync(
    path.join(REPO_ROOT, "all", "copy-overwrite", "scripts", GATES_NAME),
    path.join(gatesDir, GATES_NAME)
  );
  copyFileSync(
    path.join(
      REPO_ROOT,
      "all",
      "copy-overwrite",
      "scripts",
      "lib",
      INVOKED_AS_SCRIPT_NAME
    ),
    path.join(gatesDir, "lib", INVOKED_AS_SCRIPT_NAME)
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
): ReturnType<typeof spawnSync> {
  return spawnSync(BASH_BIN, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    env: cleanGitEnv(process.env, {
      PATH: `${ghBin}:${process.env.PATH ?? ""}`,
    }),
    encoding: "utf8",
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
      const result = spawnSync(
        BASH_BIN,
        [lisaInstall.scriptPath, "--dry-run", projectDir],
        {
          cwd: REPO_ROOT,
          // eslint-disable-next-line sonarjs/no-os-command-from-path -- Test-only PATH shim injects the mock gh executable.
          env: cleanGitEnv(process.env, {
            PATH: `${ghBin}:${process.env.PATH ?? ""}`,
          }),
          encoding: "utf8",
        }
      );

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
    const SG_CONTEXT = "🔍 Quality Checks / 🔎 AST Grep Scan";
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
});
/* eslint-enable sonarjs/no-duplicate-string, max-lines -- restore repository defaults */
