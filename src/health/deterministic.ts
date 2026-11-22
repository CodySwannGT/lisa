/** Side-effect-free deterministic Health v1 collection. */
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  summarizeHealthFindings,
  type HealthFinding,
  type HealthResult,
  type HealthStatus,
  validateHealthResult,
} from "./contract.js";
import { HealthDeadline } from "./deadline.js";
import { loadConfigState } from "./deterministic-inputs.js";
import {
  CHECKS,
  type DeterministicHealthOptions,
  probes,
} from "./deterministic-probes.js";
import { deterministicFinding } from "./finding-utils.js";
import {
  readGithubRulesets,
  type RulesetReader,
} from "./ruleset-inspection.js";
import { detectHealthProjectShape } from "./template-inspection.js";

const DEFAULT_DEADLINE_MS = 110_000;

/**
 * Stable fallback when a check cannot complete inside the shared deadline.
 * @param check - Stable check identifier
 * @param status - Status the check reports when it cannot be observed
 * @returns The unavailable finding for that check
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
 * Build a validated immutable HealthResult from ordered findings.
 * @param started - When collection started
 * @param completed - When collection finished; clamped to never precede start
 * @param findings - Findings in fixed registry order
 * @returns The validated deterministic result
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
 * @param projectPath - Host project path as supplied
 * @param lisaPath - Lisa package root as supplied
 * @returns Both roots with symlinks resolved
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
export type { DeterministicHealthOptions, RulesetReader };
