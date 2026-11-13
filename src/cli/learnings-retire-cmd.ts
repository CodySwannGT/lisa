/**
 * `lisa learnings-retire` — remove one fingerprint-stamped entry from the
 * project learnings ledger (CodySwannGT/lisa#4536), through the
 * fingerprint-guarded `retireLearningEntry` API (CodySwannGT/lisa#4530).
 *
 * This is the gardener's RETIRE handle. The audit skill is forbidden from
 * hand-parsing or hand-editing any learnings surface, so a RETIRE verdict needs
 * a command that carries the contract's containment checks, cross-process lock,
 * fingerprint guard, and atomic write — exactly as `learnings-overflow` ships
 * the drain. It also works on a ledger that is already over its cap, which is
 * the state a retire most often exists to repair.
 *
 * Output is JSON because the consumer is an agent. Only an applied retire exits
 * 0: a stale fingerprint or an unknown id writes nothing and exits 1, so a
 * script cannot mistake a refused retire for a completed one.
 * @module cli/learnings-retire-cmd
 */
import {
  retireLearningEntry,
  type RetireLearningResult,
} from "../core/learnings-retire.js";

/** Command-line options for {@link runLearningsRetire}. */
export interface LearningsRetireOptions {
  /** Stable id of the entry to retire. */
  readonly id: string;
  /** FULL fingerprint the caller observed at that id (never the marker hash). */
  readonly fingerprint: string;
  /** Human-readable proof, echoed into the JSON output only. */
  readonly reason: string;
}

/** Injectable collaborators for {@link runLearningsRetire}. */
export interface LearningsRetireDependencies {
  /** Working directory used to resolve the project config (defaults to cwd). */
  readonly cwd?: string;
  /** Sink for the JSON payload (defaults to stdout). */
  readonly log?: (message: string) => void;
  /** Sink for the failure diagnostic (defaults to stderr). */
  readonly error?: (message: string) => void;
}

/**
 * Retire one stamped entry and print the outcome as JSON.
 * @param options - Parsed command-line options
 * @param dependencies - Injectable collaborators for tests
 * @returns Process exit code: 0 only when the entry was retired
 */
export async function runLearningsRetire(
  options: LearningsRetireOptions,
  dependencies: LearningsRetireDependencies = {}
): Promise<number> {
  const cwd = dependencies.cwd ?? process.cwd();
  const log = dependencies.log ?? ((message: string) => console.log(message));
  const error =
    dependencies.error ?? ((message: string) => console.error(message));
  try {
    if (typeof options.reason !== "string" || options.reason.trim() === "") {
      throw new Error("Invalid --reason: expected a non-empty proof string");
    }
    const result = await retireLearningEntry(
      cwd,
      options.id,
      options.fingerprint
    );
    // The reason is the caller's proof record, not ledger content: it is
    // echoed for the deleting PR to cite and never written anywhere.
    log(JSON.stringify({ ...result, reason: options.reason }, null, 2));
    const refusal = describeRefusal(result);
    if (refusal === undefined) {
      return 0;
    }
    error(`learnings-retire: ${refusal}`);
    return 1;
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    error(`learnings-retire: ${detail}`);
    return 1;
  }
}

/**
 * Explain a no-write outcome in one line, or nothing for an applied retire.
 * @param result - Structured retire outcome
 * @returns Operator-readable refusal, or undefined when the entry was retired
 */
function describeRefusal(result: RetireLearningResult): string | undefined {
  if (result.status === "stale") {
    return `entry '${result.id}' is stale: expected fingerprint ${result.expectedFingerprint} but the ledger holds ${result.actualFingerprint}. Nothing was written; re-read the ledger and retry with the current fingerprint.`;
  }
  if (result.status === "not-found") {
    return `entry '${result.id}' not found in the project learnings ledger. Nothing was written.`;
  }
  return undefined;
}
