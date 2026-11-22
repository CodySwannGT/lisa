/**
 * Shared fixtures for the `runHealth` agentic-layer suites
 * (`agentic*.test.ts`). Each suite owns its own `vi.mock` of the
 * deterministic layer and its own temporary project root; this module only
 * supplies the pure builders and constants they share.
 * @module tests/unit/health/agentic-fixtures
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  runHealth,
  type AgenticHealthEvaluation,
  type AgenticHealthEvaluator,
} from "../../../src/health/agentic.js";
import {
  summarizeHealthFindings,
  type HealthResult,
  validateHealthResult,
} from "../../../src/health/contract.js";

/**
 * Budget used by every case that is *not* about the deadline. It has to be far
 * larger than the work these cases do, because an expired deadline silently
 * changes the code path under test: `runHealth` degrades to the deterministic
 * result, which is indistinguishable from the behavior several of these cases
 * assert. A tight budget therefore turned any scheduling hiccup under parallel
 * load into a failure in whichever case the hiccup happened to land in
 * (CodySwannGT/lisa#2474). Only the abort case sets a short deadline, because
 * there the deadline is the behavior under test.
 */
export const GENEROUS_TIMEOUT_MS = 60_000;
/**
 * Work budget for the cases that guard against super-linear collection —
 * **CPU** milliseconds, not wall-clock ones.
 *
 * The predecessor was a 5,000ms wall-clock bound. It was not under-budgeted:
 * the cases it covered run in single-digit milliseconds and the abort case in
 * ~500ms, so it carried 10x-to-500x headroom. It still failed at **10,026ms**
 * inside a full-suite run of 639 files (CodySwannGT/lisa#2516) on a branch that
 * never touched `health/`, because wall time bills descheduling as if it were
 * work. Widening it further would have retired the guard's whole purpose while
 * leaving the starvation untouched, so the instrument changed instead of the
 * number. See `tests/helpers/cpu-budget.ts` for the measurements.
 *
 * Sizing, all four figures stated with their conditions on 18 cores:
 *
 * | condition | wall | CPU |
 * |---|---|---|
 * | isolated, load 4.6 | 1.4–1.9ms | 1.8–2.7ms |
 * | one full suite, load 12 | 3.9–5.9ms | 2.8–4.2ms |
 * | four concurrent full suites, load 28, 73 vitest processes | 3.4–37.9ms | 3.6–7.0ms |
 *
 * | eight concurrent full suites, load 54, 144 vitest processes | 386–3,593ms | 1.4–11.3ms |
 *
 * Wall inflated to **3,593ms** for operations that take 1.4ms quiet — a 2,000x
 * spread that was closing on the old 5,000ms bound. CPU over the identical runs
 * peaked at **11.3ms**, under 5x its quiet value. That is the whole argument in
 * two columns.
 *
 * 50ms is ~4.4x the worst CPU ever observed here and ~20x the quiet-box figure.
 * The margin is deliberately much tighter than a wall budget could ever be,
 * because CPU inflation is bounded where wall inflation is not, and a loose
 * budget has a real cost: a busy-poll cancellation regression measured at
 * 114ms of wasted CPU slipped clean under a 250ms first draft of this number.
 */
export const SUPERLINEAR_CPU_GUARD_MS = 50;
/** Start timestamp stamped on every fixture deterministic result. */
const STARTED_AT = "2026-07-20T12:00:00.000Z";
/** Completion timestamp of the fixture deterministic layer. */
export const DETERMINISTIC_COMPLETED_AT = "2026-07-20T12:01:00.000Z";
/** Completion timestamp the agentic layer observes once the evaluator resolves. */
export const AGENTIC_COMPLETED_AT = "2026-07-20T12:02:00.000Z";
/** The deterministic check identifier the first fixture finding carries. */
export const CONFIG_SYNC_CHECK = "config.sync";
/** Project config file name, relative to the project root. */
export const LISA_CONFIG_FILE = ".lisa.config.json";
/** Consumer-owned local ESLint config, relative to the project root. */
export const ESLINT_LOCAL_CONFIG_FILE = "eslint.config.local.ts";
/** Lisa-managed ESLint config, relative to the project root. */
export const ESLINT_MANAGED_CONFIG_FILE = "eslint.config.ts";
/** Generic agentic check identifier the hostile-output cases reuse. */
export const AGENTIC_TEST_CHECK = "agentic.test";
/** Agentic check identifier shared by the context-judgment cases. */
export const AGENTIC_CONTEXT_CHECK = "agentic.context";

/**
 * Build a validated deterministic result with a configurable number of
 * findings, all sharing one status.
 * @param count Number of deterministic findings to fabricate.
 * @param status Status every fabricated finding carries.
 * @returns A validated, deterministic-mode health result.
 */
