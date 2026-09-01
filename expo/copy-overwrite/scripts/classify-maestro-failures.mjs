#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * classify-maestro-failures — tell a preamble loss apart from a product
 * regression when reading a Maestro JUnit report.
 *
 * Usage:
 *   node scripts/classify-maestro-failures.mjs <report.xml> [more.xml ...]
 *   node scripts/classify-maestro-failures.mjs --json     <report.xml>
 *   node scripts/classify-maestro-failures.mjs --markdown <report.xml>
 *   node scripts/classify-maestro-failures.mjs --platform=android <report.xml>
 *   node scripts/classify-maestro-failures.mjs --debug-output=maestro-debug <report.xml>
 *
 * ## This is a DIAGNOSTIC, never a gate
 *
 * It scores a run so a reader can attribute a red night correctly; it does not
 * decide anything. It exits 0 on every readable report — including one full of
 * product failures — and the only non-zero exit is usage (no report named).
 * The nightly e2e merge gate (`check-nightly-e2e-health.mjs`,
 * `docs/nightly-e2e-gate.md`) is the thing that blocks, it reads run history
 * rather than artifacts, and nothing here feeds it. Keep it that way: a
 * heuristic that can turn a red run green is a fail-open path, and a heuristic
 * that can turn a green run red is a flaky gate.
 *
 * ## Why this exists
 *
 * Every authenticated flow runs a sign-in preamble before it asserts anything
 * about the product. When the preamble fails, the flow reds having tested
 * nothing — and it reds on an assertion naming a preamble gate, not the
 * feature, so a reader scoring the run by flow name counts it as a product
 * regression. Upstreamed from AcmeOrgD/frontend, where proof runs 6
 * (31424664541) and 7 (31446155638) lost four flows each that way; run 6's
 * Android arm was written up as a possible product regression and every one of
 * those flows came back green in run 7 with no code addressing them.
 *
 * ## How a failure is classified
 *
 * The preamble gate identities are DERIVED from the preamble subflows rather
 * than hardcoded: a hardcoded filename list silently stops matching the moment
 * somebody edits a gate, and the failure mode of that drift is preamble noise
 * quietly re-entering the product column.
 *
 * For each failing test case:
 *
 *   1. Resolve which subflows the flow transitively runs (`runFlow`).
 *   2. Split them into PREAMBLE subflows and everything else. A subflow is a
 *      preamble iff it transitively performs the sign-in sequence — it touches
 *      one of the project's sign-in marker selectors. That is an objective
 *      trait read off the file, not a filename list to maintain.
 *   3. If the failing assertion names a gate from a preamble subflow, and NO
 *      other surface the flow runs asserts that same gate, it is a PREAMBLE
 *      loss.
 *
 * Navigation helpers are deliberately NOT preambles. A helper that opens a
 * detail screen runs mid-scenario, after sign-in, as the flow's own product
 * work; a flow that dies in one HAS begun testing its subject and its failure
 * belongs in the product column.
 *
 * ## The tie-break always favors the product column
 *
 * A selector the flow's own body asserts, or that a non-preamble subflow
 * asserts, is reported as a product failure even when a preamble shares it.
 * Misfiling a preamble loss as a product regression costs a reader some time;
 * misfiling a real product regression as preamble noise HIDES it, and this
 * whole file exists because hidden signal is expensive. Make the cheap error.
 *
 * The same asymmetry sets the default behavior of an UNCONFIGURED project: with
 * no sign-in markers that match anything, no subflow qualifies as a preamble
 * and every failure reads as product. Silence in the config produces the safe
 * column, never the flattering one.
 *
 * ## Elapsed-at-gate, and why it is reported
 *
 * `extendedWaitUntil` polls until its ceiling and only then asserts, so a
 * timed-out gate has always consumed its FULL timeout — verified on Maestro
 * 2.7.0, where a 3000ms gate failed a flow at 5s against a ~2s launch. That
 * makes `elapsed_at_gate = flow_duration - gate_ceiling` the time the flow took
 * to REACH the gate, which is the measurement that decides whether a gate is
 * under-tolerant or the device is unstable:
 *
 *   - reach-time near the healthy value, gate expired  => the screen never
 *     came; raising the ceiling has no measured basis.
 *   - reach-time far above the healthy value           => the arm is degraded
 *     and tolerance is the wrong lever anyway.
 *
 * No gate should be raised again without quoting this number.
 *
 * ## The DEVICE column, and why it cannot read the report
 *
 * A third verdict sits beside `preamble` and `product`: DEVICE, meaning the
 * harness fell over and the product was never exercised. That is the first
 * question anyone asks of a red nightly, and the JUnit report cannot answer it.
 *
 * Two device deaths are measured in `maestro-native-e2e.yml`'s own retry
 * rationale: a `maestro.android.DeviceServerDiedException` during `eraseText`,
 * whose `<failure>` element was BLANK, and a stuck IME-insets animation
 * starving UiAutomator's `waitForIdle`, whose only signature was 25
 * `animations-not-complete` events on the two affected flows against 0-1 across
 * the other thirty-nine. The sibling arm has a third whose `<failure>` read, in
 * its entirety, `Unknown error`. A classifier keyed on the failure TEXT would
 * have caught none of them, and would have looked correct throughout, because
 * it would still have sorted every ordinary assertion failure correctly.
 *
 * So the device verdict is derived from the RUN rather than from its report —
 * specifically from Maestro's `--debug-output` tree, which it writes
 * independently of the JUnit XML. Two signals, neither of which reads
 * `<failure>`:
 *
 *   1. A FAULT marker present in a flow's own debug artifacts. Presence is
 *      enough: `DeviceServerDiedException` is not a thing a product bug emits.
 *   2. An INSTABILITY marker whose count for one flow towers over the run's own
 *      baseline. Counting against a baseline is what the IME case was actually
 *      diagnosed by, and it is robust to a blank `<failure>` precisely because
 *      it never needs the failure to carry any text at all.
 *
 * With no `--debug-output` supplied there is no evidence, so nothing is ever a
 * device fault and this file behaves exactly as it did before — the same
 * silence-produces-the-safe-column asymmetry the preamble split has.
 *
 * ## The device column is REPORTING, and must never become an input to retry
 *
 * Per-flow retry is keyed on WHICH flow failed and never on why, because the
 * text is unreliable — the whole argument is in the driver's own comment block.
 * A device classifier feeding that decision would reintroduce the too-narrow
 * regex the current design rejects. The suite driver reads the report; this
 * runs afterwards, off to one side, and nothing consumes its output.
 *
 * ## Known-intermittent registry
 *
 * `.maestro/flake-classification.json` (create-only; the project owns it) also
 * carries the flows that fail SOMETIMES on an unchanged build. Every entry must
 * carry a measured rate and the methodology behind it, and an entry that does
 * not is reported as a registry defect and annotates nothing. That rule is the
 * whole point: an unmeasured "known flake" entry is how a real regression gets
 * dismissed, so a claim with no measurement behind it must have no power to
 * excuse a failure.
 *
 * The contract this file implements is `docs/maestro-flake-classification.md`
 * in Lisa; the non-gating property is proved by executing the workflow step's
 * own shell in `tests/integration/maestro-native-flake-classification.test.ts`.
 *
 * @module scripts/classify-maestro-failures
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { cell } from "./bdd/markdown-cell.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Wait commands whose `timeout:` is a ceiling the command burns before failing.
 *
 * `scrollUntilVisible` is included: it also polls to a ceiling and reports a
 * not-found against its `element:` selector.
 */
