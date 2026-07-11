import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SETTINGS_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "lisa-github-repo-settings.sh"
);
const BASH_BIN = "/bin/bash";
const GIT_BIN = "/usr/bin/git";
const REPO_NAME = "CodySwannGT/lisa";
const CODERABBIT_INTEGRATION_ID = 347564;
const ACTIONS_INTEGRATION_ID = 15368;
const RULESETS_DIR = "github-rulesets";

/**
 * A required status check entry inside a ruleset template.
 */
interface RequiredCheck {
  readonly context: string;
  readonly integration_id: number;
}

/**
 * A single rule inside a ruleset template.
 */
interface RulesetRule {
  readonly type: string;
  readonly parameters?: {
    readonly allowed_merge_methods?: readonly string[];
    readonly required_review_thread_resolution?: boolean;
    readonly required_status_checks?: readonly RequiredCheck[];
  };
}

/**
 * The shape of a github-rulesets JSON template.
 */
interface RulesetTemplate {
  readonly name: string;
  readonly target: string;
  readonly enforcement: string;
  readonly rules: readonly RulesetRule[];
}

/**
 * Collects every github-rulesets template shipped with Lisa.
 *
 * @returns Template file paths keyed by their project-type directory.
 */
function collectTemplates(): readonly { file: string; type: string }[] {
  const templates: { file: string; type: string }[] = [];
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const rulesetDir = path.join(REPO_ROOT, entry.name, RULESETS_DIR);
    let files: readonly string[] = [];
    try {
      files = readdirSync(rulesetDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.endsWith(".json")) {
        templates.push({ file: path.join(rulesetDir, file), type: entry.name });
      }
    }
  }
  return templates;
}

/**
 * Creates a git project directory for the settings script to inspect.
 *
 * @returns Temporary project directory path.
 */
function createProject(): string {
  const projectDir = mkdtempSync(path.join(tmpdir(), "lisa-settings-"));
  execFileSync(GIT_BIN, ["init"], { cwd: projectDir, stdio: "ignore" });
  return projectDir;
}

/**
 * Creates a mock gh executable for the settings script.
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
      'echo "unexpected gh invocation: $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return binDir;
}

/**
 * Runs the settings script in dry-run mode with a mock gh on PATH.
 *
 * @param projectDir - Project directory to point the script at.
 * @param ghBin - Directory containing the mock gh executable.
 * @returns Captured stdout from the script.
 */
function runSettingsDryRun(projectDir: string, ghBin: string): string {
  const shimmedPath = [ghBin, process.env.PATH ?? ""].join(":");
  const result = spawnSync(
    BASH_BIN,
    [SETTINGS_SCRIPT, "--dry-run", projectDir],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: shimmedPath },
      encoding: "utf8",
    }
  );
  expect(result.status).toBe(0);
  return result.stdout;
}

/**
 * Mirrors the script's jq filter that drops Actions-based required checks
 * for projects without workflows.
 *
 * @param template - Parsed ruleset template.
 * @returns The template with Actions checks removed.
 */
function stripActionsChecks(template: RulesetTemplate): RulesetTemplate {
  const rules = template.rules
    .map(rule => {
      if (rule.type !== "required_status_checks") {
        return rule;
      }
      const checks = (rule.parameters?.required_status_checks ?? []).filter(
        check => check.integration_id !== ACTIONS_INTEGRATION_ID
      );
      return {
        ...rule,
        parameters: { ...rule.parameters, required_status_checks: checks },
      };
    })
    .filter(
      rule =>
        rule.type !== "required_status_checks" ||
        (rule.parameters?.required_status_checks ?? []).length > 0
    );
  return { ...template, rules };
}

/**
 * Reads and parses a ruleset template relative to the repo root.
 *
 * @param segments - Path segments below the repo root.
 * @returns Parsed ruleset template.
 */
function readTemplate(...segments: readonly string[]): RulesetTemplate {
  return JSON.parse(
    readFileSync(path.join(REPO_ROOT, ...segments), "utf8")
  ) as RulesetTemplate;
}

