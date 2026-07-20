/** Side-effect-free deterministic Health v1 collection. */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns -- typed probe assembly helpers are self-describing */
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runConfigSync,
  type SyncReadDependencies,
} from "../sync/config-sync.js";
import {
  summarizeHealthFindings,
  type HealthFinding,
  type HealthResult,
  type HealthStatus,
  validateHealthResult,
} from "./contract.js";
import { HealthDeadline } from "./deadline.js";
import { deterministicFinding } from "./finding-utils.js";
import {
  hookFinding,
  managedTemplateFinding,
  packageFinding,
  pluginFinding,
  workflowFinding,
} from "./governance-probes.js";
import { readCoreHooksPath, type HooksPathReader } from "./hook-inspection.js";
import {
  readInstalledClaudePlugins,
  type InstalledPluginReader,
} from "./plugin-inspection.js";
import {
  configFindings,
  instructionFinding,
  projectStateFinding,
  starterFinding,
  wikiFinding,
  type HealthConfigState,
} from "./project-probes.js";
import {
  projectPathKind,
  readProjectJsonObject,
  readProjectText,
} from "./read-only-fs.js";
import {
  readGithubRulesets,
  rulesetFinding,
  type RulesetReader,
} from "./ruleset-inspection.js";
import {
  detectHealthProjectShape,
  type HealthProjectShape,
} from "./template-inspection.js";

const DEFAULT_DEADLINE_MS = 110_000;

/**
 * Injectable deterministic-health collaborators. Reader overrides must honor
 * their AbortSignal and release owned handles; the runner bounds its own return
 * but cannot reclaim arbitrary handles created by caller-supplied JavaScript.
 */
export interface DeterministicHealthOptions {
  /** Lisa package root containing stack templates. */
  readonly lisaRoot?: string;
  /** Total wall-clock deadline, including root/config/type setup. */
  readonly deadlineMs?: number;
  /** Injectable timestamp clock for contract tests. */
  readonly now?: () => Date;
  /** Injectable bounded detailed ruleset reader. */
  readonly readRulesets?: RulesetReader;
  /** Injectable bounded actual installed-plugin reader. */
  readonly readInstalledPlugins?: InstalledPluginReader;
  /** Injectable bounded repository hooks-path reader. */
  readonly readHooksPath?: HooksPathReader;
}

/** One fixed-order check and its unavailable fallback status. */
interface Probe {
  readonly check: string;
  readonly unavailable: HealthStatus;
  readonly run: () => Promise<HealthFinding>;
}

const CHECKS: readonly Pick<Probe, "check" | "unavailable">[] = [
  { check: "project.state", unavailable: "fail" },
  { check: "project.wiki", unavailable: "fail" },
  { check: "starters.remote", unavailable: "warn" },
  { check: "config.required", unavailable: "fail" },
  { check: "config.sync", unavailable: "fail" },
  { check: "templates.managed", unavailable: "fail" },
  { check: "package.conformance", unavailable: "fail" },
  { check: "instructions.canonical", unavailable: "fail" },
  { check: "hooks.managed", unavailable: "fail" },
  { check: "plugins.current", unavailable: "warn" },
  { check: "ci.workflows", unavailable: "fail" },
  { check: "github.rulesets", unavailable: "warn" },
];

/**
 * Stable fallback when a check cannot complete inside the shared deadline.
 * @param check
 * @param status
 */
function unavailableFinding(
  check: string,
  status: HealthStatus
): HealthFinding {
  return deterministicFinding(
    check,
    status,
    `${check} could not be safely observed within the deterministic deadline.`
  );
}

/**
 * Read config while preserving missing vs malformed state.
 * @param projectRoot
 */
async function loadConfigState(
  projectRoot: string
): Promise<HealthConfigState> {
  const kind = await projectPathKind(projectRoot, ".lisa.config.json");
  if (kind === "missing") {
    return { config: {}, present: false, readable: false };
  }
  if (kind !== "file") {
    return { config: {}, present: true, readable: false };
  }
  try {
    const config = await readProjectJsonObject(
      projectRoot,
      ".lisa.config.json"
    );
    return { config: config ?? {}, present: true, readable: true };
  } catch {
    return { config: {}, present: true, readable: false };
  }
}

/**
 * Confined JSON/path readers for the shared sync planner.
 * @param projectRoot
 */
function safeSyncReads(projectRoot: string): SyncReadDependencies {
  return {
    readJson: async relativePath => {
      const text = await readProjectText(projectRoot, relativePath);
      if (text === undefined) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
      }
    },
    pathExists: async relativePath =>
      (await projectPathKind(projectRoot, relativePath)) !== "missing",
  };
}

/**
 * Build a validated immutable HealthResult from ordered findings.
 * @param started
 * @param completed
 * @param findings
 */
function result(
  started: Date,
  completed: Date,
  findings: readonly HealthFinding[]
): HealthResult {
  const safeCompleted = completed < started ? started : completed;
  return validateHealthResult({
    schemaVersion: 1,
    runId: `health-${crypto.randomUUID()}`,
    mode: "deterministic",
    startedAt: started.toISOString(),
    completedAt: safeCompleted.toISOString(),
    findings,
    summary: summarizeHealthFindings(findings),
  });
}