const GATE_COMMANDS = ["extendedWaitUntil", "scrollUntilVisible"];

/**
 * Selectors whose presence marks a subflow as performing sign-in.
 *
 * These are the REFERENCE project's selectors, shipped as a starting default
 * and meant to be replaced in `.maestro/flake-classification.json` with the
 * ones your own sign-in flow uses. Leaving them unmatched is safe by
 * construction — nothing qualifies as a preamble, so every failure reads as
 * product, which is the direction this tool is required to err in.
 */
export const DEFAULT_SIGN_IN_MARKERS = [
  "landing:sign-in",
  "signin:email-input",
];

/**
 * Markers whose PRESENCE in a flow's debug artifacts proves the device died.
 *
 * Exactly the fault this repository has a measurement for, and no more. A
 * speculative list of exception names nobody has seen would be indistinguishable
 * from a working one right up until it mattered, so projects extend this
 * through `deviceFaultMarkers` in `.maestro/flake-classification.json` when they
 * measure their own.
 */
export const DEFAULT_DEVICE_FAULT_MARKERS = ["DeviceServerDiedException"];

/**
 * Markers whose RATE, against the run's own baseline, shows a degraded device.
 *
 * Presence proves nothing here — a healthy flow emits one or two — so these are
 * counted rather than matched. See {@link deviceVerdict} for the thresholds.
 */
export const DEFAULT_DEVICE_INSTABILITY_MARKERS = ["animations-not-complete"];

/** Events a flow must carry before its count can mean anything at all. */
export const DEVICE_INSTABILITY_FLOOR = 5;

/** ...and the multiple of the run's own median it must also clear. */
export const DEVICE_INSTABILITY_MULTIPLE = 5;

/**
 * Suffixes whose bytes are not text and must never be scanned for markers.
 *
 * Maestro names a screenshot after the flow AND the failure, so a file that
 * merely mentions a marker in its own NAME would otherwise read as evidence of
 * one. Decoding image bytes as UTF-8 also produces arbitrary byte sequences,
 * which is a second way to manufacture a match nobody's device produced.
 */
const OPAQUE_SUFFIXES = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".heic",
  ".mp4",
  ".mov",
  ".webm",
  ".zip",
  ".gz",
  ".tar",
  ".jar",
  ".apk",
  ".ipa",
];

/** Project-owned configuration file, relative to the project root. */
export const CONFIG_REL_PATH = path.join(
  ".maestro",
  "flake-classification.json"
);

/** Methodology strings that assert nothing and must not be accepted as one. */
const PLACEHOLDER_METHODS = new Set([
  "",
  "-",
  "n/a",
  "na",
  "tbd",
  "todo",
  "unknown",
  "none",
  "?",
]);

/**
 * An `id:` line, with everything after the colon captured verbatim.
 *
 * Two deliberate spellings, both there to keep the match linear (S5852):
 * `[ \t]` rather than `\s`, because this is applied to one already-split line
 * and `\s`'s newline class only lets the indentation run overlap the next
 * line's; and `(?:\S.*)?` rather than `.*`, because `[ \t]*(.*)` lets both
 * halves claim the same spaces, which is a choice the engine has to make at
 * every one of them.
 */
const ID_LINE = /^[ \t]*id:[ \t]*((?:\S.*)?)$/;

/** A `text:` line, read the same way. */
const TEXT_LINE = /^[ \t]*text:[ \t]*((?:\S.*)?)$/;

/** A `name:` line, read the same way. Only the flow HEADER's copy is used. */
const NAME_LINE = /^[ \t]*name:[ \t]*((?:\S.*)?)$/;

/**
 * A scalar value with one layer of matching quotes removed.
 *
 * Character comparison rather than `['"]?(...)['"]?`, because the regex form
 * cannot express "the same quote at both ends" without a backreference, and
 * the shape it settled for — a lazy capture between two optional quotes and a
 * trailing `\s*$` — has three quantifiers competing for the same characters.
 * That is super-linear in the line's length (S5852) on flow files.
 * @param {string} value - An already-trimmed scalar.
 * @returns {string} The value without its surrounding quote pair.
 */
function unquote(value) {
  const first = value.at(0);
  const isQuote = first === "'" || first === '"';
  return isQuote && value.length > 1 && value.at(-1) === first
    ? value.slice(1, -1)
    : value;
}

/**
 * The selector a `key: value` line declares, or null when the line is not one.
 *
 * An empty value reads as "no selector here" rather than as the empty
 * selector, which is what the previous `[^'"\n]+?` (one character minimum)
 * also did.
 * @param {string} line - One line of flow YAML.
 * @param {RegExp} pattern - The key's line pattern.
 * @returns {string|null} The selector, or null.
 */
function scalarSelector(line, pattern) {
  const match = pattern.exec(line);
  if (!match) return null;
  const value = unquote(match[1].trim());
  return value === "" ? null : value;
}

/**
 * Pull `id:`/`text:` selectors and their ceilings out of a flow's YAML source.
 *
 * Deliberately a line scanner rather than a YAML parse: this script must run
 * with zero dependencies in a CI job that has not installed anything, and the
 * shapes Maestro accepts under a wait command are uniform enough that a scanner
 * reads them exactly. It tracks the ceiling seen most recently inside the
 * current gate block so a selector is paired with its own timeout.
 * @param {string} source - Flow YAML source
 * @returns {{kind: string, selector: string, timeoutMs: number | null}[]} Gates
 */