describe("github-rulesets templates", () => {
  const templates = collectTemplates();

  it("ships baseline templates in all/", () => {
    const names = templates
      .filter(template => template.type === "all")
      .map(template => path.basename(template.file));
    expect(names).toContain("base.json");
    expect(names).toContain("prevent-delete.json");
    expect(names).toContain("protect-tags.json");
  });

  it("every template is valid JSON with name/target/enforcement", () => {
    for (const template of templates) {
      const parsed = JSON.parse(
        readFileSync(template.file, "utf8")
      ) as RulesetTemplate;
      expect(parsed.name.length).toBeGreaterThan(0);
      expect(["branch", "tag"]).toContain(parsed.target);
      expect(parsed.enforcement).toBe("active");
      expect(Array.isArray(parsed.rules)).toBe(true);
    }
  });

  it("base template enforces merge-only PRs with thread resolution and CodeRabbit", () => {
    const base = readTemplate("all", RULESETS_DIR, "base.json");

    const pullRequestRule = base.rules.find(
      rule => rule.type === "pull_request"
    );
    expect(pullRequestRule?.parameters?.allowed_merge_methods).toEqual([
      "merge",
    ]);
    expect(pullRequestRule?.parameters?.required_review_thread_resolution).toBe(
      true
    );

    const checksRule = base.rules.find(
      rule => rule.type === "required_status_checks"
    );
    const coderabbit = checksRule?.parameters?.required_status_checks?.find(
      check => check.context === "CodeRabbit"
    );
    expect(coderabbit?.integration_id).toBe(CODERABBIT_INTEGRATION_ID);
  });

  it("never requires the stale 'CodeRabbit / Review' context", () => {
    for (const template of templates) {
      const raw = readFileSync(template.file, "utf8");
      expect(raw).not.toContain("CodeRabbit / Review");
    }
  });

  it("keeps app-based checks when Actions checks are stripped for workflow-less repos", () => {
    const base = readTemplate("all", RULESETS_DIR, "base.json");
    const stripped = stripActionsChecks(base);
    const checksRule = stripped.rules.find(
      rule => rule.type === "required_status_checks"
    );
    const contexts = (checksRule?.parameters?.required_status_checks ?? []).map(
      check => check.context
    );
    expect(contexts).toContain("CodeRabbit");
    expect(contexts).toContain("GitGuardian Security Checks");
  });

  it("drops the quality-checks ruleset entirely for workflow-less repos", () => {
    const quality = readTemplate(
      "typescript",
      RULESETS_DIR,
      "quality-checks.json"
    );
    const stripped = stripActionsChecks(quality);
    expect(stripped.rules).toHaveLength(0);
  });
});

describe("lisa-github-repo-settings.sh", () => {
  it("applies the merge-only baseline in dry-run", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      const stdout = runSettingsDryRun(projectDir, ghBin);
      expect(stdout).toContain('"allow_squash_merge": false');
      expect(stdout).toContain('"allow_rebase_merge": false');
      expect(stdout).toContain('"allow_auto_merge": true');
      expect(stdout).toContain('"delete_branch_on_merge": true');
      expect(stdout).toContain('"allow_update_branch": true');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("honors per-repo overrides from .lisa.config.json github.settings", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      writeFileSync(
        path.join(projectDir, ".lisa.config.json"),
        JSON.stringify({ github: { settings: { allow_auto_merge: false } } })
      );
      const stdout = runSettingsDryRun(projectDir, ghBin);
      expect(stdout).toContain('"allow_auto_merge": false');
      expect(stdout).toContain('"allow_squash_merge": false');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });
});

describe("lisa-github-rulesets.sh workflow gating", () => {
  it("contains the workflow-presence guard for Actions-based checks", () => {
    const rulesetsScript = readFileSync(
      path.join(REPO_ROOT, "scripts", "lisa-github-rulesets.sh"),
      "utf8"
    );
    expect(rulesetsScript).toContain("strip_actions_checks_if_no_workflows");
    expect(rulesetsScript).toContain(".github/workflows");
  });

  it("supports per-repo required-check opt-outs from .lisa.config.json", () => {
    const rulesetsScript = readFileSync(
      path.join(REPO_ROOT, "scripts", "lisa-github-rulesets.sh"),
      "utf8"
    );
    expect(rulesetsScript).toContain("strip_config_dropped_checks");
    expect(rulesetsScript).toContain("dropRequiredChecks");
  });

  it("drops config-listed contexts while keeping the rest", () => {
    const base = readTemplate("all", RULESETS_DIR, "base.json");
    const dropped = new Set(["CodeRabbit"]);
    const rules = base.rules
      .map(rule => {
        if (rule.type !== "required_status_checks") {
          return rule;
        }
        const checks = (rule.parameters?.required_status_checks ?? []).filter(
          check => !dropped.has(check.context)
        );
        return {
          ...rule,
          parameters: { ...rule.parameters, required_status_checks: checks },
        };
      })
      .filter(
        rule =>
          rule.type !== "required_status_checks" ||
          (rule.parameters?.required_status_checks ?? []).length > 0
      );
    const contexts = (
      rules.find(rule => rule.type === "required_status_checks")?.parameters
        ?.required_status_checks ?? []
    ).map(check => check.context);
    expect(contexts).not.toContain("CodeRabbit");
    expect(contexts).toContain("GitGuardian Security Checks");
  });
});
