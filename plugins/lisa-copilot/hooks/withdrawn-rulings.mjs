#!/usr/bin/env node
/**
 * Make a WITHDRAWN ruling reach a session that already read the old version.
 *
 * ## The defect this exists against
 *
 * A session is a snapshot and nothing reaches back into it. Rules are injected
 * once at SessionStart/SubagentStart by `inject-rules.sh`; the plugin version a
 * session executes is resolved once at startup; a fix merged to the default
 * branch is not in effect for anything already running. So guidance ADDED after
 * a session starts can at least be found on disk — CodySwannGT/lisa#3592 ships
 * the pointer that says re-read the instruction file at the escalation
 * boundary. Guidance WITHDRAWN after a session starts cannot be found at all:
 * the withdrawal is a reply in a conversation, and deleting the source file is
 * a push that reaches no existing reader (CodySwannGT/lisa#3752).
 *
 * Two instances in one working session: a refutation that was itself wrong,
 * published to a public comment and propagated to two agents before a third
 * agent disproved it; and a workaround circulated to three agents, then
 * disproved by measurement and withdrawn, with no way to tell the three.
 *
 * ## Why a re-read, and not a broadcast
 *
 * The audience is not enumerable. Whoever received the claim may have relayed
 * it onward, and a session that has gone quiet is unreachable by any message.
 * So this inverts the direction: the publisher records the withdrawal ONCE in a
 * durable place, and every live session re-checks that place on its own, from
 * disk, at a cadence no discipline has to remember.
 *
 * Two ledger tiers, because they reach different audiences:
 *
 *   - the repository ledger, `.lisa/WITHDRAWN.jsonl`, committed — reaches every
 *     future reader of this project, forever, and merges by union;
 *   - the machine ledger, `${LISA_STATE_HOME:-~/.lisa}/withdrawn-rulings.jsonl`
 *     — reaches sibling sessions in OTHER worktrees on this machine NOW, which
 *     a committed file cannot do until it is merged and pulled.
 *
 * A withdrawal is written to both. Reads are the union.
 *
 * ## How a running session is reached
 *
 * `--session-start` stamps a per-session mark recording the ids this session
 * was born already knowing. `--hook` runs as a PostToolUse hook on every tool
 * result and announces exactly the entries that appeared SINCE — once each.
 *
 * That is the discriminating case and it is the only one worth testing: a
 * session that read the ruling BEFORE the retraction existed. A session that
 * reads after the correction is satisfied by doing nothing.
 *
 * The cheap path is the common path. When neither ledger's `size:mtime` has
 * moved since the last announcement, `--hook` exits after two `stat` calls
 * without parsing anything — this fires on every tool call in every session, so
 * anything expensive multiplies.
 *
 * A missing mark is deliberately silent: a session with no mark is one whose
 * starting knowledge is unknown, and announcing every historical withdrawal to
 * it would degrade the mechanism into distrusting everything.
 *
 * ## Why the retraction path is one command
 *
 * Writing a finding is cheap and feels productive; writing a retraction is a
 * chore produced mid-task, after being corrected, when attention has moved on.
 * A rule of the form "always record retractions durably" is a discipline, and
 * this repository's own measurement is that prose rules land at roughly zero
 * adoption. `--withdraw` is therefore one command with three required fields,
 * and it refuses without the verbatim claim: a tombstone the holder of the
 * claim cannot recognise reaches them without reaching them.
 * @module withdrawn-rulings
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Repository-relative path of the committed, durable ledger. */
export const REPO_LEDGER = path.join(".lisa", "WITHDRAWN.jsonl");
/** Filename of the machine-local ledger inside the Lisa state home. */
export const MACHINE_LEDGER = "withdrawn-rulings.jsonl";
/** Most recent withdrawals replayed to a session at start. */
export const SESSION_START_LIMIT = 20;

/**
 * The machine-local state directory. Overridable so tests never touch `$HOME`.
 * @returns {string} An absolute directory path.
 */