export function extractGates(source) {
  const lines = source.split("\n");
  const gates = [];
  let inGate = false;
  let indent = 0;
  let pending = [];
  let timeout = null;

  const flush = () => {
    for (const selector of pending) {
      gates.push({ ...selector, timeoutMs: timeout });
    }
    pending = [];
    timeout = null;
  };

  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === "") continue;
    // `(?:-\s*)?` rather than `-?\s*`: with two `\s*` runs either side of an
    // optional dash, both can claim the same spaces and the engine has a
    // choice at every one — super-linear in the line's length (S5852). Tying
    // the dash to the whitespace that follows it removes the choice and
    // recognises exactly the same lines.
    const command = line.match(/^(\s*)(?:-\s*)?(\w+):/);
    if (command && GATE_COMMANDS.includes(command[2])) {
      if (inGate) flush();
      inGate = true;
      indent = command[1].length;
      continue;
    }
    if (!inGate) continue;
    const currentIndent = line.match(/^\s*/)[0].length;
    // A line at or left of the gate's own indent ends the block.
    if (currentIndent <= indent && line.trim().startsWith("-")) {
      flush();
      inGate = false;
      continue;
    }
    const timeoutMatch = line.match(/^\s*timeout:\s*(\d+)/);
    if (timeoutMatch) {
      timeout = Number(timeoutMatch[1]);
      continue;
    }
    const idSelector = scalarSelector(line, ID_LINE);
    if (idSelector !== null) {
      pending.push({ kind: "id", selector: idSelector });
      continue;
    }
    const textSelector = scalarSelector(line, TEXT_LINE);
    if (textSelector !== null)
      pending.push({ kind: "text", selector: textSelector });
  }
  if (inGate) flush();
  return gates;
}

/** The extension a referenced flow must carry to be followed. */
const YAML_SUFFIX = ".yaml";

/**
 * A `runFlow: <path>` line, in the shorthand list-item form.
 *
 * `[ \t]` rather than `\s` throughout, and the dash tied to the whitespace
 * that follows it. Under `m`, a `\s*` run can cross a newline into the next
 * line's own `^`, so the scan re-attempts the same characters from many start
 * positions — super-linear in the file's length (S5852).
 */
const INLINE_RUN_FLOW = /^[ \t]*(?:-[ \t]*)?runFlow:[ \t]*['"]?([^'"\s]+)/gm;

/** The `file: <path>` line of the expanded `runFlow:` form. */
const NESTED_RUN_FLOW = /^[ \t]*file:[ \t]*['"]?([^'"\s]+)/gm;

/**
 * Resolve the `runFlow:` targets a flow references, as absolute paths.
 * @param {string} source - Flow YAML source
 * @param {string} flowPath - Absolute path of the flow being read
 * @returns {string[]} Absolute paths of referenced flows
 */
export function extractRunFlowTargets(source, flowPath) {
  const dir = path.dirname(flowPath);
  const targets = [];
  // The `.yaml` suffix is checked in JS rather than written as `[^'"\s]+\.yaml`.
  // A greedy class that already contains `.` has to give characters back one at
  // a time before the literal suffix can match, at every start position a `g`
  // scan tries — super-linear in the source's length (S5852), on flow files.
  // The class stops at whitespace or a quote either way, so the token it
  // captures is the same one; only the suffix test moved.
  for (const match of source.matchAll(INLINE_RUN_FLOW))
    if (match[1].endsWith(YAML_SUFFIX))
      targets.push(path.resolve(dir, match[1]));
  for (const match of source.matchAll(NESTED_RUN_FLOW))
    if (match[1].endsWith(YAML_SUFFIX))
      targets.push(path.resolve(dir, match[1]));
  return targets;
}

/**
 * Walk a flow's `runFlow` graph and return every subflow it transitively runs.
 *
 * Cycle-safe via the visited set — a subflow that re-enters one already on the
 * stack would otherwise recurse forever.
 * @param {string} flowPath - Absolute path of the entry flow
 * @param {(target: string) => string | null} readFile - Source reader
 * @param {Set<string>} [seen] - Visited set, supplied by the recursion
 * @returns {string[]} Absolute paths of every subflow reached
 */
export function resolveSubflows(flowPath, readFile, seen = new Set()) {
  const resolved = [];
  const source = readFile(flowPath);
  if (source === null) return resolved;
  for (const target of extractRunFlowTargets(source, flowPath)) {
    if (seen.has(target)) continue;
    seen.add(target);
    resolved.push(target);
    resolved.push(...resolveSubflows(target, readFile, seen));
  }
  return resolved;
}

/**
 * Is this subflow a sign-in preamble — directly, or through one it runs?
 *
 * Cycle-safe via `seen` for the same reason `resolveSubflows` is.
 * @param {string} flowPath - Absolute path of the subflow
 * @param {(target: string) => string | null} readFile - Source reader
 * @param {readonly string[]} [markers] - Project sign-in marker selectors
 * @param {Set<string>} [seen] - Visited set, supplied by the recursion
 * @returns {boolean} True when the subflow signs somebody in
 */
export function isPreambleSubflow(
  flowPath,
  readFile,
  markers = DEFAULT_SIGN_IN_MARKERS,
  seen = new Set()
) {
  if (seen.has(flowPath)) return false;
  seen.add(flowPath);
  const source = readFile(flowPath);
  if (source === null) return false;
  if (markers.some(marker => source.includes(marker))) return true;
  return extractRunFlowTargets(source, flowPath).some(target =>
    isPreambleSubflow(target, readFile, markers, seen)
  );
}

/**
 * Does a Maestro failure message name this selector?
 *
 * Maestro renders a timed-out gate as `Assertion is false: id: <sel> is
 * visible` and a not-found as `Element not found: Id matching regex: <sel>`.
 * Both embed the selector verbatim, so an exact substring match is enough and
 * avoids the false positives a loose regex would invite.
 *
 * NOTE (verified on Maestro 2.7.0): a command's `label:` does NOT reach the
 * JUnit failure text — a labelled gate still reports the raw assertion. That is
 * why classification reads the selector rather than asking flow authors to
 * label their gates.
 * @param {string | null} message - Failure message from the report
 * @param {{kind: string, selector: string}} gate - Gate to look for
 * @returns {boolean} True when the message names this gate
 */
export function messageNamesSelector(message, { kind, selector }) {
  if (!message || !selector) return false;
  const needle = kind === "id" ? `id: ${selector}` : selector;
  return (
    message.includes(needle) ||
    message.includes(`Id matching regex: ${selector}`) ||
    message.includes(`Text matching regex: ${selector}`)
  );
}

/**
 * Parse the `<testcase>` rows out of a Maestro JUnit report.
 *
 * `failed` and `message` are SEPARATE, and the separation is load-bearing. The
 * measured `DeviceServerDiedException` loss wrote a BLANK `<failure>` element,
 * so a reader that treats "no failure text" as "no failure" drops the very row
 * this file's device column exists to explain — and drops it silently, one
 * short in the failing-flow count, filed under neither product nor preamble.
 * Presence of the element is what marks a failure; its text is commentary.
 * @param {string} xml - JUnit report source
 * @returns {{file: string, status: string, durationSec: number, message: string | null, failed: boolean}[]} Rows
 */
export function parseReport(xml) {
  const cases = [];
  // Attributes are matched LAZILY and the self-closing form is an alternative
  // of the same match, not a separate pattern: a greedy `[^>]*` swallows the
  // `/` of `<testcase .../>` and then hunts for the next `</testcase>`,
  // silently merging a passing case into the following failing one — which
  // reports the PASSING flow's name against the failing flow's message.
  for (const match of xml.matchAll(
    /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g
  )) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const attr = name =>
      (attrs.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
    // The self-closing form is an alternative of the SAME match, for the same
    // reason `<testcase/>` is above — and because `<failure/>` is one of the two
    // shapes a device death with nothing to say arrives in.
    const failure = body.match(
      /<(?:failure|error)\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:failure|error)>)/
    );
    cases.push({
      file: attr("file") || "",
      status: attr("status") || "",
      durationSec: Number(attr("time") || 0),
      failed: Boolean(failure),
      message: failure
        ? decodeEntities((failure[1] ?? "").trim().split("\n")[0].trim())
        : null,
    });
  }
  return cases;
}

