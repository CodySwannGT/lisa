/**
 * `lisa learnings-overflow` — inspect and drain captures the ledger had no
 * budget to accept (CodySwannGT/lisa#1996).
 *
 * This is the gardener's drain handle. The audit skill is forbidden from
 * hand-parsing or hand-editing any learnings surface, so the only way to give it
 * the contract's containment checks, cross-process lock, and atomic write is to
 * ship them behind a command — exactly as `check-learnings-budget` ships the
 * budget gate and `merge-learnings` ships the union driver.
 *
 * Output is JSON because the consumer is an agent, not a human reading a
 * terminal: the gardener reads the pending entries, files one ticket per entry,
 * and only then drains the ids it durably re-homed. Drain is therefore BY ID and
 * never "empty it" — a run whose ticket filing fails part-way leaves every
 * unfiled capture exactly where it was, and is safely resumable.
 * @module cli/learnings-overflow-cmd
 */
import {
  drainLearningsOverflow,
  readLearningsOverflow,
} from "../core/learnings-overflow.js";

/** Command-line options for {@link runLearningsOverflow}. */
export interface LearningsOverflowOptions {
  /** Entry ids to remove once they have a durable home elsewhere. */
  readonly drain?: readonly string[];
}

/** Injectable collaborators for {@link runLearningsOverflow}. */
export interface LearningsOverflowDependencies {
  /** Working directory used to resolve the project config (defaults to cwd). */
  readonly cwd?: string;
  /** Sink for the JSON payload (defaults to stdout). */
  readonly log?: (message: string) => void;
  /** Sink for the failure diagnostic (defaults to stderr). */
  readonly error?: (message: string) => void;
}

/**
 * Read or drain the overflow and print the outcome as JSON.
 *
 * A malformed or unsafe overflow is a real failure and exits non-zero: unlike a
 * missing file (which is the ordinary case and reads as empty), a document the
 * contract refuses to parse must not be reported as "nothing to drain" — that
 * would present a corrupted buffer as a healthy one.
 * @param options - Parsed command-line options
 * @param dependencies - Injectable collaborators for tests
 * @returns Process exit code
 */
export async function runLearningsOverflow(
  options: LearningsOverflowOptions,
  dependencies: LearningsOverflowDependencies = {}
): Promise<number> {
  const cwd = dependencies.cwd ?? process.cwd();
  const log = dependencies.log ?? ((message: string) => console.log(message));
  const error =
    dependencies.error ?? ((message: string) => console.error(message));
  try {
    log(JSON.stringify(await resolvePayload(cwd, options.drain), null, 2));
    return 0;
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    error(`learnings-overflow: ${detail}`);
    return 1;
  }
}

/**
 * Produce the read payload or the drain payload, depending on the request.
 * @param cwd - Project directory
 * @param drain - Entry ids to remove, when draining
 * @returns JSON-serializable outcome
 */
async function resolvePayload(
  cwd: string,
  drain: readonly string[] | undefined
): Promise<unknown> {
  if (drain === undefined || drain.length === 0) {
    const { file, entries } = await readLearningsOverflow(cwd);
    return { file, pending: entries.length, entries };
  }
  return drainLearningsOverflow(cwd, drain);
}