export function stateHome() {
  return process.env.LISA_STATE_HOME || path.join(os.homedir(), ".lisa");
}

/**
 * The repository root, or the working directory when there is no repository.
 * @returns {string} An absolute directory path.
 */
export function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * Both ledger paths, repository tier first.
 * @param {string} root Repository root.
 * @returns {readonly string[]} Absolute ledger paths.
 */
export function ledgerPaths(root) {
  return [path.join(root, REPO_LEDGER), path.join(stateHome(), MACHINE_LEDGER)];
}

/**
 * A cheap identity for the ledger pair: size and mtime, no parsing.
 *
 * Two `stat` calls is the entire cost of the common case, where nothing has
 * been withdrawn since the last tool call.
 * @param {readonly string[]} paths Ledger paths.
 * @returns {string} A fingerprint that changes whenever either file changes.
 */
export function fingerprint(paths) {
  return paths
    .map(file => {
      try {
        const stat = fs.statSync(file);
        return `${stat.size}:${stat.mtimeMs}`;
      } catch {
        return "-";
      }
    })
    .join("|");
}

/**
 * Parse one ledger file into records, reporting lines that do not parse.
 * @param {string} file Absolute ledger path.
 * @returns {{ entries: object[], malformed: string[] }} Parsed and rejected lines.
 */
export function parseLedger(file) {
  const entries = [];
  const malformed = [];
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return { entries, malformed };
  }
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const record = JSON.parse(line);
      if (typeof record?.id === "string" && record.id !== "")
        entries.push(record);
      else malformed.push(line);
    } catch {
      malformed.push(line);
    }
  }
  return { entries, malformed };
}

/**
 * The union of both ledger tiers, de-duplicated by id, oldest first.
 * @param {string} root Repository root.
 * @returns {{ entries: object[], malformed: string[] }} Live withdrawals.
 */
export function readLedgers(root) {
  const byId = new Map();
  const malformed = [];
  for (const file of ledgerPaths(root)) {
    const parsed = parseLedger(file);
    for (const entry of parsed.entries)
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    malformed.push(...parsed.malformed);
  }
  return { entries: [...byId.values()], malformed };
}

/**
 * Where this session's delivery mark lives.
 * @param {string} sessionId The harness-supplied session id.
 * @returns {string} An absolute file path.
 */
export function markPath(sessionId) {
  return path.join(
    stateHome(),
    "withdrawal-marks",
    `${sessionId.replace(/[^\w.-]/g, "_")}.json`
  );
}

/**
 * Write a JSON file, creating parents.
 * @param {string} file Absolute path.
 * @param {object} value Serialisable value.
 * @returns {void}
 */
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}

/**
 * Render withdrawals as the notice a holder of the claim will recognise.
 * @param {readonly object[]} entries Withdrawn rulings.
 * @param {string} headline The opening line.
 * @returns {string} Notice text, empty when there is nothing to say.
 */
export function formatNotice(entries, headline) {
  if (entries.length === 0) return "";
  const body = entries.map(entry => {
    const lines = [
      `- ${entry.id} — withdrawn ${entry.withdrawnAt ?? "(undated)"}`,
      `  claim: ${entry.claim ?? "(not recorded)"}`,
      `  because: ${entry.because ?? "(not recorded)"}`,
    ];
    if (entry.supersededBy)
      lines.push(`  superseded by: ${entry.supersededBy}`);
    if (Array.isArray(entry.reached) && entry.reached.length > 0)
      lines.push(`  originally reached: ${entry.reached.join(", ")}`);
    return lines.join("\n");
  });
  return [
    headline,
    "",
    ...body,
    "",
    "Stop acting on those claims and do not propagate them. If you already relayed or",
    "recorded one, correct it on the same surface you put it on — a retraction must",
    "travel by the same mechanism as the finding.",
  ].join("\n");
}

/**
 * Emit a hook result on stdout, and the same text on stderr for humans.
 * @param {string} event The hook event name.
 * @param {string} notice Notice text.
 * @returns {number} An exit code.
 */