/**
 * Decode the five XML entities Maestro emits into failure text.
 * @param {string} value - Encoded text
 * @returns {string} Decoded text
 */
function decodeEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The flow-header separator. `[ \t]` deliberately, never `\s` — see ID_LINE. */
const HEADER_SEPARATOR = /^---[ \t]*$/m;

/**
 * Whether an artifact's bytes are not text and must not be scanned.
 * @param {string} artifactPath - Path of the artifact
 * @returns {boolean} True when it must be skipped
 */
function isOpaque(artifactPath) {
  const lowered = artifactPath.toLowerCase();
  return OPAQUE_SUFFIXES.some(suffix => lowered.endsWith(suffix));
}

/**
 * The tokens a debug artifact's filename may carry to belong to this flow.
 *
 * Maestro names per-flow debug artifacts after the flow's NAME, which is the
 * `name:` its header declares and the file stem otherwise. Both are returned
 * because a project that adopts `name:` would otherwise silently stop being
 * attributable — the same drift failure the preamble split is derived to avoid.
 *
 * Only the HEADER's `name:` counts. `runFlow` blocks and several commands take
 * a `name:` of their own, and reading those would attribute another flow's
 * artifacts to this one.
 * @param {string} reportedFile - `file` attribute from the testcase row
 * @param {string | null} source - The flow's YAML, when it is on disk
 * @returns {string[]} Tokens naming this flow
 */
export function flowArtifactKeys(reportedFile, source) {
  const stem = path.basename(reportedFile).replace(/\.ya?ml$/i, "");
  const keys = stem === "" ? [] : [stem];
  const header = (source ?? "").split(HEADER_SEPARATOR)[0] ?? "";
  for (const line of header.split("\n")) {
    const declared = scalarSelector(line, NAME_LINE);
    if (declared !== null && !keys.includes(declared)) keys.push(declared);
  }
  return keys;
}

/**
 * Attribute one debug artifact to at most one flow.
 *
 * LONGEST key wins, and that is the whole rule. `commands-(card-detail-2).json`
 * contains `card-detail` as a substring, so a first-match scan would read one
 * flow's device death as its sibling's — and a boundary heuristic cannot help,
 * because the delimiter it would look for (`-`) is inside the keys themselves.
 *
 * The artifact's OWN directory counts as well as its filename, because Maestro
 * has shipped both layouts — a flow's name in the file (`commands-(x).json`)
 * and a directory per flow. Only the last two segments are considered: reaching
 * further up would let the run's own directory name decide every artifact.
 *
 * An artifact naming NO flow — logcat, written once per run — belongs to none
 * of them. Spreading its faults across every failing flow would launder a real
 * product regression, which is the expensive direction to be wrong in.
 * @param {string} artifactPath - Absolute path of the artifact
 * @param {readonly {flow: string, keys: readonly string[]}[]} flowKeys - Candidates
 * @returns {string | null} The flow it belongs to, or null
 */
export function attributeArtifact(artifactPath, flowKeys) {
  const name = path.join(
    path.basename(path.dirname(artifactPath)),
    path.basename(artifactPath)
  );
  let best = null;
  for (const entry of flowKeys)
    for (const key of entry.keys) {
      if (key === "" || !name.includes(key)) continue;
      if (best === null || key.length > best.key.length)
        best = { key, flow: entry.flow };
    }
  return best === null ? null : best.flow;
}

/**
 * Count non-overlapping occurrences of a literal needle.
 *
 * `split` rather than a `RegExp`: markers come from project config, and a
 * config value containing `.` or `(` would otherwise be compiled as a pattern
 * and match text nobody's device emitted.
 * @param {string} haystack - Text to scan
 * @param {string} needle - Literal marker
 * @returns {number} Occurrences
 */
function countOccurrences(haystack, needle) {
  return needle === "" ? 0 : haystack.split(needle).length - 1;
}

/**
 * Tally every marker across a run's debug artifacts, per flow.
 * @param {readonly {path: string, text: string}[]} artifacts - Debug artifacts
 * @param {readonly {flow: string, keys: readonly string[]}[]} flowKeys - Flows in the report
 * @param {readonly string[]} markers - Markers to count
 * @returns {{perFlow: Map<string, object>, unattributed: object}} Tallies
 */
