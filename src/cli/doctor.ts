import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { AGENTS_MD_FILENAME } from "../codex/agents-md-installer.js";
import { CLAUDE_MD_FILENAME } from "../claude/claude-md-installer.js";
import { migrateInstructionFiles } from "../core/instruction-files-migration.js";
import { probeKaneReadiness } from "../core/kane-cli.js";
import { probeSonarReadiness } from "../core/sonar-integration.js";
import { createDetectorRegistry } from "../detection/index.js";
import { checkKaneProvider } from "./doctor-kane.js";
import { checkSonarProvider } from "./doctor-sonar.js";
import { checkLegacyCodexOverlay } from "./doctor-legacy-overlay.js";
import { checkLegacyMonitorThresholds } from "./doctor-monitor-thresholds.js";
import { checkRepositoryReadiness } from "./doctor-readiness.js";
import { checkWorkerEpoch } from "./doctor-worker-epoch.js";
import { STARTERS } from "./starters.js";
import { runUpdateCheck } from "./update-check.js";

/** Status values emitted by Lisa doctor checks. */
type DoctorStatus = "ok" | "warn" | "fail";

const VERSION_CHECK_NAME = "Lisa version current?";
const STARTER_HEALTH_NAME = "Starter health";
const PROJECT_CONFIG_CHECK_NAME = "Project Lisa config present?";
const INSTRUCTION_FILES_CHECK_NAME = "Instruction files canonical?";

/** One Lisa doctor check result. */
export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

/** Machine-readable doctor result. */
export interface DoctorResult {
  checks: DoctorCheck[];
}

/** Options parsed for `lisa doctor`. */
export interface DoctorOptions {
  json?: boolean;
  offline?: boolean;
  /**
   * Add the orthogonal "Repository readiness" audit ("may an agent fleet
   * operate here unattended?") and persist `.lisa/readiness.json`. Additive and
   * warn-only: the default doctor path is byte-identical when this is unset.
   */
  readiness?: boolean;
}

/** Runtime collaborators for doctor. */
export interface DoctorDependencies {
  fetchImpl: typeof fetch;
  runUpdateCheck: typeof runUpdateCheck;
  setExitCode: (code: number) => void;
  write: (message: string) => void;
  probeKaneReadiness: typeof probeKaneReadiness;
  probeSonarReadiness: typeof probeSonarReadiness;
}

const DEFAULT_DEPENDENCIES: DoctorDependencies = {
  fetchImpl: fetch,
  runUpdateCheck,
  setExitCode: code => {
    process.exitCode = code;
  },
  write: message => console.log(message),
  probeKaneReadiness,
  probeSonarReadiness,
};

/**
 * Check Lisa's installed version against npm.
 * Exported so the console live-status probe can reuse the same check as
 * `lisa doctor` — never invent a second npm update-check path.
 * @param deps - Runtime dependencies
 * @param offline - Skip network check
 * @returns Doctor check result
 */
export async function checkVersion(
  deps: Pick<DoctorDependencies, "runUpdateCheck">,
  offline: boolean
): Promise<DoctorCheck> {
  if (offline) {
    return {
      name: VERSION_CHECK_NAME,
      status: "ok",
      detail: "Skipped network check in offline mode",
    };
  }

  const result = await deps.runUpdateCheck();
  if (result.isOutdated && result.latest) {
    return {
      name: VERSION_CHECK_NAME,
      status: "warn",
      detail: `Installed ${result.current}; latest is ${result.latest}`,
    };
  }

  return {
    name: VERSION_CHECK_NAME,
    status: result.latest ? "ok" : "warn",
    detail: result.latest
      ? `Installed ${result.current}; latest is ${result.latest}`
      : `Latest version unavailable${result.reason ? ` (${result.reason})` : ""}`,
  };
}

/**
 * Validate Lisa project configuration files.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
async function checkProjectConfig(targetPath: string): Promise<DoctorCheck> {
  const configPaths = [".lisa.config.json", ".lisa.config.local.json"]
    .map(fileName => path.join(targetPath, fileName))
    .filter(configPath => existsSync(configPath));

  if (configPaths.length === 0) {
    return {
      name: PROJECT_CONFIG_CHECK_NAME,
      status: "warn",
      detail: "No .lisa.config.json or .lisa.config.local.json found",
    };
  }

  for (const configPath of configPaths) {
    try {
      JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
      return {
        name: PROJECT_CONFIG_CHECK_NAME,
        status: "fail",
        detail: `${path.basename(configPath)} is not parseable JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  return {
    name: PROJECT_CONFIG_CHECK_NAME,
    status: "ok",
    detail: configPaths.map(configPath => path.basename(configPath)).join(", "),
  };
}

/**
 * Detect the target project type.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
async function checkProjectType(targetPath: string): Promise<DoctorCheck> {
  const detectorRegistry = createDetectorRegistry();
  const detectedTypes = detectorRegistry.expandAndOrderTypes(
    await detectorRegistry.detectAll(targetPath)
  );
  if (detectedTypes.length === 0) {
    return {
      name: "Project type detection",
      status: "warn",
      detail: "No Lisa project type detected",
    };
  }

  return {
    name: "Project type detection",
    status: "ok",
    detail: detectedTypes.join(", "),
  };
}

/**
 * Confirm starter repositories are reachable and marked as templates.
 * @param deps - Runtime dependencies
 * @param offline - Skip network checks
 * @returns Doctor check result
 */
