/**
 * Per-repo setup gaps in the ledger control block (CodySwannGT/lisa#4820).
 *
 * When `spawn` cannot start a worker in a repo for a reason only the
 * operator can fix (the worker's first prompt never ran, or the workspace is
 * not trusted), it exits 2. Without a record of that, the next cycle — or the
 * manager after its context was compacted — would claim and spawn the same
 * repo again, fail the same way, and message the operator every cycle. So the
 * gap is written to `control.setupGaps[<repo>]` (`.` for a single-repo
 * project): `queue` leaves that repo's items out and says why once, and
 * `spawn` refuses the repo without launching anything.
 *
 * Nothing clears a gap automatically: spawn refuses the repo while a gap is
 * recorded, so no successful spawn could ever clear it. The operator runs
 * `ledger clear-setup-gap <repo>` after fixing the repo.
 * @module session-manager/ledger-setup-gaps
 */
import { updateLedger } from "./ledger.mjs";

/** The single-repo project's key, as `spawn` records `repo`. */
export const ROOT_REPO = ".";

/**
 * One repo's recorded setup gap.
 * @typedef {object} SetupGap
 * @property {string} kind - unknown-command | prompt-blocked |
 *   untrusted-workspace
 * @property {string} detail - The command, the hook's words, or the repo dir
 * @property {string} at - When it was recorded (ISO)
 */

/**
 * The operator command that clears a repo's gap.
 * @param {string} repo - Repo key
 * @returns {string} Command, relative to the session-manager CLI
 */
export function clearCommand(repo) {
  return `ledger clear-setup-gap ${repo}`;
}

/**
 * The recorded gap for a repo, or null.
 * @param {{control: {setupGaps?: Record<string, SetupGap>}}} ledger - Ledger
 * @param {string} repo - Repo key
 * @returns {SetupGap | null} Gap
 */
export function setupGapOf(ledger, repo) {
  const gaps = ledger.control.setupGaps ?? {};
  return Object.hasOwn(gaps, repo) ? gaps[repo] : null;
}

/**
 * Every recorded gap as an operator-facing row, sorted by repo.
 * @param {{control: {setupGaps?: Record<string, SetupGap>}}} ledger - Ledger
 * @returns {Array<SetupGap & {repo: string, clear: string}>} Rows
 */
export function listSetupGaps(ledger) {
  return Object.entries(ledger.control.setupGaps ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([repo, gap]) => ({ repo, ...gap, clear: clearCommand(repo) }));
}

/**
 * The repo key whose gap blocks this queue item, or null.
 *
 * A single-repo project has one repo, so a gap on it blocks every item. On a
 * multi-repo project an item is blocked only by a gap on a repo its
 * `repo:<key>` label names; an unlabelled item is still offered, because its
 * repo is decided later and `spawn` refuses a gap repo anyway.
 * @param {{repoLabels?: string[]}} item - Normalized queue item
 * @param {Record<string, SetupGap>} gaps - `control.setupGaps`
 * @param {boolean} multiRepo - Whether `sessionManager.repos` is set
 * @returns {string | null} Blocking repo key
 */
export function blockingGapRepo(item, gaps, multiRepo) {
  const keys = Object.keys(gaps);
  if (!multiRepo) return keys.includes(ROOT_REPO) ? ROOT_REPO : null;
  const labels = new Set(item.repoLabels ?? []);
  return keys.find(key => labels.has(`repo:${key.toLowerCase()}`)) ?? null;
}

/**
 * What {@link recordSetupGap} did: `recorded` (a new gap), `already-recorded`
 * (the repo had one, kept unchanged so its `at` is when it was first seen),
 * or `stale` (the failing worker started before the operator's last clear,
 * so recording it would undo that clear).
 * @typedef {"recorded" | "already-recorded" | "stale"} SetupGapStatus
 */

/**
 * Whether a worker that started at `startedAt` predates the repo's last
 * clear. An unknown start time is never stale.
 * @param {{control: {setupGapsClearedAt?: Record<string, string>}}} ledger - Ledger
 * @param {string} repo - Repo key
 * @param {string | null | undefined} startedAt - Worker start (ISO)
 * @returns {boolean} True when the clear came after the worker started
 */
function predatesClear(ledger, repo, startedAt) {
  const cleared = ledger.control.setupGapsClearedAt ?? {};
  if (!startedAt || !Object.hasOwn(cleared, repo)) return false;
  return Date.parse(startedAt) < Date.parse(cleared[repo]);
}

/**
 * Remember that `repo` has a setup gap, in one read-transform-write. An
 * existing gap is kept as it is. With `startedAt` (a gap `classify` found in
 * a running worker's transcript), a worker that started before the repo's
 * last clear is ignored: its old transcript must not re-record a gap the
 * operator already fixed.
 * @param {string} projectRoot - Absolute project root
 * @param {{repo: string, kind: string, detail: string,
 *   startedAt?: string | null}} gap - What failed, and when the worker started
 * @param {import("./ledger.mjs").LedgerSeams} [seams] - Injected seams
 * @returns {Promise<{status: SetupGapStatus, gap: SetupGap | null}>} Outcome
 *   and the repo's gap afterwards
 */
export function recordSetupGap(
  projectRoot,
  { repo, kind, detail, startedAt },
  seams
) {
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const existing = setupGapOf(ledger, repo);
    if (existing !== null) {
      return { ledger, result: { status: "already-recorded", gap: existing } };
    }
    if (predatesClear(ledger, repo, startedAt)) {
      return { ledger, result: { status: "stale", gap: null } };
    }
    const entry = { kind, detail, at };
    const setupGaps = { ...ledger.control.setupGaps, [repo]: entry };
    return {
      ledger: { ...ledger, control: { ...ledger.control, setupGaps } },
      result: { status: "recorded", gap: entry },
    };
  });
}

/**
 * Forget a repo's setup gap, after the operator fixed the repo, and stamp
 * `control.setupGapsClearedAt[repo]` so a worker that started before the
 * clear cannot re-record it from its old transcript.
 * @param {string} projectRoot - Absolute project root
 * @param {{repo: string}} target - Repo key
 * @param {import("./ledger.mjs").LedgerSeams} [seams] - Injected seams
 * @returns {Promise<{repo: string, cleared: boolean}>} Whether one existed
 */
export function clearSetupGap(projectRoot, { repo }, seams) {
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const cleared = setupGapOf(ledger, repo) !== null;
    const { [repo]: _removed, ...setupGaps } = ledger.control.setupGaps ?? {};
    const setupGapsClearedAt = {
      ...ledger.control.setupGapsClearedAt,
      [repo]: at,
    };
    return {
      ledger: {
        ...ledger,
        control: { ...ledger.control, setupGaps, setupGapsClearedAt },
      },
      result: { repo, cleared },
    };
  });
}