export function tallyDeviceMarkers(artifacts, flowKeys, markers) {
  const perFlow = new Map(flowKeys.map(entry => [entry.flow, {}]));
  const unattributed = {};
  for (const artifact of artifacts) {
    // Enforced HERE and not only at read time. `readDebugArtifacts` skips these
    // to avoid loading megabytes of PNG, which is an I/O saving; this is the
    // correctness one, and it holds for any caller that assembles the artifact
    // list some other way.
    if (isOpaque(artifact.path)) continue;
    const flow = attributeArtifact(artifact.path, flowKeys);
    const bucket = flow === null ? unattributed : (perFlow.get(flow) ?? {});
    for (const marker of markers) {
      const count = countOccurrences(artifact.text, marker);
      if (count === 0) continue;
      const seen = bucket[marker] ?? {
        count: 0,
        artifact: path.basename(artifact.path),
      };
      bucket[marker] = { count: seen.count + count, artifact: seen.artifact };
    }
  }
  return { perFlow, unattributed };
}

/**
 * Median of a list of counts, which is 0 for an empty one.
 * @param {readonly number[]} values - Counts
 * @returns {number} Median
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Decide whether one flow's tally amounts to a device fault.
 *
 * A fault marker is decided by PRESENCE — nothing a product bug does raises
 * `DeviceServerDiedException`. An instability marker is decided by COUNT
 * against the run's own median flow, and must clear BOTH a floor and a
 * multiple. Each threshold rules out a mistake the other cannot:
 *
 *   - the floor rules out a run whose median is 0, where a single stray event
 *     sits infinitely above baseline and means nothing;
 *   - the multiple rules out a uniformly degraded run, where every flow clears
 *     the floor and a floor-only test would empty the product column.
 *
 * With the measured IME case — 25 events on the affected flows against 0-1
 * elsewhere — the median is 1 and both tests pass by a wide margin.
 * @param {object} tallies - This flow's marker tallies
 * @param {Record<string, number>} baselines - Median count per instability marker
 * @param {{faultMarkers: readonly string[], instabilityMarkers: readonly string[]}} markers - Marker sets
 * @returns {object | null} The device signal, or null
 */
export function deviceVerdict(tallies, baselines, markers) {
  for (const marker of markers.faultMarkers) {
    const seen = tallies[marker];
    if (seen)
      return {
        signal: "fault-marker",
        marker,
        count: seen.count,
        baseline: null,
        artifact: seen.artifact,
      };
  }
  for (const marker of markers.instabilityMarkers) {
    const seen = tallies[marker];
    if (!seen || seen.count < DEVICE_INSTABILITY_FLOOR) continue;
    const baseline = Math.max(1, baselines[marker] ?? 0);
    if (seen.count < baseline * DEVICE_INSTABILITY_MULTIPLE) continue;
    return {
      signal: "instability",
      marker,
      count: seen.count,
      baseline,
      artifact: seen.artifact,
    };
  }
  return null;
}

/**
 * Read every TEXT artifact under a run's `--debug-output` tree.
 *
 * Absence is normal and silent: a run that crashed before Maestro started, or a
 * caller that has not wired the flag, simply yields no evidence — and with no
 * evidence nothing is ever a device fault.
 * @param {string | null} debugRoot - Absolute path of the debug-output directory
 * @param {{listFiles: Function, readFile: Function}} io - Injected readers
 * @returns {{path: string, text: string}[]} Artifacts
 */
export function readDebugArtifacts(debugRoot, { listFiles, readFile }) {
  if (!debugRoot) return [];
  const artifacts = [];
  for (const file of listFiles(debugRoot) ?? []) {
    if (isOpaque(file)) continue;
    const text = readFile(file);
    if (text === null) continue;
    artifacts.push({ path: file, text });
  }
  return artifacts;
}

/**
 * Reject a registry entry that cannot support the claim it makes.
 * @param {unknown} entry - Candidate registry entry
 * @returns {string | null} Defect reason, or null when the entry is sound
 */
function intermittentDefect(entry) {
  if (!entry || typeof entry !== "object") return "entry is not an object";
  const { flow, measured } = /** @type {Record<string, any>} */ (entry);
  if (typeof flow !== "string" || flow.trim() === "")
    return "entry has no `flow`";
  if (!measured || typeof measured !== "object")
    return "entry has no `measured` block — a rate nobody measured is not evidence";
  const { failures, runs, measuredAt, method } = measured;
  if (!Number.isInteger(runs) || runs <= 0)
    return "`measured.runs` must be a positive integer";
  if (!Number.isInteger(failures) || failures < 1)
    return "`measured.failures` must be at least 1 — an entry that never failed is not a known intermittent";
  if (failures > runs) return "`measured.failures` exceeds `measured.runs`";
  if (typeof measuredAt !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(measuredAt))
    return "`measured.measuredAt` must be an ISO date";
  if (
    typeof method !== "string" ||
    PLACEHOLDER_METHODS.has(method.trim().toLowerCase())
  )
    return "`measured.method` must describe how the rate was measured";
  return null;
}

/**
 * Validate the known-intermittent registry, keeping only entries that earn it.
 *
 * Defective entries are REPORTED and DISCARDED rather than tolerated: the whole
 * purpose of the registry is to let a reader discount a failure, so an entry
 * with no measurement behind it must be unable to discount anything.
 * @param {unknown} entries - Raw `knownIntermittent` array from the config
 * @returns {{entries: object[], defects: {flow: string, reason: string}[]}} Verdict
 */
export function validateIntermittentRegistry(entries) {
  if (!Array.isArray(entries)) return { entries: [], defects: [] };
  const accepted = [];
  const defects = [];
  for (const entry of entries) {
    const reason = intermittentDefect(entry);
    if (reason) {
      const named =
        entry && typeof entry === "object" && typeof entry.flow === "string"
          ? entry.flow
          : "(unnamed)";
      defects.push({ flow: named, reason });
      continue;
    }
    accepted.push({
      flow: entry.flow,
      platforms: Array.isArray(entry.platforms)
        ? entry.platforms.map(String)
        : [],
      measured: entry.measured,
      ticket: typeof entry.ticket === "string" ? entry.ticket : null,
      notes: typeof entry.notes === "string" ? entry.notes : null,
    });
  }
  return { entries: accepted, defects };
}

/**
 * Find the measured-rate annotation for one flow on one platform.
 * @param {string} flow - Flow basename from the report
 * @param {string | null} platform - Arm the report came from, when known
 * @param {readonly object[]} registry - Validated registry entries
 * @returns {object | null} Annotation, or null when nothing applies
 */
