/**
 * Measurement-only Stryker reporter for CodySwannGT/lisa#3304.
 *
 * It deliberately observes lifecycle boundaries only. In particular it does
 * not implement `onMutantTested`, so enabling it cannot add I/O to Stryker's
 * per-mutant hot path. Evidence is retained in memory and committed atomically
 * once, during wrap-up.
 * @module scripts/lib/mutation-performance-reporter
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";

import {
  commonTokens,
  declareClassPlugin,
  PluginKind,
  tokens,
} from "@stryker-mutator/api/plugin";

const defaultNow = () => new Date().toISOString();

const testLocation = test => {
  const position = test.startPosition ?? test.location ?? {};
  const line = position.line ?? position.start?.line ?? 0;
  const column = position.column ?? position.start?.column ?? 0;
  return `${line}:${column}`;
};

const canonicalTest = test => ({
  file: String(test.fileName ?? test.file ?? ""),
  name: String(test.name ?? test.description ?? test.id ?? ""),
  location: testLocation(test),
});

/** Lifecycle-only reporter consumed through Stryker's reporter plugin API. */
export class LisaMeasurementReporter {
  static inject = tokens(commonTokens.options);

  #outputFile;
  #now;
  #startedAt;
  #dryRun = null;
  #planCount = null;
  #planAt = null;
  #reportReadyAt = null;
  #written = false;

  /**
   * @param {object} options Stryker options or a focused-test configuration
   */
  constructor(options = {}) {
    this.#outputFile =
      options.outputFile ??
      process.env.LISA_MUTATION_PHASE_EVENTS ??
      path.resolve(
        path.dirname(
          options.jsonReporter?.fileName ?? "reports/stryker-report.json"
        ),
        "phase-events.json"
      );
    this.#now = options.now ?? defaultNow;
    this.#startedAt = this.#now();
  }

  /** Retain exact dry-run timing and test identity in memory. */
  onDryRunCompleted(event) {
    const result = event.result ?? event;
    const timing = event.timing ?? result.timing ?? { net: 0, overhead: 0 };
    this.#dryRun = {
      at: this.#now(),
      net_ms: Number(timing.net),
      overhead_ms: Number(timing.overhead),
      tests: (result.tests ?? event.tests ?? []).map(canonicalTest),
    };
  }

  /** Retain the planned mutant count, without per-mutant callbacks. */
  onMutationTestingPlanReady(event) {
    this.#planCount = (event.mutantPlans ?? event.mutants ?? []).length;
    this.#planAt = this.#now();
  }

  /** Compatibility with the focused fake lifecycle and final-report timing. */
  onMutationTestReportReady(report) {
    if (this.#planCount === null) {
      this.#planCount =
        report.mutants?.length ??
        Object.values(report.files ?? {}).reduce(
          (count, file) => count + (file.mutants?.length ?? 0),
          0
        );
    }
    if (this.#planAt === null) this.#planAt = this.#now();
    this.#reportReadyAt = this.#now();
  }

  /** Atomically write the one lifecycle artifact. */
  async wrapUp() {
    if (this.#written) {
      throw new Error("measurement reporter evidence was already written");
    }
    if (!this.#dryRun || this.#planCount === null || !this.#reportReadyAt) {
      throw new Error("measurement reporter lifecycle is incomplete");
    }
    this.#written = true;
    const evidence = {
      schema_version: "lisa.mutation-phase-events/v1",
      started_at: this.#startedAt,
      dry_run_at: this.#dryRun.at,
      dry_run_ms: this.#dryRun.net_ms + this.#dryRun.overhead_ms,
      dry_run_net_ms: this.#dryRun.net_ms,
      dry_run_overhead_ms: this.#dryRun.overhead_ms,
      tests: this.#dryRun.tests,
      plan_count: this.#planCount,
      plan_ready_at: this.#planAt,
      report_ready_at: this.#reportReadyAt,
      finished_at: this.#now(),
    };
    await mkdir(path.dirname(this.#outputFile), { recursive: true });
    const temporary = `${this.#outputFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, this.#outputFile);
  }
}

export const strykerPlugins = [
  declareClassPlugin(
    PluginKind.Reporter,
    "lisa-measurement",
    LisaMeasurementReporter
  ),
];
