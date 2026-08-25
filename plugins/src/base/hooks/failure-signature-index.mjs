#!/usr/bin/env node
/**
 * Make a hazard reachable from its EFFECT, not only from its cause.
 *
 * ## The defect this exists against
 *
 * A hazard recorded in a comment beside the code that causes it is invisible to
 * the person who meets its effect. They search where it *surfaced*; the note
 * lives where it *originates*, in a different file owned by a different
 * concern. Knowing to open that file requires already knowing the cause, which
 * is the one thing they do not have. Measured on one hazard in this repository:
 * three independent discoveries, two of them already correctly documented, and
 * the third still cost a wrong hypothesis carried for hours plus instrumentation
 * written from scratch to measure what was already written down
 * (CodySwannGT/lisa#3054, CodySwannGT/lisa#3060, CodySwannGT/lisa#3061).
 *
 * A fourth sighting is the same shape one turn further on: the hazard was not
 * merely documented but GUARDED, and the guard was equally unreachable, so the
 * proposed remedy was a second control for a condition one control already
 * covered. Two checks for one condition, drifting apart, each making the other
 * look redundant — worse than the wasted diagnosis. Hence `guard` on an entry.
 *
 * ## Why an index and not more prose
 *
 * The natural fix — "search harder", or "record cross-cutting hazards
 * centrally" — is a retrieval strategy that requires already knowing the
 * answer, and this repository's own measurement is that prose rules land at
 * roughly zero adoption while executable controls land at 100%.
 *
 * So this stores no knowledge. Every entry is a **routing table row**: the text
 * a person actually sees, and a pointer to the record that already explains it.
 * The records are not moved, copied, or rewritten — they stay next to the cause,
 * where they are correct and useful to the reader who is already in that file.
 *
 * ## How it gets read
 *
 * By the person standing in the symptom, without them going to look:
 *
 *   1. `--hook` runs as a PostToolUse hook on every Bash result. When a
 *      command's output matches a signature, the notice arrives attached to the
 *      failure itself. Nobody has to know this file exists.
 *   2. `--match` accepts any transcript on stdin, so a gate runner or a person
 *      can ask the same question of any output.
 *
 * That is deliberately the whole reader set. An index with a browsing surface
 * is an index nobody reads.
 *
 * ## Why it cannot rot into a decoration
 *
 * `--check` refuses three ways, and each one is a way this could otherwise
 * report all-clear while indexing nothing:
 *
 *   - an entry whose cited record no longer contains its anchor — the pointer
 *     rotted, which is exactly what happened to the reference that named
 *     `src/cli/doctor-learnings-merge-driver.ts` before it was renamed;
 *   - an entry whose `signature` does not match its own recorded `sample` — a
 *     regex typo silently disables an entry, the same way a malformed ERE
 *     silently disabled a project safety rule in `parity-safety-net.sh`;
 *   - an index that resolves ZERO entries — an empty routing table is a broken
 *     one, never a clean one.
 *
 * ## What deliberately does NOT belong here
 *
 * A hazard with no machine-recognisable symptom. `grep` answering three ways so
 * a `printf | grep -q` guard permits a catastrophic delete
 * (CodySwannGT/lisa#3054, CodySwannGT/lisa#3188) has no signature at all — its
 * symptom is silence. There is nothing for this to match, and an entry
 * pretending otherwise would be a row that can never fire. Such hazards belong
 * on the learnings ladder as executable controls, not here.
 *
 * The ledger at `.lisa/PROJECT_LEARNINGS.md` is also not this. It is capped at
 * twenty entries and rotates by design; a routing table that evicts rows is a
 * routing table that stops routing.
 * @module failure-signature-index
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository-root filename holding the index. */
export const INDEX_FILENAME = "failure-signatures.json";

/**
 * Longest transcript tail examined, in bytes.
 *
 * Bounded because this parses arbitrary command output inside a hook on every
 * Bash call. The tail rather than the head: a build that fails after printing
 * ten megabytes of progress puts the sentence that matters last.
 */
const MAX_SCAN_BYTES = 512 * 1024;

/** Most entries reported for one output, so a match is a notice and not a wall. */
const MAX_REPORTED = 2;

/** Fields every entry must carry, with a non-empty string in each. */
const REQUIRED_TEXT_FIELDS = Object.freeze([
  "id",
  "symptom",
  "sample",
  "signature",
  "cause",
]);

/**
 * One row of the routing table.
 * @typedef {object} SignatureEntry
 * @property {string} id Stable slug naming the hazard.
 * @property {string} symptom One line: what the person actually sees.
 * @property {string} sample Verbatim excerpt of real output, which `signature`
 *   must match — the proof that the row can ever fire.
 * @property {string} signature `RegExp` source matched against command output.
 * @property {string} cause One line: what is really happening.
 * @property {readonly {file: string, anchor: string}[]} records Where the
 *   explanation already lives. Never moved here; only pointed at.
 * @property {{file: string, anchor: string, name: string}} [guard] The control
 *   that already covers this, when one exists, so nobody builds a second.
 */