export function deterministicResult(
  count = 1,
  status: "pass" | "fail" = "pass"
): HealthResult {
  const findings = Array.from({ length: count }, (_unused, index) => ({
    check: index === 0 ? CONFIG_SYNC_CHECK : `deterministic.check-${index}`,
    layer: "deterministic" as const,
    status,
    reason:
      status === "pass"
        ? "The deterministic check passed."
        : "The deterministic check found intentional drift.",
  }));
  return validateHealthResult({
    schemaVersion: 1,
    runId: "health-run-agentic-unit",
    mode: "deterministic",
    startedAt: STARTED_AT,
    completedAt: DETERMINISTIC_COMPLETED_AT,
    findings,
    summary: summarizeHealthFindings(findings),
  });
}

/**
 * Build a deterministic result reporting managed-template drift on the
 * Lisa-managed ESLint config.
 * @returns A validated deterministic result with one failing finding.
 */
export function managedEslintDriftResult(): HealthResult {
  const findings = [
    {
      check: "templates.managed",
      layer: "deterministic" as const,
      status: "fail" as const,
      reason: `Managed files do not match templates: ${ESLINT_MANAGED_CONFIG_FILE}`,
    },
  ];
  return validateHealthResult({
    schemaVersion: 1,
    runId: "health-run-managed-drift",
    mode: "deterministic",
    startedAt: STARTED_AT,
    completedAt: DETERMINISTIC_COMPLETED_AT,
    findings,
    summary: summarizeHealthFindings(findings),
  });
}

/**
 * Populate a project root with the config, ESLint, and workflow evidence the
 * agentic layer collects, including secrets that must never cross the
 * evaluator boundary.
 * @param projectRoot Absolute path of the temporary project root.
 * @returns Resolves once every fixture file is written.
 */
export async function writeFixture(projectRoot: string): Promise<void> {
  await mkdir(path.join(projectRoot, ".github", "workflows"), {
    recursive: true,
  });
  await writeFile(
    path.join(projectRoot, LISA_CONFIG_FILE),
    JSON.stringify({
      quality: { mutation: { gate: { enabled: false } } },
      privateToken: "config-secret-must-not-cross-boundary",
    })
  );
  await writeFile(
    path.join(projectRoot, ESLINT_LOCAL_CONFIG_FILE),
    "export default [{ rules: { noConsole: 'off' } }];\n"
  );
  await writeFile(
    path.join(projectRoot, "eslint.ignore.config.local.json"),
    '["generated/**"]\n'
  );
  await writeFile(
    path.join(projectRoot, ESLINT_MANAGED_CONFIG_FILE),
    "export default ['managed-content-must-stay-gated'];\n"
  );
  await writeFile(
    path.join(projectRoot, ".github", "workflows", "ci.yml"),
    [
      "name: private workflow name",
      "jobs:",
      "  quality:",
      "    uses: org/private-repository/.github/workflows/quality.yml@main",
      "    with:",
      "      # temporarily skipped because the vendor is down",
      "      # resume after vendor ticket VENDOR-42 closes",
      "      skip_jobs: 'lint'",
      "      # expires on 2026-07-21",
      "      verify_enforced: false",
      "      unrelated_secret: do-not-expose",
      "  release:",
      "    steps:",
      "      - run: echo private-command",
      "",
    ].join("\n")
  );
}

/**
 * An evaluator that resolves to arbitrary, possibly hostile output.
 *
 * The evaluator is consumer JavaScript, so nothing at runtime holds it to the
 * declared result type; these cases exist to prove the runtime validation that
 * stands in for it. The value is untyped input, asserted at this one boundary.
 * @param produce Builds the raw output the evaluator resolves to.
 * @returns An evaluator resolving to that output.
 */
export function hostileEvaluator(
  produce: () => unknown
): AgenticHealthEvaluator {
  return async () => (await produce()) as AgenticHealthEvaluation;
}

/**
 * Run health with agentic review enabled on a generous deadline and a fixed
 * completion clock.
 * @param projectRoot Absolute path of the temporary project root.
 * @param evaluator Optional evaluator; omitted means agentic review is unavailable.
 * @returns The composed (or degraded) health result.
 */
export async function collect(
  projectRoot: string,
  evaluator?: AgenticHealthEvaluator
): Promise<HealthResult> {
  return runHealth(projectRoot, {
    now: () => new Date(AGENTIC_COMPLETED_AT),
    agentic: {
      enabled: true,
      ...(evaluator === undefined ? {} : { evaluator }),
      timeoutMs: GENEROUS_TIMEOUT_MS,
    },
  });
}
