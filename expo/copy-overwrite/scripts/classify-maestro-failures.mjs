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
 * @param {string} xml - JUnit report source
 * @returns {{file: string, status: string, durationSec: number, message: string | null}[]} Rows
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
    const failure = body.match(
      /<(?:failure|error)\b[^>]*>([\s\S]*?)<\/(?:failure|error)>/
    );
    cases.push({
      file: attr("file") || "",
      status: attr("status") || "",
      durationSec: Number(attr("time") || 0),
      message: failure
        ? decodeEntities(failure[1].trim().split("\n")[0].trim())
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
 * Classify every failure in a report.
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
 * @returns {object[]} One record per failing flow
 */
export function classify(reportXml, options) {
  const {
    maestroRoot,
    readFile,
    projectRoot = path.dirname(maestroRoot),
    signInMarkers = DEFAULT_SIGN_IN_MARKERS,
    knownIntermittent = [],
    platform = null,
  } = options;
  const registry = validateIntermittentRegistry(knownIntermittent).entries;
  const results = [];
  for (const testCase of parseReport(reportXml)) {
    if (!testCase.message) continue;
    const flowPath = resolveFlowPath(testCase.file, {
      projectRoot,
      maestroRoot,
      readFile,
    });
    const matched = matchPreambleGate(flowPath, testCase, {
      readFile,
      signInMarkers,
    });
    const flow = path.basename(testCase.file);
    results.push({
      flow,
      durationSec: testCase.durationSec,
      message: testCase.message,
      kind: matched ? "preamble" : "product",
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
  return results;
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
 * Load the project's classification config, tolerating absence and damage.
 *
 * A malformed config degrades to defaults with a reported defect rather than
 * throwing: this tool runs beside a failing test suite, and a diagnostic that
 * dies on a typo is a diagnostic nobody consults on the night they need it.
 * @param {string} projectRoot - Absolute project root
 * @returns {{signInMarkers: string[], knownIntermittent: unknown[], defects: object[]}} Config
 */
export function loadConfig(projectRoot) {
  const raw = readFileOrNull(path.join(projectRoot, CONFIG_REL_PATH));
  if (raw === null)
    return {
      signInMarkers: DEFAULT_SIGN_IN_MARKERS,
      knownIntermittent: [],
      defects: [],
    };
  try {
    const parsed = JSON.parse(raw);
    return {
      signInMarkers: Array.isArray(parsed.signInMarkers)
        ? parsed.signInMarkers.map(String)
        : DEFAULT_SIGN_IN_MARKERS,
      knownIntermittent: Array.isArray(parsed.knownIntermittent)
        ? parsed.knownIntermittent
        : [],
      defects: [],
    };
  } catch (error) {
    return {
      signInMarkers: DEFAULT_SIGN_IN_MARKERS,
      knownIntermittent: [],
      defects: [
        { flow: CONFIG_REL_PATH, reason: `unreadable JSON: ${error.message}` },
      ],
    };
  }
}

/**
 * Classify every named report against one project checkout.
 * @param {readonly string[]} reportPaths - Report paths
 * @param {{projectRoot: string, platform: string | null}} context - Run context
 * @returns {{report: string, failures: object[], defects: object[]}[]} Results
 */
export function run(reportPaths, { projectRoot, platform }) {
  const maestroRoot = path.join(projectRoot, ".maestro");
  const config = loadConfig(projectRoot);
  const registry = validateIntermittentRegistry(config.knownIntermittent);
  const defects = [...config.defects, ...registry.defects];
  return reportPaths.map(reportPath => ({
    report: path.basename(reportPath),
    defects,
    failures: classify(readFileOrNull(reportPath) ?? "", {
      maestroRoot,
      projectRoot,
      readFile: readFileOrNull,
      signInMarkers: config.signInMarkers,
      knownIntermittent: config.knownIntermittent,
      platform,
    }),
  }));
}

/**
 * Render one report's classification as GitHub step-summary markdown.
 * @param {{report: string, failures: object[], defects: object[]}} result - One report's result
 * @returns {string} Markdown block
 */
export function renderMarkdown({ report, failures, defects }) {
  const preamble = failures.filter(failure => failure.kind === "preamble");
  const product = failures.filter(failure => failure.kind === "product");
  const lines = [
    `### 🔍 Flake classification — \`${report}\``,
    "",
    `**${product.length} product** · **${preamble.length} preamble** (tested nothing) · ${failures.length} failing flow(s)`,
    "",
    "_Diagnostic only — this never changes the result of any gate._",
    "",
  ];
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
        `| \`${failure.flow}\` | ${cell(failure.message)} | ${known} |`
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
  for (const defect of defects) {
    lines.push(
      `> ⚠️ known-intermittent entry \`${defect.flow}\` was IGNORED: ${defect.reason}`
    );
  }
  return lines.join("\n");
}

/**
 * Render one report's classification as plain text.
 * @param {{report: string, failures: object[], defects: object[]}} result - One report's result
 * @returns {string} Text block
 */
function renderText({ report, failures, defects }) {
  const preamble = failures.filter(failure => failure.kind === "preamble");
  const product = failures.filter(failure => failure.kind === "product");
  const lines = [
    "",
    `${report}: ${failures.length} failures`,
    `  ${product.length} product · ${preamble.length} preamble (tested nothing)`,
  ];
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
    lines.push(`  [product ] ${failure.flow}: ${failure.message}${known}`);
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
  const reports = argv.filter(arg => !arg.startsWith("--"));
  if (reports.length === 0) {
    console.error(
      "usage: node scripts/classify-maestro-failures.mjs [--json|--markdown] [--platform=android] <report.xml> [...]"
    );
    process.exitCode = 1;
    return;
  }
  const projectRoot = process.env.MAESTRO_CHECK_ROOT || process.cwd();
  const results = run(reports, {
    projectRoot,
    platform: platformArg ? platformArg.slice("--platform=".length) : null,
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