/**
 * The repository root, falling back to the working directory outside git.
 * @param {string} [cwd] Directory to resolve from.
 * @returns {string} An absolute path.
 */
export function repoRoot(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

/**
 * Read and parse the index.
 * @param {string} root Repository root.
 * @returns {{entries: readonly SignatureEntry[], error: string|null}} The rows,
 *   or the reason there are none.
 */
export function loadIndex(root) {
  const file = path.join(root, INDEX_FILENAME);
  if (!fs.existsSync(file)) {
    return { entries: [], error: `${INDEX_FILENAME} does not exist` };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(entries)) {
      return { entries: [], error: `${INDEX_FILENAME} has no entries array` };
    }
    return { entries, error: null };
  } catch (cause) {
    return {
      entries: [],
      error: `${INDEX_FILENAME} is not valid JSON: ${cause}`,
    };
  }
}

/**
 * Compile an entry's signature.
 * @param {SignatureEntry} entry The row.
 * @returns {RegExp|null} The pattern, or null when it does not compile.
 */
function compile(entry) {
  try {
    return new RegExp(entry.signature);
  } catch {
    return null;
  }
}

/**
 * The 1-based line an anchor sits on.
 * @param {string} root Repository root.
 * @param {{file: string, anchor: string}} record The pointer.
 * @returns {number|null} The line, or null when the anchor is not present.
 */
export function anchorLine(root, record) {
  const file = path.join(root, record.file);
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const found = lines.findIndex(line => line.includes(record.anchor));
  return found === -1 ? null : found + 1;
}

/**
 * Every complaint one entry earns.
 * @param {SignatureEntry} entry The row.
 * @param {string} root Repository root.
 * @returns {string[]} Human-readable problems, empty when the row resolves.
 */
function entryProblems(entry, root) {
  const label = entry?.id ?? "<entry with no id>";
  const missing = REQUIRED_TEXT_FIELDS.filter(
    field => typeof entry?.[field] !== "string" || entry[field].length === 0
  ).map(field => `${label}: "${field}" is missing or empty`);
  const pattern = compile(entry ?? {});
  const patternProblems =
    pattern === null
      ? [`${label}: "signature" is not a valid regular expression`]
      : pattern.test(String(entry.sample ?? ""))
        ? []
        : [
            `${label}: "signature" does not match its own "sample", so this row can never fire`,
          ];
  const records = Array.isArray(entry?.records) ? entry.records : [];
  const recordProblems =
    records.length === 0
      ? [`${label}: has no "records", so it points at no existing explanation`]
      : records
          .filter(record => anchorLine(root, record) === null)
          .map(
            record =>
              `${label}: record ${record.file} no longer contains "${record.anchor}" — the pointer rotted`
          );
  const guardProblems =
    entry?.guard && anchorLine(root, entry.guard) === null
      ? [
          `${label}: guard ${entry.guard.file} no longer contains "${entry.guard.anchor}" — the pointer rotted`,
        ]
      : [];
  return [...missing, ...patternProblems, ...recordProblems, ...guardProblems];
}

/**
 * Check every row, and refuse an index that routes nothing.
 * @param {readonly SignatureEntry[]} entries The rows.
 * @param {string} root Repository root.
 * @returns {{problems: string[], resolved: number}} What is wrong, and how many
 *   rows survived.
 */
export function validateIndex(entries, root) {
  const duplicated = entries
    .map(entry => entry?.id)
    .filter((id, at, all) => all.indexOf(id) !== at)
    .map(id => `${id}: duplicate id`);
  const perEntry = entries.flatMap(entry => entryProblems(entry, root));
  const resolved = entries.filter(
    entry => entryProblems(entry, root).length === 0
  ).length;
  const empty =
    resolved === 0
      ? [
          `${INDEX_FILENAME} resolves ZERO entries — an index that indexes nothing is broken, not clean`,
        ]
      : [];
  return {
    problems: [...duplicated, ...perEntry, ...empty],
    resolved,
  };
}

/**
 * The rows whose signature appears in some output.
 * @param {string} text Command output.
 * @param {readonly SignatureEntry[]} entries The rows.
 * @returns {SignatureEntry[]} Matches, in index order, capped.
 */
export function matchEntries(text, entries) {
  const scanned =
    text.length > MAX_SCAN_BYTES ? text.slice(-MAX_SCAN_BYTES) : text;
  return entries
    .filter(entry => {
      const pattern = compile(entry);
      return pattern !== null && pattern.test(scanned);
    })
    .slice(0, MAX_REPORTED);
}

/**
 * The notice a matched row prints.
 *
 * Worded to stop a rediscovery rather than to start one: it names the cause
 * outright, cites the record with a line number so it is one click away, and
 * says explicitly that the diagnosis is already done.
 * @param {SignatureEntry} entry The matched row.
 * @param {string} root Repository root.
 * @returns {string} An operator-readable block.
 */
