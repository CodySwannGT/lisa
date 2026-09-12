#!/usr/bin/env node
/**
 * A project-owned surface for a SHORT-LIVED operational hazard, read at every
 * session and subagent start, whose entries expire on their own.
 *
 * ## The defect this exists against
 *
 * A broadcast cannot reach a session that starts after it, and the sessions
 * that missed it never knew there was something to miss. That is a detector
 * whose only failure mode is staying quiet, and the population a fan-out
 * structurally cannot reach is the same population most exposed: the lanes
 * that just started are the ones standing up fresh environments and colliding
 * on ports, saturating workers, and re-hitting a defect somebody diagnosed an
 * hour ago (CodySwannGT/lisa#3681).
 *
 * Measured on one machine in one hour: one session started 18 minutes after a
 * warning it needed, another 8 minutes after a different one, four more
 * appeared and vanished entirely. Worse, the hole is unmeasurable rather than
 * merely growing — two sessions enumerating peers at the same moment returned
 * DIFFERENT rosters, so "I checked the list" carries an unknown gap and a
 * fan-out audited against one session's view cannot be audited at all.
 *
 * The existing rule injector cannot take this content. It reads
 * `CLAUDE_PLUGIN_ROOT/rules/eager` — the plugin root, not the project — so a
 * project cannot register anything there without editing an installed plugin
 * that the next apply overwrites; and it `cat`s every file unconditionally, so
 * anything written there becomes permanent scripture. A hazard surface without
 * an expiry IS the permanent-scripture problem, and projects correctly refuse
 * to use one.
 *
 * ## Why the expiry is the whole mechanism, not a convenience
 *
 * The expiry is what separates a transient hazard from doctrine, and it is the
 * only reason this surface can be trusted with transient content: nobody has
 * to remember to remove anything. So `until` is REQUIRED by the writer, and a
 * past `until` stops the entry being injected with no human action.
 *
 * The shape is deliberately the threshold-ratchet exemption's
 * (CodySwannGT/lisa#3856) rather than a second scheme: record the condition in
 * a form something can evaluate, and never let an unevaluable condition lapse
 * quietly into the permissive answer. An entry naming no evaluable expiry —
 * hand-written, or written before `until` existed — still applies, and is
 * reported as `unchecked` every time it is read. An expiry that lapses into
 * "no longer shown" is worse than no expiry.
 *
 * ## The inverse, because a state change needs one
 *
 * A hazard also ends before its expiry, and a declaration nothing can void is
 * the defect CodySwannGT/lisa#3855 and #3852 closed twice. `--lift` appends a
 * void record naming what resolved it. Matching is time-ordered: a lift voids
 * only a declaration that PRE-DATES it, so a hazard re-declared after an
 * earlier lift is not born discharged — the unsafe direction that must not be
 * introduced.
 *
 * ## Two tiers, because they reach different audiences
 *
 *   - the repository ledger, `.lisa/HAZARDS.jsonl`, committed — reaches every
 *     future reader of this project and merges by union;
 *   - the machine ledger, `${LISA_STATE_HOME:-~/.lisa}/operational-hazards.jsonl`
 *     — reaches sibling sessions in OTHER worktrees on this machine NOW, which
 *     a committed file cannot do until it is merged and pulled. That is the
 *     tier the fleet case above actually needs.
 *
 * A declaration is written to both. Reads are the union.
 *
 * ## Which half of the reporting gap this closes
 *
 * `--session-start` reaches every session and subagent that starts AFTER the
 * declaration — the half a fan-out structurally cannot serve. `--hook` runs as
 * a PostToolUse hook and announces, on the next tool result, a hazard declared
 * or lifted SINCE this session started — which is the only thing that reaches
 * a session already running. Surfaces with no PostToolUse runtime get the
 * first half and `--list`.
 * @module operational-hazards
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Repository-relative path of the committed, durable ledger. */
export const REPO_LEDGER = path.join(".lisa", "HAZARDS.jsonl");
/** Filename of the machine-local ledger inside the Lisa state home. */
export const MACHINE_LEDGER = "operational-hazards.jsonl";

/** An entry with an expiry still in the future. */
export const LIVE = "live";
/** An entry naming no evaluable expiry: it still applies, and says so. */
export const UNCHECKED = "unchecked";
/** An entry whose expiry has passed. Inert, with no human action. */
export const EXPIRED = "expired";
/** An entry voided early by a `--lift` recorded after it was declared. */
export const LIFTED = "lifted";

