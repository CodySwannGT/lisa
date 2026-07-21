/** Deterministic setup-readiness projection for the Lisa console checklist. */
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns, max-lines, sonarjs/no-duplicate-string -- fixed setup row contract stays auditable in one module */
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runConfigSync } from "../sync/config-sync.js";
import {
  summarizeHealthFindings,
  type HealthFinding,
  type HealthResult,
  validateHealthResult,
} from "./contract.js";
import { deterministicFinding, namedReason } from "./finding-utils.js";
import { runDeterministicHealth } from "./deterministic.js";
import {
  projectPathKind,
  readProjectJsonObject,
  readProjectText,
} from "./read-only-fs.js";

export const SETUP_READINESS_CHECKS = [
  "setup.install",
  "setup.sync",
  "setup.agent-ready",
  "setup.standards",
  "setup.tracker",
  "setup.prd-source",
  "setup.github-governance",
  "setup.secrets",
  "setup.automations",
  "setup.exploration",
  "setup.wiki",
  "setup.starter-provenance",
] as const;

/** Stable setup checklist check identifier. */
export type SetupReadinessCheck = (typeof SETUP_READINESS_CHECKS)[number];

/** Runtime options for the read-only setup projection. */
export interface SetupReadinessOptions {
  readonly lisaRoot?: string;
  readonly now?: () => Date;
  readonly environment?: NodeJS.ProcessEnv;
}

type Config = Readonly<Record<string, unknown>>;

function configuredObject(config: Config, key: string): Config | undefined {
  const value = config[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Config)
    : undefined;
}