function intermittentFor(flow, platform, registry) {
  const entry = registry.find(candidate => {
    if (path.basename(candidate.flow) !== flow) return false;
    if (candidate.platforms.length === 0) return true;
    if (!platform) return false;
    return candidate.platforms.some(
      value => value.toLowerCase() === platform.toLowerCase()
    );
  });
  if (!entry) return null;
  const { failures, runs, measuredAt, method } = entry.measured;
  return {
    ratePercent: Number(((failures / runs) * 100).toFixed(1)),
    failures,
    runs,
    measuredAt,
    method,
    ticket: entry.ticket,
    notes: entry.notes,
  };
}

/**
 * Resolve a report's `file` attribute to a path on disk.
 *
 * Lisa's reusable workflow takes a configurable flows directory, so the
 * conventional `<root>/.maestro/flows/<name>` cannot be assumed. The reported
 * path is tried first (it is usually repo-relative and exact); the conventional
 * layout is the fallback, which is what keeps reports from older runners
 * readable.
 * @param {string} reported - `file` attribute from the testcase row
 * @param {{projectRoot: string, maestroRoot: string, readFile: Function}} context - Lookup context
 * @returns {string} Absolute path of the best candidate
 */
function resolveFlowPath(reported, { projectRoot, maestroRoot, readFile }) {
  const candidates = [
    path.resolve(projectRoot, reported),
    path.join(maestroRoot, "flows", path.basename(reported)),
    path.join(maestroRoot, path.basename(reported)),
  ];
  return (
    candidates.find(candidate => readFile(candidate) !== null) ?? candidates[0]
  );
}

/**
 * Classify one report's failures, plus whatever the run said about the device.
 *
 * `readFile` returns a flow's source or `null` when it is not on disk — a
 * report may name a flow deleted since the run, and that must degrade to
 * "product" rather than throw.
 * @param {string} reportXml - JUnit report source
 * @param {object} options - Classification context
 * @param {string} options.maestroRoot - Absolute path of the `.maestro` directory
 * @param {(target: string) => string | null} options.readFile - Source reader
 * @param {string} [options.projectRoot] - Absolute project root
 * @param {readonly string[]} [options.signInMarkers] - Project sign-in markers
 * @param {readonly unknown[]} [options.knownIntermittent] - Raw registry entries
 * @param {string} [options.platform] - Arm the report came from
 * @param {readonly {path: string, text: string}[]} [options.debugArtifacts] - Run observation
 * @param {readonly string[]} [options.deviceFaultMarkers] - Presence-decided device faults
 * @param {readonly string[]} [options.deviceInstabilityMarkers] - Count-decided device faults
 * @returns {{failures: object[], deviceRunEvidence: object[]}} The report's verdict
 */
export function classifyRun(reportXml, options) {
  const {
    maestroRoot,
    readFile,
    projectRoot = path.dirname(maestroRoot),
    signInMarkers = DEFAULT_SIGN_IN_MARKERS,
    knownIntermittent = [],
    platform = null,
    debugArtifacts = [],
    deviceFaultMarkers = DEFAULT_DEVICE_FAULT_MARKERS,
    deviceInstabilityMarkers = DEFAULT_DEVICE_INSTABILITY_MARKERS,
  } = options;
  const registry = validateIntermittentRegistry(knownIntermittent).entries;
  const rows = parseReport(reportXml);
  const paths = new Map(
    rows.map(row => [
      row.file,
      resolveFlowPath(row.file, { projectRoot, maestroRoot, readFile }),
    ])
  );
  // Every row, not just the failing ones: the instability baseline is the run's
  // own healthy flows, and a baseline drawn from the failures alone would be
  // the very population it is supposed to be measured against.
  const flowKeys = rows.map(row => ({
    flow: row.file,
    keys: flowArtifactKeys(row.file, readFile(paths.get(row.file))),
  }));
  const markers = {
    faultMarkers: deviceFaultMarkers,
    instabilityMarkers: deviceInstabilityMarkers,
  };
  const tally = tallyDeviceMarkers(debugArtifacts, flowKeys, [
    ...deviceFaultMarkers,
    ...deviceInstabilityMarkers,
  ]);
  const baselines = {};
  for (const marker of deviceInstabilityMarkers)
    baselines[marker] = median(
      [...tally.perFlow.values()].map(bucket => bucket[marker]?.count ?? 0)
    );
  const failures = [];
  for (const testCase of rows) {
    if (!testCase.failed) continue;
    const device = deviceVerdict(
      tally.perFlow.get(testCase.file) ?? {},
      baselines,
      markers
    );
    // A device death short-circuits the preamble/product split rather than
    // annotating it: the flow did not reach a verdict about the product at all,
    // so which gate it happened to be standing on when the device went is not a
    // finding about the app.
    const matched = device
      ? null
      : matchPreambleGate(paths.get(testCase.file), testCase, {
          readFile,
          signInMarkers,
        });
    const flow = path.basename(testCase.file);
    failures.push({
      flow,
      durationSec: testCase.durationSec,
      message: testCase.message,
      kind: device ? "device" : matched ? "preamble" : "product",
      device,
      gate: matched ? matched.selector : null,
      subflow: matched ? matched.subflow : null,
      gateCeilingSec:
        matched && matched.timeoutMs ? matched.timeoutMs / 1000 : null,
      elapsedAtGateSec:
        matched && matched.timeoutMs
          ? Number((testCase.durationSec - matched.timeoutMs / 1000).toFixed(1))
          : null,
      intermittent: intermittentFor(flow, platform, registry),
    });
  }
  return {
    failures,
    deviceRunEvidence: Object.entries(tally.unattributed).map(
      ([marker, seen]) => ({
        marker,
        count: seen.count,
        artifact: seen.artifact,
      })
    ),
  };
}

/**
 * Classify every failure in a report.
 *
 * The per-failure half of {@link classifyRun}, kept as its own export because
 * that is the shape every caller but the renderer wants.
 * @param {string} reportXml - JUnit report source
 * @param {object} options - Classification context, as {@link classifyRun} takes it
 * @returns {object[]} One record per failing flow
 */
export function classify(reportXml, options) {
  return classifyRun(reportXml, options).failures;
}