export function emit(event, notice) {
  if (notice === "") return 0;
  process.stderr.write(`${notice}\n`);
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: notice },
    })}\n`
  );
  return 0;
}

/**
 * Read the hook payload's session id.
 * @param {string} raw Raw stdin.
 * @returns {string} The session id, or the empty string.
 */
export function sessionIdOf(raw) {
  try {
    const payload = JSON.parse(raw);
    return typeof payload?.session_id === "string" ? payload.session_id : "";
  } catch {
    return "";
  }
}

/**
 * SessionStart / SubagentStart: stamp what this session is born knowing, and
 * replay the recent withdrawals so it does not act on a source it may still
 * find quoted elsewhere.
 * @param {string} raw Raw stdin.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function runSessionStart(raw, root) {
  const sessionId = sessionIdOf(raw);
  if (sessionId === "") return 0;
  const paths = ledgerPaths(root);
  const { entries } = readLedgers(root);
  writeJson(markPath(sessionId), {
    delivered: entries.map(entry => entry.id),
    fingerprint: fingerprint(paths),
  });
  const recent = entries.slice(-SESSION_START_LIMIT);
  return emit(
    "SessionStart",
    formatNotice(
      recent,
      `Lisa: ${entries.length} ruling(s) have been WITHDRAWN in this project.`
    )
  );
}

/**
 * PostToolUse: announce only what was withdrawn AFTER this session started.
 * @param {string} raw Raw stdin.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function runHook(raw, root) {
  const sessionId = sessionIdOf(raw);
  if (sessionId === "") return 0;
  const file = markPath(sessionId);
  let mark = null;
  try {
    mark = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return 0;
  }
  const current = fingerprint(ledgerPaths(root));
  if (current === mark.fingerprint) return 0;
  const { entries } = readLedgers(root);
  const delivered = new Set(
    Array.isArray(mark.delivered) ? mark.delivered : []
  );
  const fresh = entries.filter(entry => !delivered.has(entry.id));
  writeJson(file, {
    delivered: entries.map(entry => entry.id),
    fingerprint: current,
  });
  return emit(
    "PostToolUse",
    formatNotice(
      fresh,
      "Lisa: a ruling you may be holding has been WITHDRAWN since this session started."
    )
  );
}

/**
 * Read a `--flag value` pair out of argv.
 * @param {readonly string[]} argv Arguments.
 * @param {string} flag The flag, including dashes.
 * @returns {string} The value, or the empty string.
 */
export function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

/**
 * All values of a repeatable `--flag value` pair.
 * @param {readonly string[]} argv Arguments.
 * @param {string} flag The flag, including dashes.
 * @returns {string[]} Every value given for the flag.
 */
export function flagValues(argv, flag) {
  const values = [];
  argv.forEach((token, index) => {
    if (token === flag && index + 1 < argv.length) values.push(argv[index + 1]);
  });
  return values;
}

/**
 * Normalise the `--superseded-by` value: absent, empty and "none" all mean null.
 * @param {string} value The raw flag value.
 * @returns {string | null} A superseding id, or null.
 */
export function normalizeSuperseded(value) {
  const trimmed = value.trim();
  return trimmed === "" || trimmed.toLowerCase() === "none" ? null : trimmed;
}

/**
 * Build the record `--withdraw` appends, refusing an unrecognisable tombstone.
 * @param {readonly string[]} argv Arguments.
 * @param {string} now ISO-8601 timestamp.
 * @returns {{ record?: object, error?: string }} The record, or why not.
 */
export function buildWithdrawal(argv, now) {
  const id = flagValue(argv, "--withdraw");
  const claim = flagValue(argv, "--claim");
  const because = flagValue(argv, "--because");
  if (id === "") return { error: "--withdraw needs an id" };
  if (claim === "")
    return {
      error:
        "--claim is required: a tombstone the holder cannot recognise reaches nobody",
    };
  if (because === "")
    return { error: "--because is required: say what disproved it" };
  return {
    record: {
      id,
      withdrawnAt: now,
      claim,
      because,
      // "none" is what a person types when nothing replaced the claim, and a
      // string "none" in the record would print as a superseding id that does
      // not exist. Normalised here rather than at every reader.
      supersededBy: normalizeSuperseded(flagValue(argv, "--superseded-by")),
      reached: flagValues(argv, "--reached"),
    },
  };
}

/**
 * `--withdraw`: append the tombstone to both tiers. One command, by design.
 * @param {readonly string[]} argv Arguments.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function runWithdraw(argv, root) {
  const built = buildWithdrawal(argv, new Date().toISOString());
  if (built.error !== undefined) {
    process.stderr.write(`withdrawn-rulings: ${built.error}\n`);
    return 2;
  }
  const line = `${JSON.stringify(built.record)}\n`;
  for (const file of ledgerPaths(root)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line);
  }
  process.stdout.write(
    `withdrawn-rulings: recorded ${built.record.id} in both ledger tiers\n`
  );
  return 0;
}

/**
 * `--list`: the surface for harnesses with no PostToolUse hook, and for the
 * escalation boundary that CodySwannGT/lisa#3592 already sends agents to.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function runList(root) {
  const { entries } = readLedgers(root);
  if (entries.length === 0) {
    process.stdout.write("withdrawn-rulings: nothing withdrawn\n");
    return 0;
  }
  process.stdout.write(
    `${formatNotice(entries, `withdrawn-rulings: ${entries.length} withdrawn`)}\n`
  );
  return 0;
}

/**
 * `--check`: refuse a ledger that would swallow a withdrawal silently.
 *
 * A malformed line is the failure mode that matters: it drops a retraction
 * while every reader reports all-clear.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function runCheck(root) {
  const { entries, malformed } = readLedgers(root);
  const problems = malformed.map(
    line => `unparseable ledger line: ${line.slice(0, 120)}`
  );
  for (const entry of entries) {
    if (typeof entry.claim !== "string" || entry.claim === "")
      problems.push(`${entry.id}: no verbatim claim recorded`);
    if (
      typeof entry.withdrawnAt !== "string" ||
      Number.isNaN(Date.parse(entry.withdrawnAt))
    )
      problems.push(`${entry.id}: withdrawnAt is not an ISO-8601 timestamp`);
  }
  if (problems.length > 0) {
    process.stderr.write(`withdrawn-rulings: ${problems.join("\n  ")}\n`);
    return 1;
  }
  process.stdout.write(
    `withdrawn-rulings: ${entries.length} withdrawal(s), ledger well-formed\n`
  );
  return 0;
}

/**
 * Dispatch on the requested mode.
 * @param {readonly string[]} argv Command-line arguments.
 * @param {string} raw Piped stdin, when the mode needs it.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function main(argv, raw, root) {
  if (argv.includes("--session-start")) return runSessionStart(raw, root);
  if (argv.includes("--hook")) return runHook(raw, root);
  if (argv.includes("--withdraw")) return runWithdraw(argv, root);
  if (argv.includes("--list")) return runList(root);
  return runCheck(root);
}

/**
 * Whether this module is the process entry point.
 *
 * Both sides are realpath'd, because `import.meta.url` is the REAL path while
 * `argv[1]` is whatever the caller typed — they disagree through a git worktree
 * or any `/tmp` path on macOS, and for a CHECK that disagreement is a
 * fail-OPEN. The one implementation lives at `scripts/lib/invoked-as-script.mjs`;
 * this file cannot import it, being materialized into plugin payloads that have
 * no `./lib/`, the same accommodation `failure-signature-index.mjs` makes.
 * @param {string} moduleUrl The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/**
 * Read all of stdin.
 * @returns {Promise<string>} The piped text.
 */
export async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

if (invokedAsScript(import.meta.url)) {
  const argv = process.argv.slice(2);
  const needsStdin =
    argv.includes("--hook") || argv.includes("--session-start");
  const raw = needsStdin ? await readStdin() : "";
  process.exitCode = main(argv, raw, repoRoot());
}
