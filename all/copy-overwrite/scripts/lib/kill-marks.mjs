// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Remember that a run on this machine was killed, so a LATER failure can say so.
 *
 * ## The shape this exists for
 *
 * Three renderings of machine saturation announce themselves inside the run
 * that suffers them: a signal shows in the exit code, a timeout leaves the
 * streams empty, an OS resource refusal prints a syscall error. A fourth does
 * not announce itself at all, because the damage and the symptom are in
 * different runs (CodySwannGT/lisa#3653):
 *
 *     saturation kills a run -> its sandbox survives as debris ->
 *     the debris fails an UNRELATED test on a SUBSEQUENT run
 *
 * Measured: a `stryker` run terminated under load left a populated 42 MB
 * sandbox, and a basename-uniqueness scan failed on the next run with a clean,
 * specific, entirely plausible message about a duplicate file. Nothing in that
 * later run's output mentioned mutation, saturation, or the process that died
 * minutes earlier. No amount of per-run classification reaches it, because the
 * later run genuinely has no evidence — the evidence was in the earlier one.
 *
 * So the earlier run leaves a note.
 *
 * ## What this is NOT
 *
 * It is not a cause, and the reporting deliberately refuses to claim one. A
 * kill twenty minutes ago and a failure now are two facts; asserting the first
 * explains the second would replace one misattribution with another, and an
 * operator who learns to read "a run was killed" as "so ignore this failure"
 * is worse off than one who had no note at all. #3657 removes the debris; this
 * arm exists for the cases enumeration misses, and its whole job is to put a
 * fact in front of a reader who would otherwise never see it.
 *
 * It is also not the reclaimer. `lisa-mutation.mjs` reclaims run-scoped
 * sandboxes and deliberately leaves everything else alone so it cannot delete
 * a concurrent run's working directory. That fence stays where it is; a marker
 * read by a later run is the complementary arm, never a widening of what any
 * sweeper is willing to delete.
 * @module lib/kill-marks
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Where marks live.
 *
 * Under `os.tmpdir()`, which is per-user on the platforms this runs on, so
 * every checkout on the machine shares one view. A kill in one worktree is
 * exactly what a failure in another worktree needs to hear about — scoping
 * this per-checkout would hide the cross-checkout case that motivates it.
 * @returns {string} Absolute directory path.
 */
export const killMarkDir = () => join(tmpdir(), "lisa-kill-marks");

/**
 * How long a mark stays relevant.
 *
 * Sixty minutes. The observed failure landed on the very next run, minutes
 * later, so the window only has to outlive one run. Making it hours would
 * attach a lunchtime kill to an evening failure, which is how a context note
 * turns into background noise nobody reads.
 */
export const KILL_MARK_RETENTION_MS = 60 * 60 * 1000;

/** Cap on marks read or retained, so a pathological directory cannot stall a run. */
const MAX_MARKS = 256;

/**
 * Record that a run was terminated.
 *
 * Best-effort by construction: this is called on a path where something has
 * already gone wrong, and failing to write a note must never become a second
 * failure. Every error is swallowed and reported as "not recorded".
 * @param {object} mark What happened.
 * @param {string} mark.kind Diagnosis kind, e.g. `killed` or `resource-refused`.
 * @param {string} mark.gateId Gate whose command was terminated.
 * @param {object} [deps] Injectable seams for tests.
 * @param {string} [deps.dir] Mark directory.
 * @param {number} [deps.now] Epoch milliseconds.
 * @param {number} [deps.pid] Recording process id.
 * @returns {boolean} Whether a mark was written.
 */
export function recordKillMark({ kind, gateId }, deps = {}) {
  const { dir = killMarkDir(), now = Date.now(), pid = process.pid } = deps;
  try {
    mkdirSync(dir, { recursive: true });
    pruneKillMarks({ dir, now });
    // `randomBytes`, not `Math.random`: the suffix only has to make two marks
    // written in the same millisecond by the same pid distinct, but a shipped
    // file reaches every downstream project and the shipped ruleset refuses a
    // pseudorandom source on sight rather than judging each call site. Matching
    // what `scratch-owner` already does costs nothing here.
    const name = `${String(now)}-${String(pid)}-${randomBytes(4).toString("hex")}.json`;
    writeFileSync(
      join(dir, name),
      JSON.stringify({ schema: 1, kind, gateId, at: now, pid })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove marks older than the retention window.
 * @param {object} options Inputs.
 * @param {string} options.dir Mark directory.
 * @param {number} options.now Epoch milliseconds.
 * @returns {void}
 */
function pruneKillMarks({ dir, now }) {
  try {
    for (const name of readdirSync(dir).slice(0, MAX_MARKS)) {
      const at = Number(name.split("-")[0]);
      if (Number.isFinite(at) && now - at > KILL_MARK_RETENTION_MS) {
        rmSync(join(dir, name), { force: true });
      }
    }
  } catch {
    // Pruning is hygiene, not correctness. A directory that cannot be read
    // yields no marks below either, so the failure is already contained.
  }
}

/**
 * Marks left by EARLIER runs, inside the retention window, newest first.
 *
 * Read this BEFORE a run executes anything. A run that reads afterwards can
 * see the mark it wrote itself and report its own kill back to itself as
 * mysterious prior context — the note would be true, circular, and useless.
 * Process identity is deliberately irrelevant: one long-lived agent process
 * can invoke the gate runner more than once, and a mark from its earlier
 * invocation is still prior context. The runner prevents self-reporting by
 * taking this snapshot before it executes any gate.
 * @param {object} [deps] Injectable seams for tests.
 * @param {string} [deps.dir] Mark directory.
 * @param {number} [deps.now] Epoch milliseconds.
 * @returns {Array<{kind: string, gateId: string, at: number, pid: number}>} Marks.
 */
export function recentKillMarks(deps = {}) {
  const { dir = killMarkDir(), now = Date.now() } = deps;
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .slice(0, MAX_MARKS)
      .map(name => {
        try {
          return JSON.parse(readFileSync(join(dir, name), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(mark => mark !== null && mark.schema === 1)
      .filter(mark => Number.isFinite(mark.at))
      .filter(mark => mark.at <= now)
      .filter(mark => now - mark.at <= KILL_MARK_RETENTION_MS)
      .sort((left, right) => right.at - left.at);
  } catch {
    return [];
  }
}

/**
 * The one line a later failure gets, or nothing.
 *
 * Reads as CONTEXT and says so twice — once by naming what it is, once by
 * naming what it is not. The second half is the load-bearing half: a reader
 * who takes this as permission to dismiss the failure has been made worse off
 * than a reader who never saw it, so the sentence refuses the inference
 * explicitly rather than leaving it available.
 * @param {Array<{kind: string, at: number}>} marks From {@link recentKillMarks}.
 * @param {(at: number) => string} [format] Clock renderer, injectable for tests.
 * @returns {string[]} Zero or one line.
 */
export function killMarkNote(
  marks,
  format = at => new Date(at).toTimeString().slice(0, 5)
) {
  if (marks.length === 0) return [];
  const when = marks
    .slice(0, 3)
    .map(mark => `${mark.kind} at ${format(mark.at)}`)
    .join(", ");
  const more = marks.length > 3 ? ` (+${String(marks.length - 3)} more)` : "";
  return [
    `🕓 CONTEXT, not a cause: ${String(marks.length)} earlier run(s) on this ` +
      `machine were terminated in the last hour — ${when}${more}. This does ` +
      `NOT explain the result above and must not be read as excusing it. It ` +
      `is here because a terminated run can leave debris that fails an ` +
      `unrelated, later run, and nothing in that later failure's own output ` +
      `would ever mention it.`,
  ];
}