/**
 * Find the preamble gate a failure died on, if any.
 *
 * Split out of `classify` so the tie-break rule sits in one readable place: a
 * gate any product surface also asserts is skipped, which sends the failure to
 * the product column.
 * @param {string} flowPath - Absolute path of the failing flow
 * @param {{message: string}} testCase - Parsed testcase row
 * @param {{readFile: Function, signInMarkers: readonly string[]}} context - Lookup context
 * @returns {object | null} Matched gate plus its subflow, or null
 */
function matchPreambleGate(flowPath, testCase, { readFile, signInMarkers }) {
  const ownSource = readFile(flowPath);
  const subflows = ownSource ? resolveSubflows(flowPath, readFile) : [];
  const preambles = subflows.filter(subflow =>
    isPreambleSubflow(subflow, readFile, signInMarkers)
  );
  const others = subflows.filter(subflow => !preambles.includes(subflow));

  // Every gate the flow could have died on that is NOT preamble setup: its own
  // body, plus every navigation helper it runs mid-scenario.
  const productGates = [
    ...(ownSource ? extractGates(ownSource) : []),
    ...others.flatMap(subflow => extractGates(readFile(subflow) ?? "")),
  ];

  for (const subflow of preambles) {
    const source = readFile(subflow);
    if (source === null) continue;
    for (const gate of extractGates(source)) {
      if (!messageNamesSelector(testCase.message, gate)) continue;
      // Tie-break toward the product column: a selector any product surface
      // also asserts is the flow's own business, even if a preamble shares it.
      const contested = productGates.some(
        own => own.kind === gate.kind && own.selector === gate.selector
      );
      if (contested) continue;
      return { ...gate, subflow: path.basename(subflow) };
    }
  }
  return null;
}

/**
 * Read a file, or null when it is absent or unreadable.
 * @param {string} target - Absolute path
 * @returns {string | null} Contents, or null
 */
function readFileOrNull(target) {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return null;
  }
}

/**
 * Every FILE under `root`, recursively, or null when `root` is not a directory.
 *
 * `withFileTypes` reports a symlink as a symlink rather than as the thing it
 * points at, so a link back up the tree is neither followed nor recursed into
 * and this cannot loop.
 * @param {string} root - Absolute directory path
 * @returns {string[] | null} Absolute file paths, or null
 */
function listFilesRecursive(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(listFilesRecursive(full) ?? []));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/**
 * A config array of strings, or the shipped default when it is absent.
 * @param {unknown} value - Raw config value
 * @param {readonly string[]} fallback - Shipped default
 * @returns {readonly string[]} The markers to use
 */
function markerList(value, fallback) {
  return Array.isArray(value) ? value.map(String) : fallback;
}

/**
 * Load the project's classification config, tolerating absence and damage.
 *
 * A malformed config degrades to defaults with a reported defect rather than
 * throwing: this tool runs beside a failing test suite, and a diagnostic that
 * dies on a typo is a diagnostic nobody consults on the night they need it.
 * @param {string} projectRoot - Absolute project root
 * @returns {{signInMarkers: readonly string[], knownIntermittent: unknown[], deviceFaultMarkers: readonly string[], deviceInstabilityMarkers: readonly string[], defects: object[]}} Config
 */
export function loadConfig(projectRoot) {
  const defaults = {
    signInMarkers: DEFAULT_SIGN_IN_MARKERS,
    knownIntermittent: [],
    deviceFaultMarkers: DEFAULT_DEVICE_FAULT_MARKERS,
    deviceInstabilityMarkers: DEFAULT_DEVICE_INSTABILITY_MARKERS,
    defects: [],
  };
  const raw = readFileOrNull(path.join(projectRoot, CONFIG_REL_PATH));
  if (raw === null) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      signInMarkers: markerList(parsed.signInMarkers, DEFAULT_SIGN_IN_MARKERS),
      knownIntermittent: Array.isArray(parsed.knownIntermittent)
        ? parsed.knownIntermittent
        : [],
      deviceFaultMarkers: markerList(
        parsed.deviceFaultMarkers,
        DEFAULT_DEVICE_FAULT_MARKERS
      ),
      deviceInstabilityMarkers: markerList(
        parsed.deviceInstabilityMarkers,
        DEFAULT_DEVICE_INSTABILITY_MARKERS
      ),
    };
  } catch (error) {
    return {
      ...defaults,
      defects: [
        { flow: CONFIG_REL_PATH, reason: `unreadable JSON: ${error.message}` },
      ],
    };
  }
}

/**
 * Classify every named report against one project checkout.
 *
 * The debug-output tree is read ONCE and shared across the named reports: it is
 * the observation of a single run, and re-walking it per report would only cost
 * time. A retry arm writes into the same tree, which is correct — retries only
 * re-run flows that already failed, so its evidence is about those same flows.
 * @param {readonly string[]} reportPaths - Report paths
 * @param {{projectRoot: string, platform: string | null, debugRoot?: string | null}} context - Run context
 * @returns {{report: string, failures: object[], defects: object[], deviceRunEvidence: object[]}[]} Results
 */
export function run(reportPaths, { projectRoot, platform, debugRoot = null }) {
  const maestroRoot = path.join(projectRoot, ".maestro");
  const config = loadConfig(projectRoot);
  const registry = validateIntermittentRegistry(config.knownIntermittent);
  const defects = [...config.defects, ...registry.defects];
  const debugArtifacts = readDebugArtifacts(
    debugRoot ? path.resolve(projectRoot, debugRoot) : null,
    { listFiles: listFilesRecursive, readFile: readFileOrNull }
  );
  return reportPaths.map(reportPath => ({
    report: path.basename(reportPath),
    defects,
    ...classifyRun(readFileOrNull(reportPath) ?? "", {
      maestroRoot,
      projectRoot,
      readFile: readFileOrNull,
      signInMarkers: config.signInMarkers,
      knownIntermittent: config.knownIntermittent,
      deviceFaultMarkers: config.deviceFaultMarkers,
      deviceInstabilityMarkers: config.deviceInstabilityMarkers,
      debugArtifacts,
      platform,
    }),
  }));
}

/**
 * The failure text, or a plain statement that there was none.
 *
 * A blank cell reads as a rendering bug. "No text" is itself the finding on the
 * measured device deaths, so it is written out.
 * @param {string | null} message - Failure text from the report
 * @returns {string} Table-safe text
 */
function failureText(message) {
  return message ? cell(message) : "_(no failure text)_";
}

/**
 * How a device signal was arrived at, in one reader-facing phrase.
 * @param {object} device - The device signal
 * @returns {string} Evidence summary
 */