/** How a day-only `until` is completed into the instant it stops applying. */
const END_OF_DAY = "T23:59:59.999Z";
/** Matches a bare calendar day. Both quantifiers are bounded. */
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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
 * Two `stat` calls is the entire cost of the common case, and `--hook` fires
 * on every tool call in every session, so anything expensive multiplies.
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
 * The instant an `until` value stops applying, or null when it names none.
 *
 * A bare `YYYY-MM-DD` is live THROUGH that day, which is what a person means
 * when they write one. Anything unparseable returns null and is therefore
 * treated as naming no condition — reported, never silently permissive.
 * @param {unknown} until The recorded expiry.
 * @returns {number | null} Epoch milliseconds, or null.
 */
export function expiryMs(until) {
  if (typeof until !== "string") return null;
  const trimmed = until.trim();
  if (trimmed === "") return null;
  const completed = DAY_ONLY.test(trimmed)
    ? `${trimmed}${END_OF_DAY}`
    : trimmed;
  const parsed = Date.parse(completed);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Parse one ledger file into declarations and lifts, reporting bad lines.
 *
 * A record carrying `lift: true` is a void record rather than a hazard, so the
 * two travel in one append-only file and merge by the same union driver.
 * @param {string} file Absolute ledger path.
 * @returns {{ entries: object[], lifts: object[], malformed: string[] }} Parsed lines.
 */
export function parseLedger(file) {
  const entries = [];
  const lifts = [];
  const malformed = [];
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return { entries, lifts, malformed };
  }
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const record = tryParse(line);
    if (record === null) malformed.push(line);
    else if (record.lift === true) lifts.push(record);
    else entries.push(record);
  }
  return { entries, lifts, malformed };
}

/**
 * Parse one ledger line, requiring the identity every reader keys on.
 * @param {string} line A single ledger line.
 * @returns {object | null} The record, or null when it is unusable.
 */
function tryParse(line) {
  try {
    const record = JSON.parse(line);
    const usable = typeof record?.id === "string" && record.id !== "";
    return usable ? record : null;
  } catch {
    return null;
  }
}

/**
 * When a record was written, or zero when it says nothing evaluable.
 * @param {object} record A declaration or a lift.
 * @param {string} field The timestamp field to read.
 * @returns {number} Epoch milliseconds, or zero.
 */
