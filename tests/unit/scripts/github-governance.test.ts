import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readGates } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { buildRulesetPayload } from "../../../scripts/lisa-ruleset-payload.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
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

/**
 * The `base` ruleset this repository's own config produces.
 *
 * Read through the generator rather than off disk, because that is the only
 * place the document exists now — which also means these assertions are made
 * against what would actually be sent to GitHub.
 *
 * @returns The generated ruleset.
 */
function generatedBase(): RulesetTemplate {
  const { gates, policy } = readGates(REPO_ROOT) as {
    gates: object;
    policy: object;
  };
  return buildRulesetPayload({ gates, policy }) as RulesetTemplate;
}

describe("github-rulesets templates", () => {
  const templates = collectTemplates();

  it("ships baseline templates in all/", () => {
    const names = templates
      .filter(template => template.type === "all")
      .map(template => path.basename(template.file));
    // `base.json` is deliberately absent. It duplicated seven fields the
    // `policy` block already declared, could not express four more, and pinned
    // two vendor status checks every repository inherited and none could drop.
    // The `base` ruleset is generated from `.lisa.config.json` instead.
    expect(names).not.toContain("base.json");
    expect(
      existsSync(path.join(REPO_ROOT, "scripts", "lisa-ruleset-payload.mjs"))
    ).toBe(true);
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

  it("the generated base ruleset enforces merge-only PRs with thread resolution and CodeRabbit", () => {
    const base = generatedBase();

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
    const stripped = stripActionsChecks(generatedBase());
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

const RULESETS_SCRIPT_NAME = "lisa-github-rulesets.sh";

describe("lisa-github-rulesets.sh workflow gating", () => {
  it("contains the workflow-presence guard for Actions-based checks", () => {
    const rulesetsScript = readFileSync(
      path.join(REPO_ROOT, "scripts", RULESETS_SCRIPT_NAME),
      "utf8"
    );
    expect(rulesetsScript).toContain("strip_actions_checks_if_no_workflows");
    expect(rulesetsScript).toContain(".github/workflows");
  });

  it("supports per-repo required-check opt-outs from .lisa.config.json", () => {
    const rulesetsScript = readFileSync(
      path.join(REPO_ROOT, "scripts", RULESETS_SCRIPT_NAME),
      "utf8"
    );
    expect(rulesetsScript).toContain("strip_config_dropped_checks");
    expect(rulesetsScript).toContain("dropRequiredChecks");
  });

  // #2485: the mirror of the opt-out. Without it, a check that exists in only
  // one repository can never be required there — the only alternatives are
  // writing it into a shared template (where host projects would wait forever
  // on a context they never report, #2476) or a hand-rolled API call outside
  // the governance surface entirely.
  it("supports per-repo required-check opt-ins from .lisa.config.json", () => {
    const rulesetsScript = readFileSync(
      path.join(REPO_ROOT, "scripts", RULESETS_SCRIPT_NAME),
      "utf8"
    );
    expect(rulesetsScript).toContain("add_config_required_checks");
    expect(rulesetsScript).toContain("requiredChecks");
  });

  it("drops config-listed contexts while keeping the rest", () => {
    const base = generatedBase();
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