function configuredString(config: Config, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function finding(
  check: SetupReadinessCheck,
  status: HealthFinding["status"],
  reason: string
): HealthFinding {
  return deterministicFinding(check, status, reason);
}

async function loadConfig(projectRoot: string): Promise<Config | undefined> {
  try {
    return await readProjectJsonObject(projectRoot, ".lisa.config.json");
  } catch {
    return undefined;
  }
}

async function installFinding(
  projectRoot: string,
  config: Config | undefined
): Promise<HealthFinding> {
  const packageKind = await projectPathKind(projectRoot, "package.json");
  if (packageKind !== "file" || config === undefined) {
    return finding(
      "setup.install",
      "fail",
      "Lisa install evidence needs package.json and a readable .lisa.config.json."
    );
  }
  return finding(
    "setup.install",
    "pass",
    "Lisa project files and configuration are readable."
  );
}

async function syncFinding(
  projectRoot: string,
  config: Config | undefined
): Promise<HealthFinding> {
  if (config === undefined) {
    return finding(
      "setup.sync",
      "fail",
      "Configuration cannot be read, so sync state cannot be established."
    );
  }
  const report = await runConfigSync(projectRoot, { dryRun: true });
  const drift = [
    ...report.missingRequired.map(item => item.key),
    ...report.actions.map(action => action.key),
  ];
  return drift.length === 0
    ? finding(
        "setup.sync",
        "pass",
        "Configuration and mirrored artifacts are synchronized."
      )
    : finding(
        "setup.sync",
        "fail",
        namedReason("Config sync work remains", drift)
      );
}

async function agentReadyFinding(projectRoot: string): Promise<HealthFinding> {
  const sources = await projectPathKind(
    projectRoot,
    "wiki/state/agent-ready/sources.json"
  );
  const gaps = await readProjectText(projectRoot, "wiki/gaps.md", 128 * 1024);
  if (sources !== "file") {
    return finding(
      "setup.agent-ready",
      "warn",
      "Agent-ready source coverage has not been recorded."
    );
  }
  const gapLines = gaps
    ?.split("\n")
    .map(line => line.trim().toLowerCase())
    .filter(line => line.length > 0);
  if (
    gapLines !== undefined &&
    gapLines.some(
      line =>
        line.includes("open gaps") ||
        line.includes("todo") ||
        line.includes("unanswered") ||
        line.startsWith("- ")
    )
  ) {
    return finding(
      "setup.agent-ready",
      "warn",
      "Agent-ready gaps remain in wiki/gaps.md."
    );
  }
  return finding(
    "setup.agent-ready",
    "pass",
    "Agent-ready source coverage is recorded with no detected open gaps."
  );
}

function standardsFinding(health: HealthResult): HealthFinding {
  const relevant = new Set([
    "templates.managed",
    "package.conformance",
    "instructions.canonical",
    "hooks.managed",
    "ci.workflows",
  ]);
  const failing = health.findings.filter(
    item => relevant.has(item.check) && item.status !== "pass"
  );
  return failing.length === 0
    ? finding("setup.standards", "pass", "Lisa standards checks are passing.")
    : finding(
        "setup.standards",
        "fail",
        namedReason(
          "Lisa standards checks are not passing",
          failing.map(item => item.check)
        )
      );
}

function trackerFinding(config: Config | undefined): HealthFinding {
  const tracker =
    config === undefined ? undefined : configuredString(config, "tracker");
  return tracker === undefined
    ? finding("setup.tracker", "fail", "No work tracker is configured.")
    : finding(
        "setup.tracker",
        "pass",
        `Work tracker is configured as ${tracker}.`
      );
}

function prdSourceFinding(config: Config | undefined): HealthFinding {
  const source =
    config === undefined ? undefined : configuredString(config, "source");
  return source === undefined
    ? finding("setup.prd-source", "fail", "No PRD source is configured.")
    : finding(
        "setup.prd-source",
        "pass",
        `PRD source is configured as ${source}.`
      );
}

function githubGovernanceFinding(
  config: Config | undefined,
  health: HealthResult
): HealthFinding {
  const github =
    config === undefined ? undefined : configuredObject(config, "github");
  if (github === undefined) {
    return finding(
      "setup.github-governance",
      "warn",
      "GitHub repository governance is unavailable because github.org and github.repo are not configured."
    );
  }
  const rulesets = health.findings.find(
    item => item.check === "github.rulesets"
  );
  if (rulesets?.status === "fail") {
    return finding(
      "setup.github-governance",
      "fail",
      "GitHub repository governance checks failed."
    );
  }
  return finding(
    "setup.github-governance",
    rulesets?.status === "pass" ? "pass" : "warn",
    rulesets?.status === "pass"
      ? "GitHub repository governance is configured."
      : "GitHub repository governance needs live ruleset verification."
  );
}

function secretFinding(
  config: Config | undefined,
  environment: NodeJS.ProcessEnv
): HealthFinding {
  const names = [
    ...(configuredString(config ?? {}, "tracker") === "github" ||
    configuredString(config ?? {}, "source") === "github"
      ? ["GH_TOKEN"]
      : []),
    ...(configuredString(config ?? {}, "tracker") === "jira"
      ? ["JIRA_API_TOKEN"]
      : []),
    ...(configuredString(config ?? {}, "source") === "notion"
      ? ["NOTION_API_TOKEN"]
      : []),
  ].filter((name, index, all) => all.indexOf(name) === index);
  if (names.length === 0) {
    return finding(
      "setup.secrets",
      "warn",
      "No secret requirements were detected from configuration."
    );
  }
  const missing = names.filter(
    name =>
      !(typeof environment[name] === "string" && environment[name]!.length > 0)
  );
  return missing.length === 0
    ? finding(
        "setup.secrets",
        "pass",
        "Configured integration secret names are present in the Lisa process environment."
      )
    : finding(
        "setup.secrets",
        "warn",
        namedReason("Missing configured secret names", missing)
      );
}

function automationsFinding(config: Config | undefined): HealthFinding {
  const schedule =
    configuredObject(config ?? {}, "monitor") ??
    configuredObject(config ?? {}, "intake");
  const health = configuredObject(config ?? {}, "health");
  return schedule !== undefined ||
    configuredString(health ?? {}, "schedule") !== undefined
    ? finding(
        "setup.automations",
        "pass",
        "Automation configuration is present."
      )
    : finding(
        "setup.automations",
        "warn",
        "Automation scheduler setup has not been observed."
      );
}

function explorationFinding(config: Config | undefined): HealthFinding {
  return configuredObject(config ?? {}, "exploration") === undefined
    ? finding(
        "setup.exploration",
        "warn",
        "Exploration environment policy is not configured."
      )
    : finding(
        "setup.exploration",
        "pass",
        "Exploration environment policy is configured."
      );
}

async function wikiSetupFinding(projectRoot: string): Promise<HealthFinding> {
  const required = [
    "wiki/lisa-wiki.config.json",
    "wiki/schema/llm-wiki-contract.md",
    "wiki/index.md",
  ];
  const missing = (
    await Promise.all(
      required.map(async file =>
        (await projectPathKind(projectRoot, file)) === "file" ? undefined : file
      )
    )
  ).filter((file): file is string => file !== undefined);
  return missing.length === 0
    ? finding("setup.wiki", "pass", "LLM wiki contract files are installed.")
    : finding(
        "setup.wiki",
        "warn",
        namedReason("LLM wiki files are not installed", missing)
      );
}

function starterProvenanceFinding(config: Config | undefined): HealthFinding {
  return configuredObject(config ?? {}, "starter") === undefined
    ? finding(
        "setup.starter-provenance",
        "warn",
        "Starter provenance is not configured."
      )
    : finding(
        "setup.starter-provenance",
        "pass",
        "Starter provenance is configured."
      );
}

function result(
  started: Date,
  completed: Date,
  findings: readonly HealthFinding[]
): HealthResult {
  return validateHealthResult({
    schemaVersion: 1,
    runId: `setup-readiness-${crypto.randomUUID()}`,
    mode: "deterministic",
    startedAt: started.toISOString(),
    completedAt: (completed < started ? started : completed).toISOString(),
    findings,
    summary: summarizeHealthFindings(findings),
  });
}

/** Run the bounded read-only setup-readiness projection for a project. */
export async function runSetupReadiness(
  projectRoot: string,
  options: SetupReadinessOptions = {}
): Promise<HealthResult> {
  const now = options.now ?? (() => new Date());
  const started = now();
  const root = await realpath(projectRoot);
  const lisaRoot =
    options.lisaRoot ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const [config, health] = await Promise.all([
    loadConfig(root),
    runDeterministicHealth(root, { lisaRoot }),
  ]);
  const findings = await Promise.all([
    installFinding(root, config),
    syncFinding(root, config),
    agentReadyFinding(root),
    Promise.resolve(standardsFinding(health)),
    Promise.resolve(trackerFinding(config)),
    Promise.resolve(prdSourceFinding(config)),
    Promise.resolve(githubGovernanceFinding(config, health)),
    Promise.resolve(secretFinding(config, options.environment ?? {})),
    Promise.resolve(automationsFinding(config)),
    Promise.resolve(explorationFinding(config)),
    wikiSetupFinding(root),
    Promise.resolve(starterProvenanceFinding(config)),
  ]);
  return result(started, now(), findings);
}
/* eslint-enable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns, max-lines, sonarjs/no-duplicate-string -- restore repository defaults */