export function stampMs(record, field) {
  const parsed = Date.parse(String(record?.[field] ?? ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The union of both ledger tiers, de-duplicated by id.
 *
 * The NEWEST declaration for an id wins, not the first one read. Both tiers
 * are append-only and a re-declaration is an append, so first-wins would pin
 * an id to the oldest thing ever said about it — and a hazard re-declared
 * after an earlier lift would be born discharged, which is exactly the unsafe
 * direction CodySwannGT/lisa#3852 refuses.
 * @param {string} root Repository root.
 * @returns {{ entries: object[], lifts: object[], malformed: string[] }} Every record.
 */
export function readLedgers(root) {
  const byId = new Map();
  const lifts = [];
  const malformed = [];
  for (const file of ledgerPaths(root)) {
    const parsed = parseLedger(file);
    for (const entry of parsed.entries) {
      const held = byId.get(entry.id);
      const newer =
        held === undefined ||
        stampMs(entry, "declaredAt") >= stampMs(held, "declaredAt");
      if (newer) byId.set(entry.id, entry);
    }
    lifts.push(...parsed.lifts);
    malformed.push(...parsed.malformed);
  }
  return { entries: [...byId.values()], lifts, malformed };
}

/**
 * Whether a lift voids this declaration.
 *
 * Time-ordered on purpose: a lift discharges only a declaration that pre-dates
 * it. Re-declaring a hazard after an earlier lift must not be born discharged
 * — the sibling refusal CodySwannGT/lisa#3852 records for the human gate.
 * @param {object} entry A hazard declaration.
 * @param {readonly object[]} lifts Every void record.
 * @returns {boolean} Whether the entry has been lifted.
 */
export function isLifted(entry, lifts) {
  const declared = stampMs(entry, "declaredAt");
  return lifts.some(
    lift => lift.id === entry.id && stampMs(lift, "liftedAt") >= declared
  );
}

/**
 * Classify one declaration at a moment in time.
 * @param {object} entry A hazard declaration.
 * @param {readonly object[]} lifts Every void record.
 * @param {number} now Epoch milliseconds.
 * @returns {string} One of LIVE, UNCHECKED, EXPIRED or LIFTED.
 */
export function classify(entry, lifts, now) {
  if (isLifted(entry, lifts)) return LIFTED;
  const expiry = expiryMs(entry.until);
  if (expiry === null) return UNCHECKED;
  return expiry < now ? EXPIRED : LIVE;
}

/**
 * Split the ledger union into the four states a reader cares about.
 * @param {string} root Repository root.
 * @param {number} now Epoch milliseconds.
 * @returns {{ live: object[], unchecked: object[], expired: object[], lifted: object[], malformed: string[] }} Partitioned records.
 */
export function partition(root, now) {
  const { entries, lifts, malformed } = readLedgers(root);
  const buckets = { live: [], unchecked: [], expired: [], lifted: [] };
  for (const entry of entries) buckets[classify(entry, lifts, now)].push(entry);
  return { ...buckets, malformed };
}

/**
 * Render one declaration as the lines a reader can act on.
 * @param {object} entry A hazard declaration.
 * @param {string} state The classification from `classify`.
 * @returns {string} A bullet block.
 */
export function formatEntry(entry, state) {
  const head =
    state === UNCHECKED
      ? `- ${entry.id} — NO EVALUABLE EXPIRY, so it still applies (${UNCHECKED})`
      : `- ${entry.id} — live through ${entry.until}`;
  return [
    head,
    `  hazard: ${entry.hazard ?? "(not recorded)"}`,
    `  instead: ${entry.avoid ?? "(not recorded)"}`,
    `  declared: ${entry.declaredAt ?? "(undated)"}`,
  ].join("\n");
}

/**
 * Render live and unchecked hazards as an injectable notice.
 *
 * Expired and lifted entries are absent by construction — that is the point of
 * the surface, and the property the expiry test asserts.
 * @param {readonly object[]} live Entries with a future expiry.
 * @param {readonly object[]} unchecked Entries naming no evaluable expiry.
 * @param {string} headline The opening line.
 * @returns {string} Notice text, empty when there is nothing to say.
 */
export function formatNotice(live, unchecked, headline) {
  if (live.length + unchecked.length === 0) return "";
  return [
    headline,
    "",
    ...live.map(entry => formatEntry(entry, LIVE)),
    ...unchecked.map(entry => formatEntry(entry, UNCHECKED)),
    "",
    "These are transient conditions on this machine or branch, not doctrine. Each one",
    "stops being shown when its expiry passes, with nobody remembering to remove it.",
    "If you resolve one, record that so every other session stops paying for it:",
    `  node "$CLAUDE_PLUGIN_ROOT/hooks/operational-hazards.mjs" --lift <id> --because "<what resolved it>"`,
  ].join("\n");
}

/**
 * Where this session's delivery mark lives.
 * @param {string} sessionId The harness-supplied session id.
 * @returns {string} An absolute file path.
 */
export function markPath(sessionId) {
  return path.join(
    stateHome(),
    "hazard-marks",
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
 * SessionStart / SubagentStart: deliver every applying hazard and record what
 * this session was born knowing.
 *
 * This is the half a fan-out structurally cannot serve — a session that starts
 * 18 minutes after the warning reads it here.
 * @param {string} raw Raw stdin.
 * @param {string} root Repository root.
 * @param {number} now Epoch milliseconds.
 * @returns {number} An exit code.
 */
export function runSessionStart(raw, root, now) {
  const sessionId = sessionIdOf(raw);
  if (sessionId === "") return 0;
  const { live, unchecked } = partition(root, now);
  const applying = [...live, ...unchecked];
  writeJson(markPath(sessionId), {
    delivered: applying.map(entry => entry.id),
    fingerprint: fingerprint(ledgerPaths(root)),
  });
  return emit(
    "SessionStart",
    formatNotice(
      live,
      unchecked,
      `Lisa: ${applying.length} short-lived operational hazard(s) apply to this project right now.`
    )
  );
}

/**
 * PostToolUse: announce what changed AFTER this session started.
 *
 * Two directions, because both were measured. A hazard declared while this
 * session runs is the collision it is about to cause; a LIFT of a hazard this
 * session was told about is the hold it is still paying for after everyone
 * else stopped — the provenance of CodySwannGT/lisa#3681 is a session sent a
 * lift for a hold it had never received.
 * @param {string} raw Raw stdin.
 * @param {string} root Repository root.
 * @param {number} now Epoch milliseconds.
 * @returns {number} An exit code.
 */
export function runHook(raw, root, now) {
  const sessionId = sessionIdOf(raw);
  if (sessionId === "") return 0;
  const mark = readMark(markPath(sessionId));
  if (mark === null) return 0;
  const current = fingerprint(ledgerPaths(root));
  if (current === mark.fingerprint) return 0;
  const { live, unchecked } = partition(root, now);
  const applying = [...live, ...unchecked];
  const known = new Set(mark.delivered);
  const applyingIds = new Set(applying.map(entry => entry.id));
  const dropped = [...known].filter(id => !applyingIds.has(id));
  writeJson(markPath(sessionId), {
    delivered: applying.map(entry => entry.id),
    fingerprint: current,
  });
  const fresh = applying.filter(entry => !known.has(entry.id));
  return emit("PostToolUse", changeNotice(fresh, dropped));
}

/**
 * Read a session mark, treating any unreadable mark as absent.
 *
 * A missing mark is deliberately silent: a session whose starting knowledge is
 * unknown would otherwise be told every historical hazard, which degrades the
 * mechanism into distrusting everything.
 * @param {string} file Absolute mark path.
 * @returns {{ delivered: string[], fingerprint: string } | null} The mark.
 */
export function readMark(file) {
  try {
    const mark = JSON.parse(fs.readFileSync(file, "utf-8"));
    return {
      delivered: Array.isArray(mark?.delivered) ? mark.delivered : [],
      fingerprint: String(mark?.fingerprint ?? ""),
    };
  } catch {
    return null;
  }
}

/**
 * Render the mid-session change notice for a running session.
 * @param {readonly object[]} fresh Hazards that began applying since the mark.
 * @param {readonly string[]} dropped Ids that stopped applying since the mark.
 * @returns {string} Notice text, empty when nothing changed.
 */
export function changeNotice(fresh, dropped) {
  const parts = [];
  if (fresh.length > 0)
    parts.push(
      formatNotice(
        fresh.filter(entry => expiryMs(entry.until) !== null),
        fresh.filter(entry => expiryMs(entry.until) === null),
        "Lisa: an operational hazard was declared AFTER this session started."
      )
    );
  if (dropped.length > 0)
    parts.push(
      [
        "Lisa: an operational hazard you were told about no longer applies —",
        "it was lifted or its expiry passed. Stop working around it.",
        "",
        ...dropped.map(id => `- ${id}`),
      ].join("\n")
    );
  return parts.join("\n\n");
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
 * Build the record `--declare` appends, refusing anything a reader cannot use.
 *
 * `--until` is required and there is no default. A hazard surface whose entries
 * do not expire becomes permanent scripture, which is the failure this exists
 * against — so the writer cannot produce one, and the reader still tolerates a
 * hand-written entry that names no expiry by reporting it rather than dropping
 * it.
 * @param {readonly string[]} argv Arguments.
 * @param {string} now ISO-8601 timestamp.
 * @returns {{ record?: object, error?: string }} The record, or why not.
 */
export function buildDeclaration(argv, now) {
  const id = flagValue(argv, "--declare");
  const hazard = flagValue(argv, "--hazard");
  const avoid = flagValue(argv, "--avoid");
  const until = flagValue(argv, "--until");
  if (id === "") return { error: "--declare needs an id" };
  if (hazard === "")
    return { error: "--hazard is required: say what will go wrong" };
  if (avoid === "")
    return {
      error:
        "--avoid is required: a hazard nobody can act on reaches them without reaching them",
    };
  if (until === "")
    return {
      error:
        "--until is required: an entry that never expires is doctrine, and doctrine belongs in a rule",
    };
  if (expiryMs(until) === null)
    return { error: `--until ${until} is not a date or ISO-8601 timestamp` };
  return { record: { id, declaredAt: now, until, hazard, avoid } };
}

/**
 * Append one record to both ledger tiers.
 * @param {object} record The record to append.
 * @param {string} root Repository root.
 * @returns {void}
 */
export function appendBothTiers(record, root) {
  const line = `${JSON.stringify(record)}\n`;
  for (const file of ledgerPaths(root)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line);
  }
}

/**
 * `--declare`: record a hazard in both tiers. One command, by design.
 * @param {readonly string[]} argv Arguments.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function runDeclare(argv, root) {
  const built = buildDeclaration(argv, new Date().toISOString());
  if (built.error !== undefined) {
    process.stderr.write(`operational-hazards: ${built.error}\n`);
    return 2;
  }
  appendBothTiers(built.record, root);
  process.stdout.write(
    `operational-hazards: ${built.record.id} applies through ${built.record.until}\n`
  );
  return 0;
}

/**
 * `--lift`: void a hazard before its expiry. The executable inverse.
 * @param {readonly string[]} argv Arguments.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function runLift(argv, root) {
  const id = flagValue(argv, "--lift");
  const because = flagValue(argv, "--because");
  if (because === "") {
    process.stderr.write(
      "operational-hazards: --because is required: say what resolved it\n"
    );
    return 2;
  }
  appendBothTiers(
    { id, lift: true, liftedAt: new Date().toISOString(), because },
    root
  );
  process.stdout.write(`operational-hazards: lifted ${id}\n`);
  return 0;
}

/**
 * `--list`: the surface for harnesses with no hook runtime, and for anyone
 * asking what is currently in force.
 * @param {string} root Repository root.
 * @param {number} now Epoch milliseconds.
 * @returns {number} An exit code.
 */
export function runList(root, now) {
  const { live, unchecked, expired, lifted } = partition(root, now);
  const notice = formatNotice(
    live,
    unchecked,
    `operational-hazards: ${live.length + unchecked.length} applying`
  );
  const tail = `operational-hazards: ${expired.length} expired, ${lifted.length} lifted (both inert)`;
  process.stdout.write(notice === "" ? `${tail}\n` : `${notice}\n${tail}\n`);
  return 0;
}

/**
 * Every reason a ledger entry is unusable by a reader.
 * @param {object} entry A hazard declaration.
 * @returns {string[]} Problem descriptions.
 */
export function entryProblems(entry) {
  const problems = [];
  if (typeof entry.hazard !== "string" || entry.hazard === "")
    problems.push(`${entry.id}: no hazard recorded`);
  if (Number.isNaN(Date.parse(String(entry.declaredAt ?? ""))))
    problems.push(`${entry.id}: declaredAt is not an ISO-8601 timestamp`);
  if (entry.until !== undefined && expiryMs(entry.until) === null)
    problems.push(
      `${entry.id}: until "${entry.until}" names no evaluable expiry, so this entry can never stop applying on its own`
    );
  return problems;
}

/**
 * `--check`: refuse a ledger that would swallow a hazard, or hold one forever.
 *
 * The failure that matters is an `until` that LOOKS like an expiry and is not:
 * every signal reads healthy while the entry becomes permanent. Expired and
 * lifted entries are not failures — they are the mechanism working, and they
 * are only reported.
 * @param {string} root Repository root.
 * @param {number} now Epoch milliseconds.
 * @returns {number} An exit code.
 */
export function runCheck(root, now) {
  const { live, unchecked, expired, lifted, malformed } = partition(root, now);
  const problems = malformed.map(
    line => `unparseable ledger line: ${line.slice(0, 120)}`
  );
  for (const entry of [...live, ...unchecked, ...expired, ...lifted])
    problems.push(...entryProblems(entry));
  if (problems.length > 0) {
    process.stderr.write(`operational-hazards: ${problems.join("\n  ")}\n`);
    return 1;
  }
  process.stdout.write(
    `operational-hazards: ${live.length} live, ${unchecked.length} ${UNCHECKED}, ${expired.length} ${EXPIRED}, ${lifted.length} ${LIFTED}; ledger well-formed\n`
  );
  return 0;
}

/**
 * Dispatch on the requested mode.
 * @param {readonly string[]} argv Command-line arguments.
 * @param {string} raw Piped stdin, when the mode needs it.
 * @param {string} root Repository root.
 * @param {number} now Epoch milliseconds.
 * @returns {number} An exit code.
 */
export function main(argv, raw, root, now = Date.now()) {
  if (argv.includes("--session-start")) return runSessionStart(raw, root, now);
  if (argv.includes("--hook")) return runHook(raw, root, now);
  if (argv.includes("--declare")) return runDeclare(argv, root);
  if (argv.includes("--lift")) return runLift(argv, root);
  if (argv.includes("--list")) return runList(root, now);
  return runCheck(root, now);
}

/**
 * Whether this module is the process entry point.
 *
 * Both sides are realpath'd, because `import.meta.url` is the REAL path while
 * `argv[1]` is whatever the caller typed — they disagree through a git worktree
 * or any `/tmp` path on macOS, and for a CHECK that disagreement is a
 * fail-OPEN. The one implementation lives at `scripts/lib/invoked-as-script.mjs`;
 * this file cannot import it, being materialized into plugin payloads that have
 * no `./lib/`, the same accommodation `withdrawn-rulings.mjs` makes.
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