function deviceEvidence(device) {
  return device.signal === "fault-marker"
    ? `raised in \`${device.artifact}\``
    : `${device.count} events in \`${device.artifact}\` vs a baseline of ${device.baseline}`;
}

/**
 * Render one report's classification as GitHub step-summary markdown.
 * @param {{report: string, failures: object[], defects: object[], deviceRunEvidence?: object[]}} result - One report's result
 * @returns {string} Markdown block
 */
export function renderMarkdown({
  report,
  failures,
  defects,
  deviceRunEvidence = [],
}) {
  const preamble = failures.filter(failure => failure.kind === "preamble");
  const product = failures.filter(failure => failure.kind === "product");
  const device = failures.filter(failure => failure.kind === "device");
  const lines = [
    `### 🔍 Flake classification — \`${report}\``,
    "",
    `**${product.length} product** · **${device.length} device** (never exercised the product) · **${preamble.length} preamble** (tested nothing) · ${failures.length} failing flow(s)`,
    "",
    "_Diagnostic only — this never changes the result of any gate._",
    "",
  ];
  if (device.length > 0) {
    lines.push(
      "| flow | device signal | evidence | failure text |",
      "| --- | --- | --- | --- |"
    );
    for (const failure of device)
      lines.push(
        `| \`${failure.flow}\` | \`${failure.device.marker}\` (${failure.device.signal}) | ${deviceEvidence(failure.device)} | ${failureText(failure.message)} |`
      );
    lines.push(
      "",
      "_Read off the run's `--debug-output`, never off the failure text above — the measured device deaths carried none._",
      ""
    );
  }
  if (product.length > 0) {
    lines.push(
      "| flow | failure | known intermittent |",
      "| --- | --- | --- |"
    );
    for (const failure of product) {
      const known = failure.intermittent
        ? `${failure.intermittent.ratePercent}% (${failure.intermittent.failures}/${failure.intermittent.runs}, measured ${failure.intermittent.measuredAt})`
        : "—";
      lines.push(
        `| \`${failure.flow}\` | ${failureText(failure.message)} | ${known} |`
      );
    }
    lines.push("");
  }
  if (preamble.length > 0) {
    lines.push(
      "| flow | preamble gate | reached gate at | ceiling |",
      "| --- | --- | --- | --- |"
    );
    for (const failure of preamble) {
      lines.push(
        `| \`${failure.flow}\` | \`${failure.gate}\` (${failure.subflow}) | ${
          failure.elapsedAtGateSec === null
            ? "—"
            : `${failure.elapsedAtGateSec}s`
        } | ${failure.gateCeilingSec === null ? "—" : `${failure.gateCeilingSec}s`} |`
      );
    }
    lines.push("");
  }
  for (const evidence of deviceRunEvidence) {
    lines.push(
      `> 🩺 device signal \`${evidence.marker}\` ×${evidence.count} in \`${evidence.artifact}\`, which names no single flow. Reported only — it reclassifies nothing.`
    );
  }
  for (const defect of defects) {
    lines.push(
      `> ⚠️ known-intermittent entry \`${defect.flow}\` was IGNORED: ${defect.reason}`
    );
  }
  return lines.join("\n");
}

/**
 * Render one report's classification as plain text.
 * @param {{report: string, failures: object[], defects: object[], deviceRunEvidence?: object[]}} result - One report's result
 * @returns {string} Text block
 */
function renderText({ report, failures, defects, deviceRunEvidence = [] }) {
  const preamble = failures.filter(failure => failure.kind === "preamble");
  const product = failures.filter(failure => failure.kind === "product");
  const device = failures.filter(failure => failure.kind === "device");
  const lines = [
    "",
    `${report}: ${failures.length} failures`,
    `  ${product.length} product · ${device.length} device (never exercised the product) · ${preamble.length} preamble (tested nothing)`,
  ];
  for (const failure of device) {
    lines.push(
      `  [device  ] ${failure.flow}: ${failure.device.marker} — ${deviceEvidence(failure.device).replace(/`/g, "")}`
    );
  }
  for (const failure of preamble) {
    const reach =
      failure.elapsedAtGateSec === null
        ? ""
        : ` — reached the gate at ${failure.elapsedAtGateSec}s, then burned its ${failure.gateCeilingSec}s ceiling`;
    lines.push(`  [preamble] ${failure.flow} (${failure.subflow})${reach}`);
  }
  for (const failure of product) {
    const known = failure.intermittent
      ? ` [known intermittent ${failure.intermittent.ratePercent}% — ${failure.intermittent.failures}/${failure.intermittent.runs} measured ${failure.intermittent.measuredAt}]`
      : "";
    const text = failure.message || "(no failure text)";
    lines.push(`  [product ] ${failure.flow}: ${text}${known}`);
  }
  for (const evidence of deviceRunEvidence) {
    lines.push(
      `  [device? ] ${evidence.marker} ×${evidence.count} in ${evidence.artifact} — names no single flow, reclassifies nothing`
    );
  }
  for (const defect of defects) {
    lines.push(
      `  [ignored ] known-intermittent entry ${defect.flow}: ${defect.reason}`
    );
  }
  return lines.join("\n");
}

/**
 * CLI entry point. Exits non-zero only on usage error — never on findings.
 * @param {readonly string[]} argv - Arguments after the script name
 * @returns {void}
 */
function main(argv) {
  const asJson = argv.includes("--json");
  const asMarkdown = argv.includes("--markdown");
  const platformArg = argv.find(arg => arg.startsWith("--platform="));
  const debugArg = argv.find(arg => arg.startsWith("--debug-output="));
  const reports = argv.filter(arg => !arg.startsWith("--"));
  if (reports.length === 0) {
    console.error(
      "usage: node scripts/classify-maestro-failures.mjs [--json|--markdown] [--platform=android] [--debug-output=maestro-debug] <report.xml> [...]"
    );
    process.exitCode = 1;
    return;
  }
  const projectRoot = process.env.MAESTRO_CHECK_ROOT || process.cwd();
  const results = run(reports, {
    projectRoot,
    platform: platformArg ? platformArg.slice("--platform=".length) : null,
    debugRoot: debugArg ? debugArg.slice("--debug-output=".length) : null,
  });
  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  for (const result of results) {
    console.log(asMarkdown ? renderMarkdown(result) : renderText(result));
  }
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2));
}
