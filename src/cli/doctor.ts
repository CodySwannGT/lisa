import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { AGENTS_MD_FILENAME } from "../codex/agents-md-installer.js";
import { CLAUDE_MD_FILENAME } from "../claude/claude-md-installer.js";
import { migrateInstructionFiles } from "../core/instruction-files-migration.js";
import { probeKaneReadiness } from "../core/kane-cli.js";
import { probeSonarReadiness } from "../core/sonar-integration.js";
import { createDetectorRegistry } from "../detection/index.js";
import {
  checkApplyFreshness,
  checkYamlRuntime,
} from "./doctor-apply-freshness.js";
import { checkLockfileReconciliation } from "./doctor-reconciliation.js";
import { checkKaneProvider } from "./doctor-kane.js";
import { checkLearningsLedger } from "./doctor-learnings-ledger.js";
import { checkMergeDrivers } from "./doctor-merge-drivers.js";
import { checkReadinessReportTracking } from "./doctor-readiness-tracking.js";
import { checkSonarProvider } from "./doctor-sonar.js";
import { checkLegacyCodexOverlay } from "./doctor-legacy-overlay.js";
import { checkLisaOwnedArtifacts } from "./doctor-lisa-owned-artifacts.js";
import { checkLegacyMonitorThresholds } from "./doctor-monitor-thresholds.js";
import { checkRepositoryReadiness } from "./doctor-readiness.js";
import { checkReusableWorkflowRefs } from "./doctor-reusable-workflow-refs.js";
import { checkWorkerEpoch } from "./doctor-worker-epoch.js";
import { checkSerializeLegsContract } from "./doctor-serialize-legs-contract.js";
import { checkApplyFailure } from "./doctor-apply-failure.js";
import { checkOverrideFloorConflicts } from "./doctor-override-floor-conflicts.js";
import { renderDoctorResult } from "./doctor-render.js";
import type { GateReport } from "./gate-report-types.js";
import { checkSkipJobsMigration } from "./doctor-skip-jobs-migration.js";
import { checkTwoChannelDrift } from "./doctor-two-channel-drift.js";
import { checkNightlyE2eGuard } from "./doctor-nightly-e2e-guard.js";
import { checkWiki } from "./doctor-wiki.js";
import { checkDeclaredContexts } from "./doctor-declared-contexts.js";
import { checkTraceabilityGate } from "./doctor-traceability-gate.js";
import { checkHookCopyParity } from "./doctor-hook-copy-parity.js";
import { checkWorktreeHygiene } from "./doctor-worktree-hygiene.js";
import { checkWorktreeWorkAtRisk } from "./doctor-worktree-work-at-risk.js";
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
  /**
   * The deterministic gate report, present only under `--json`.
   *
   * A separate key rather than more `DoctorCheck` rows, because `DoctorStatus`
   * is `ok | warn | fail` and has no unknown state. A report whose central
   * contract is that "not checkable here" is never folded into a pass cannot
   * be expressed in a three-valued shape that lacks it — flattening it would
   * be the exact defect the report exists to detect, committed by the report.
   *
   * It also does not touch the exit code. The report describes what a project
   * has configured, and a project that has configured nothing is the modal
   * consumer, not a failing one.
   */
  gateReport?: GateReport;
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
    // Runs early and unconditionally: a repo that has silently stopped applying
    // templates fails every other check's premise, and the two lines below are
    // the ones that name the cause (CodySwannGT/lisa#2467).
    await checkApplyFreshness(resolvedTarget),
    // Immediately after, because it answers the second half of the same
    // question. That check asks whether apply ran; this one asks whether the
    // lockfile repair apply schedules on its way out ever landed. For bun
    // consumers it never did, and the only symptom was a frozen-lockfile
    // failure in CI hours later (CodySwannGT/lisa#2750).
    await checkLockfileReconciliation(resolvedTarget),
    checkYamlRuntime(),
    await checkProjectConfig(resolvedTarget),
    // Immediately after the config check, because it repairs the same file and
    // an operator reading the output wants both config findings together. It
    // is mutating: an undeclared gate is ADDED rather than merely reported,
    // since an undeclared gate means the job never runs and there is no signal
    // to notice (CodySwannGT/lisa#2677).
    await checkTraceabilityGate(resolvedTarget),
    // Immediately after, because both concern gate declarations and an
    // operator wants them together. That check repairs ONE declaration; this
    // one compares every declaration against the ruleset template that
    // enforces it, which is the layer the traceability check only reports.
    await checkDeclaredContexts(resolvedTarget),
    await checkKaneProvider(resolvedTarget, deps),
    await checkSonarProvider(resolvedTarget, deps),
    await checkLegacyMonitorThresholds(resolvedTarget),
    await checkLisaOwnedArtifacts(resolvedTarget),
    await checkReusableWorkflowRefs(resolvedTarget),
    // Immediately after the ref check, because both read the same caller
    // workflows and an operator editing one wants both findings together. This
    // one only REPORTS: `lisa apply` runs on postinstall, and a repair that
    // edits a caller workflow there and gets it wrong is silent
    // (CodySwannGT/lisa#2719).
    await checkSkipJobsMigration(resolvedTarget),
    // Third of the caller-workflow trio. The two above ask whether the callers
    // are spelled right; this asks whether the artifacts they INVOKE ever
    // arrived — the body travels at `@main` and the script only on an apply, so
    // the halves land out of order and nothing reads as red (#3050).
    await checkTwoChannelDrift(resolvedTarget),
    // The two-channel check asks whether a workflow's companion file arrived;
    // this one follows the file the ACTIVE bypass-bearing caller invokes and
    // proves its shipped provenance plus contract declaration without executing
    // untrusted project JavaScript. A current managed copy sitting unused next
    // to an older renamed fork must not make either check look green (#2519).
    await checkNightlyE2eGuard(resolvedTarget),
    await checkApplyFailure(resolvedTarget),
    // Immediately after the recorded-failure check, because they are the two
    // halves of the same operator question. That one reports that an apply DID
    // fail; this one answers whether the next one will, and names the one-line
    // raise that prevents it — a security floor an override would resolve
    // downwards is refused, and until now nothing said so in advance
    // (CodySwannGT/lisa#2754).
    await checkOverrideFloorConflicts(resolvedTarget),
    await checkProjectType(resolvedTarget),
    await checkInstructionFiles(resolvedTarget),
    // Runs AFTER the instruction-files check because that check performs the
    // legacy ledger relocation. A project whose ledger merely needs moving is
    // repaired first and passes here; only a genuine second ledger survives to
    // be reported.
    await checkLearningsLedger(resolvedTarget),
    // Immediately after, and for the same reason that check runs late: both
    // resolve the configured ledger path, which the instruction-files check may
    // have just relocated. Reporting the merge arm second is also the order an
    // operator can act in — which ledger is canonical, then whether this
    // checkout can actually run the union merge that protects it.
    await checkMergeDrivers(resolvedTarget),
    // The readiness report's protection is a .gitignore line rather than a
    // merge driver, because the report is derived and a blend of two
    // assessments describes a tree that never existed. An ignore rule only
    // binds an UNTRACKED path, so a checkout that committed one before the
    // rule shipped keeps committing it and says nothing
    // (CodySwannGT/lisa#3046).
    await checkReadinessReportTracking(resolvedTarget),
    await checkWorkerEpoch(resolvedTarget),
    checkLegacyCodexOverlay(resolvedTarget),
    // Environment hygiene rather than project config: accumulated agent
    // worktrees are what make unrelated unit suites time out under ambient
    // load, so an operator debugging a red suite needs the count in front of
    // them (CodySwannGT/lisa#2490).
    // Static answer to a runtime failure that is deliberately silent: an
    // incomplete serialize opt-in warns at 2am on a green job and nowhere else.
    await checkSerializeLegsContract(resolvedTarget),
    // Sibling copies of one hook inside THIS tree, which the Lisa-owned
    // artifact check cannot see: its axis is host copy vs shipped package copy
    // for one destination, so a second copy at another path is outside it by
    // construction (CodySwannGT/lisa#2847).
    await checkHookCopyParity(resolvedTarget),
    await checkWorktreeHygiene(resolvedTarget),
    // Immediately after the count check, and deliberately separate from it.
    // Hygiene answers "how many checkouts is every crawler walking past"; this
    // answers "which of them hold work that exists nowhere else". Retiring a
    // worktree on the first answer without the second is how work is lost.
    await checkWorktreeWorkAtRisk(resolvedTarget),
    await checkStarterHealth(deps, options.offline === true),
    checkWiki(resolvedTarget),
    ...(options.readiness === true
      ? [await checkRepositoryReadiness(resolvedTarget)]
      : []),
  ];
  const result = await renderDoctorResult(
    checks,
    resolvedTarget,
    options,
    deps.write
  );

  if (checks.some(check => check.status === "fail")) {
    deps.setExitCode(1);
  }

  return result;
}