async function checkStarterHealth(
  deps: DoctorDependencies,
  offline: boolean
): Promise<DoctorCheck> {
  if (offline) {
    return {
      name: STARTER_HEALTH_NAME,
      status: "ok",
      detail: "Skipped GitHub starter checks in offline mode",
    };
  }

  const checks = await Promise.all(
    Object.values(STARTERS).map(async starter => {
      const failurePrefix = `${starter.repo}:`;
      try {
        const response = await deps.fetchImpl(
          `https://api.github.com/repos/${starter.owner}/${starter.repo}`
        );
        if (!response.ok) {
          return `${failurePrefix} http-${response.status}`;
        }
        const body = (await response.json()) as { is_template?: unknown };
        if (body.is_template !== true) {
          return `${failurePrefix} not-template`;
        }
      } catch {
        return `${failurePrefix} unreachable`;
      }
      return null;
    })
  );
  const failures = checks.filter((check): check is string => check !== null);

  return {
    name: STARTER_HEALTH_NAME,
    status: failures.length === 0 ? "ok" : "warn",
    detail:
      failures.length === 0
        ? "Starter repositories are reachable templates"
        : failures.join(", "),
  };
}

/**
 * Check basic wiki contract files when a wiki exists.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
function checkWiki(targetPath: string): DoctorCheck {
  const wikiPath = path.join(targetPath, "wiki");
  if (!existsSync(wikiPath)) {
    return {
      name: "Wiki health",
      status: "ok",
      detail: "No wiki directory present",
    };
  }

  const required = [
    "lisa-wiki.config.json",
    "schema/llm-wiki-contract.md",
    "index.md",
  ];
  const missing = required.filter(fileName => {
    return !existsSync(path.join(wikiPath, fileName));
  });

  return {
    name: "Wiki health",
    status: missing.length === 0 ? "ok" : "fail",
    detail:
      missing.length === 0
        ? "Required wiki files are present"
        : `Missing ${missing.join(", ")}`,
  };
}

/**
 * Determine whether a path looks like an agent-governed project, i.e. one that
 * should carry the canonical `AGENTS.md` / `CLAUDE.md` pointer pattern. True
 * when a Lisa config or either instruction file already exists — this keeps the
 * mutating migration from touching unrelated, non-Lisa directories.
 * @param targetPath - Project path to inspect
 * @returns True when the path is an agent/Lisa project
 */
function looksLikeAgentProject(targetPath: string): boolean {
  return [
    ".lisa.config.json",
    ".lisa.config.local.json",
    AGENTS_MD_FILENAME,
    CLAUDE_MD_FILENAME,
  ].some(fileName => existsSync(path.join(targetPath, fileName)));
}

/**
 * Ensure the project's agent instruction files follow Lisa's canonical pattern
 * (canonical `AGENTS.md` + a thin `CLAUDE.md` that `@AGENTS.md`-imports it) and
 * carry no legacy agy baked-rules block. This check is mutating: it repairs
 * existing projects in place, non-destructively (host content is preserved).
 * @param targetPath - Project path to inspect and repair
 * @returns Doctor check result describing what, if anything, was changed
 */
async function checkInstructionFiles(targetPath: string): Promise<DoctorCheck> {
  if (!looksLikeAgentProject(targetPath)) {
    return {
      name: INSTRUCTION_FILES_CHECK_NAME,
      status: "ok",
      detail: "Not a Lisa/agent project; skipped",
    };
  }

  try {
    const result = await migrateInstructionFiles(targetPath);
    return {
      name: INSTRUCTION_FILES_CHECK_NAME,
      status: "ok",
      detail: result.changed
        ? `Repaired: ${result.actions.join("; ")}`
        : "Already canonical (AGENTS.md source of truth, CLAUDE.md imports it)",
    };
  } catch (error) {
    return {
      name: INSTRUCTION_FILES_CHECK_NAME,
      status: "fail",
      detail: `Could not reconcile instruction files: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Run Lisa doctor checks.
 * @param targetPath - Optional project path
 * @param options - Parsed command options
 * @param dependencies - Optional collaborators for tests
 * @returns Doctor result
 */
export async function runDoctor(
  targetPath: string | undefined,
  options: DoctorOptions,
  dependencies: Partial<DoctorDependencies> = {}
): Promise<DoctorResult> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const resolvedTarget = path.resolve(targetPath ?? process.cwd());
  const checks = [
    await checkVersion(deps, options.offline === true),
    await checkProjectConfig(resolvedTarget),
    await checkKaneProvider(resolvedTarget, deps),
    await checkSonarProvider(resolvedTarget, deps),
    await checkLegacyMonitorThresholds(resolvedTarget),
    await checkProjectType(resolvedTarget),
    await checkInstructionFiles(resolvedTarget),
    await checkWorkerEpoch(resolvedTarget),
    checkLegacyCodexOverlay(resolvedTarget),
    await checkStarterHealth(deps, options.offline === true),
    checkWiki(resolvedTarget),
    ...(options.readiness === true
      ? [await checkRepositoryReadiness(resolvedTarget)]
      : []),
  ];
  const result = { checks };

  if (options.json) {
    deps.write(JSON.stringify(result, null, 2));
  } else {
    deps.write(
      checks
        .map(
          check =>
            `${check.status.toUpperCase()} ${check.name}: ${check.detail}`
        )
        .join("\n")
    );
  }

  if (checks.some(check => check.status === "fail")) {
    deps.setExitCode(1);
  }

  return result;
}