/**
 * Resolve canonical project and Lisa roots inside the shared deadline.
 * @param projectPath
 * @param lisaPath
 */
async function resolveRoots(
  projectPath: string,
  lisaPath: string
): Promise<{ readonly projectRoot: string; readonly lisaRoot: string }> {
  const [projectRoot, lisaRoot] = await Promise.all([
    realpath(path.resolve(projectPath)),
    realpath(lisaPath),
  ]);
  if (!(await lstat(projectRoot)).isDirectory()) {
    throw new Error("Health project root is not a directory");
  }
  return { projectRoot, lisaRoot };
}

/**
 * Create the fixed-order probe registry from safely captured setup state.
 * @param roots
 * @param roots.projectRoot
 * @param roots.lisaRoot
 * @param configState
 * @param shape
 * @param deadline
 * @param options
 */
// eslint-disable-next-line max-lines-per-function -- fixed-order registry keeps the complete contract auditable
function probes(
  roots: { readonly projectRoot: string; readonly lisaRoot: string },
  configState: HealthConfigState,
  shape: HealthProjectShape | undefined,
  deadline: HealthDeadline,
  options: DeterministicHealthOptions
): readonly Probe[] {
  const safeShape: HealthProjectShape = shape ?? {
    types: [],
    packageJson: undefined,
  };
  const sync = runConfigSync(roots.projectRoot, {
    dryRun: true,
    reads: safeSyncReads(roots.projectRoot),
  });
  return [
    {
      ...CHECKS[0]!,
      run: () => projectStateFinding(roots.projectRoot, configState, shape),
    },
    { ...CHECKS[1]!, run: () => wikiFinding(roots.projectRoot) },
    { ...CHECKS[2]!, run: async () => starterFinding() },
    { ...CHECKS[3]!, run: async () => (await configFindings(await sync))[0] },
    { ...CHECKS[4]!, run: async () => (await configFindings(await sync))[1] },
    {
      ...CHECKS[5]!,
      run: () =>
        managedTemplateFinding(
          roots.lisaRoot,
          roots.projectRoot,
          safeShape,
          configState.config
        ),
    },
    {
      ...CHECKS[6]!,
      run: () => packageFinding(roots.lisaRoot, roots.projectRoot, safeShape),
    },
    { ...CHECKS[7]!, run: () => instructionFinding(roots.projectRoot) },
    {
      ...CHECKS[8]!,
      run: () =>
        hookFinding(
          roots.lisaRoot,
          roots.projectRoot,
          safeShape.types,
          configState.config,
          options.readHooksPath ?? readCoreHooksPath,
          deadline.remainingMs(),
          deadline.signal
        ),
    },
    {
      ...CHECKS[9]!,
      run: () =>
        pluginFinding(
          roots.projectRoot,
          configState.config,
          safeShape.types,
          options.readInstalledPlugins ?? readInstalledClaudePlugins,
          deadline.remainingMs(),
          deadline.signal
        ),
    },
    {
      ...CHECKS[10]!,
      run: () =>
        workflowFinding(
          roots.lisaRoot,
          roots.projectRoot,
          safeShape.types,
          configState.config
        ),
    },
    {
      ...CHECKS[11]!,
      run: () =>
        rulesetFinding(
          roots.lisaRoot,
          roots.projectRoot,
          safeShape.types,
          configState.config,
          options.readRulesets ?? readGithubRulesets,
          deadline.remainingMs(),
          deadline.signal
        ),
    },
  ];
}

/**
 * Collect deterministic Health v1 without persistence, repair, installation,
 * update checks, process-exit mutation, or model calls.
 * @param projectPath - Host project root
 * @param options - Injectable roots, deadline, clock, and bounded readers
 * @returns Validated immutable deterministic HealthResult
 */
export async function runDeterministicHealth(
  projectPath: string,
  options: DeterministicHealthOptions = {}
): Promise<HealthResult> {
  const now = options.now ?? (() => new Date());
  const started = now();
  const deadline = new HealthDeadline(
    options.deadlineMs ?? DEFAULT_DEADLINE_MS
  );
  try {
    const lisaPath =
      options.lisaRoot ??
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const roots = await deadline.run(
      () => resolveRoots(projectPath, lisaPath),
      undefined
    );
    if (roots === undefined) {
      return result(
        started,
        now(),
        CHECKS.map(spec => unavailableFinding(spec.check, spec.unavailable))
      );
    }
    const [configState, shape] = await Promise.all([
      deadline.run(() => loadConfigState(roots.projectRoot), {
        config: {},
        present: false,
        readable: false,
      }),
      deadline.run(
        () => detectHealthProjectShape(roots.projectRoot),
        undefined
      ),
    ]);
    const findings = await Promise.all(
      probes(roots, configState, shape, deadline, options).map(probe =>
        deadline.run(
          probe.run,
          unavailableFinding(probe.check, probe.unavailable)
        )
      )
    );
    return result(started, now(), findings);
  } finally {
    deadline.close();
  }
}

export { readGithubRulesets };
export type { RulesetReader };
/* eslint-enable jsdoc/require-param-description, jsdoc/require-returns -- restore repository documentation defaults */
