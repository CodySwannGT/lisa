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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_NAME = "lisa-github-rulesets.sh";
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", SCRIPT_NAME);
const BASH_BIN = "/bin/bash";
const GIT_BIN = "/usr/bin/git";
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
 * Creates a temporary Lisa install layout with multiple ruleset templates.
 *
 * @returns Temporary Lisa install root and copied script path.
 */
function createLisaInstall(): { scriptPath: string; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-install-"));
  const scriptsDir = path.join(root, "scripts");
  const scriptPath = path.join(scriptsDir, SCRIPT_NAME);
  const rulesetDir = path.join(root, "typescript", "github-rulesets");

  mkdirSync(scriptsDir, { recursive: true });
  copyFileSync(SCRIPT_PATH, scriptPath);
  mkdirSync(rulesetDir, { recursive: true });
  writeFileSync(
    path.join(rulesetDir, "base.json"),
    JSON.stringify({ name: "base", enforcement: ACTIVE_ENFORCEMENT })
  );
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
  describe("github.rulesets.addRequiredChecks", () => {
    const REPO_ONLY_CONTEXT = "🧩 Repo Only";
    const CONTESTED_CONTEXT = "🧩 Contested";

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
  });
});