export function formatNotice(entry, root) {
  const records = entry.records.map(record => {
    const line = anchorLine(root, record);
    return `    - ${record.file}${line === null ? "" : `:${line}`}`;
  });
  const guard =
    entry.guard === undefined
      ? []
      : [
          `  ALREADY GUARDED by ${entry.guard.name} (${entry.guard.file}) — do NOT build a second control for this.`,
        ];
  return [
    `  ${entry.id}`,
    `  Symptom: ${entry.symptom}`,
    `  Cause:   ${entry.cause}`,
    `  This is already written down, next to the cause:`,
    ...records,
    ...guard,
    `  Read those before diagnosing this yourself.`,
  ].join("\n");
}

/**
 * The whole report for one output.
 * @param {readonly SignatureEntry[]} matched Rows that fired.
 * @param {string} root Repository root.
 * @returns {string} The report, empty when nothing fired.
 */
export function formatReport(matched, root) {
  if (matched.length === 0) return "";
  return [
    "Lisa failure-signature index — this output matches a KNOWN hazard whose",
    "explanation already exists in this repository:",
    "",
    ...matched.map(entry => formatNotice(entry, root)),
  ].join("\n");
}

/**
 * Everything a Bash PostToolUse payload said, as one string.
 *
 * Shallow and string-only on purpose: the payload shape differs between agents
 * and between tools, and a matcher that walks arbitrary nesting would start
 * matching on file contents a command merely read.
 * @param {object} payload The parsed hook stdin.
 * @returns {string} Output text, empty when there is none.
 */
export function outputText(payload) {
  const response = payload?.tool_response;
  if (typeof response === "string") return response;
  return ["stdout", "stderr", "error", "output"]
    .map(field => response?.[field])
    .filter(value => typeof value === "string")
    .join("\n");
}

/**
 * Whether a command is about the index itself.
 *
 * A `cat failure-signatures.json` contains every sample by construction, so
 * without this the index fires on anyone reading it. One noisy false positive
 * teaches people to ignore the notice, which is the whole failure mode.
 * @param {object} payload The parsed hook stdin.
 * @returns {boolean} Whether to stay silent.
 */
export function isSelfReferential(payload) {
  const command = payload?.tool_input?.command;
  return typeof command === "string" && command.includes("failure-signature");
}

/**
 * Read all of stdin.
 * @returns {Promise<string>} What was piped in.
 */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The `--check` mode: prove the index still routes.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function runCheck(root) {
  const { entries, error } = loadIndex(root);
  if (error !== null) {
    process.stderr.write(`failure-signature index: ${error}\n`);
    return 1;
  }
  const { problems, resolved } = validateIndex(entries, root);
  if (problems.length > 0) {
    process.stderr.write(
      `failure-signature index: ${problems.length} problem(s)\n` +
        problems.map(problem => `  - ${problem}\n`).join("")
    );
    return 1;
  }
  process.stdout.write(
    `failure-signature index: ${resolved} entr${resolved === 1 ? "y resolves" : "ies resolve"} to a live record\n`
  );
  return 0;
}

/**
 * The `--hook` mode: teach at the moment of failure.
 *
 * Advisory by construction — always exit 0. The hazard has already happened;
 * blocking the agent here would punish it for meeting a symptom.
 * @param {string} raw The hook's stdin.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function runHook(raw, root) {
  const payload = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  if (payload === null || isSelfReferential(payload)) return 0;
  const { entries } = loadIndex(root);
  const report = formatReport(matchEntries(outputText(payload), entries), root);
  if (report.length === 0) return 0;
  process.stderr.write(`${report}\n`);
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: report,
      },
    })}\n`
  );
  return 0;
}

/**
 * The `--match` mode: ask the same question of any transcript.
 * @param {string} text The transcript.
 * @param {string} root Repository root.
 * @returns {number} An exit code.
 */
export function runMatch(text, root) {
  const { entries } = loadIndex(root);
  const report = formatReport(matchEntries(text, entries), root);
  if (report.length === 0) return 0;
  process.stdout.write(`${report}\n`);
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
  if (argv.includes("--hook")) return runHook(raw, root);
  if (argv.includes("--match")) return runMatch(raw, root);
  return runCheck(root);
}

/**
 * Whether this module is the process entry point.
 *
 * Both sides are realpath'd. Comparing `fileURLToPath(import.meta.url)` against
 * `path.resolve(process.argv[1])` disagrees whenever the checkout is reached
 * through a symlink — a git worktree, or any `/tmp` path on macOS, `/tmp` being
 * a symlink to `/private/tmp` — because `import.meta.url` is the REAL path
 * while `argv[1]` is whatever the caller typed. For a CHECK that is a
 * fail-OPEN: no output, exit 0, the npm script "succeeds", and the gate
 * silently stops having an opinion.
 *
 * The one implementation lives at `scripts/lib/invoked-as-script.mjs`. This
 * file cannot import it: it is materialized into every plugin payload, where
 * there is no `./lib/` to import from — the same accommodation
 * `threshold-ratchet.mjs` makes, for the same reason.
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

if (invokedAsScript(import.meta.url)) {
  const argv = process.argv.slice(2);
  const needsStdin = argv.includes("--hook") || argv.includes("--match");
  const raw = needsStdin ? await readStdin() : "";
  process.exitCode = main(argv, raw, repoRoot());
}
