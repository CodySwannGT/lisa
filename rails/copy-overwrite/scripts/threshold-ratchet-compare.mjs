// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Threshold ratchet — comparison rules and reporting.
 *
 * Pure comparison layer: given a watched file's baseline and current
 * contents, report every weakening. No filesystem or git access. See
 * threshold-ratchet-families.mjs for extraction and threshold-ratchet.mjs
 * for the CLI.
 */
import {
  ALLOW_STATE,
  classifyAllowEntry,
  describeAllowScope,
  extractAllowEntries,
  extractK6Constraints,
  extractLighthouseAssertions,
  extractNumericLeaves,
  extractRubocopThresholds,
  extractStrykerConstraints,
  extractStrykerMutate,
  familyFor,
  parseJson,
} from "./threshold-ratchet-families.mjs";

/** Finding type: a numeric bound or boolean gate moved the weakening way. */
const TYPE_WEAKENED = "weakened";
/** Finding type: a gate-shrinking exemption was added (Tier 3). */
const TYPE_EXEMPTION_ADDED = "exemption-added";
/** Family kind for .lisa.config.json (the thresholdRatchet.allow carrier). */
const KIND_ALLOW_LIST = "allow-list";

/**
 * @typedef {object} Finding
 * @property {string} file Repo-relative path of the gate file
 * @property {string} key Dotted key path within the file
 * @property {"weakened"|"removed"|"exemption-added"|"file-deleted"|"allow-added"|"unparseable"|"unparseable-baseline"} type
 *   Which ratchet rule the change violated
 * @property {number|string} [base] Baseline value
 * @property {number|string} [current] Current value
 * @property {string} message Operator-readable explanation
 */

/**
 * Build the "file could not be parsed" finding.
 * @param {string} relPath Repo-relative path
 * @returns {Finding} The unparseable-file finding
 */
function unparseable(relPath) {
  return {
    file: relPath,
    key: "*",
    type: "unparseable",
    message: `${relPath} is no longer valid JSON — a broken gate file disables the gate.`,
  };
}

/**
 * Build the "baseline could not be parsed" finding.
 *
 * Separate from `unparseable` because the two send an operator to different
 * files. Told only that `vitest.thresholds.json` is not valid JSON, they open
 * the current file, find it well-formed, and conclude the gate is broken; the
 * defect is at the base ref.
 * @param {string} relPath Repo-relative path
 * @returns {Finding} The unparseable-baseline finding
 */
function unparseableBaseline(relPath) {
  return {
    file: relPath,
    key: "*",
    type: "unparseable-baseline",
    message: `${relPath} is not valid JSON in the baseline — with no baseline to compare against, the ratchet cannot see a loosening in this file and will not see one in any later change either, until the baseline is repaired. A UTF-8 BOM, a trailing comma or an empty file all land here.`,
  };
}

/**
 * Compare two constraint maps: report removals and direction violations.
 * @param {string} relPath Repo-relative path the constraints came from
 * @param {Map<string, { value: number, direction: "min"|"max" }>} base
 *   Baseline constraints
 * @param {Map<string, { value: number, direction: "min"|"max" }>} current
 *   Current constraints
 * @returns {Finding[]} One finding per removed or weakened constraint
 */
export function compareConstraints(relPath, base, current) {
  const findings = [];
  for (const [key, baseC] of base) {
    const currentC = current.get(key);
    if (!currentC) {
      findings.push({
        file: relPath,
        key,
        type: "removed",
        base: baseC.value,
        message: `${relPath}: ${key} was removed — the tuned floor would silently fall back to a default.`,
      });
      continue;
    }
    // A bound's DIRECTION carries as much of the gate as its number. Flipping
    // `rate>=0.99` to `rate<=0.99` keeps the key and the value and inverts the
    // meaning: "at least 99% success" becomes "at most 99% success", a gate
    // that now passes when the system is broken. Comparing only values, that
    // read as unchanged.
    //
    // Rejected rather than re-evaluated in the new direction, because the two
    // bounds are not commensurable — there is no value at which `<=0.99` is
    // "no weaker than" `>=0.99`. The honest verdict is that the change cannot
    // be proven safe, so it belongs in the existing allow-list path where a
    // human records why, not in a comparison that would have to invent an
    // ordering between incomparable gates.
    if (currentC.direction !== baseC.direction) {
      findings.push({
        file: relPath,
        key,
        type: TYPE_WEAKENED,
        base: baseC.value,
        current: currentC.value,
        message: `${relPath}: ${key} changed bound direction (${baseC.direction} → ${currentC.direction}) — the gate's meaning is inverted, so preserving it cannot be proven from the value alone.`,
      });
      continue;
    }
    const weakened =
      baseC.direction === "min"
        ? currentC.value < baseC.value
        : currentC.value > baseC.value;
    if (weakened) {
      const verb =
        baseC.direction === "min" ? "may only increase" : "may only decrease";
      findings.push({
        file: relPath,
        key,
        type: TYPE_WEAKENED,
        base: baseC.value,
        current: currentC.value,
        message: `${relPath}: ${key} changed ${baseC.value} → ${currentC.value} (this value ${verb}).`,
      });
    }
  }
  return findings;
}

/**
 * Compare a stryker.conf.json pair: the break threshold plus mutate-list
 * exemptions (new negations or removed targets shrink the gate).
 * @param {string} relPath Repo-relative path
 * @param {unknown} base Parsed baseline config
 * @param {unknown} current Parsed current config
 * @returns {Finding[]} Break-threshold and mutate-scope findings
 */
function compareStryker(relPath, base, current) {
  const findings = compareConstraints(
    relPath,
    extractStrykerConstraints(base),
    extractStrykerConstraints(current)
  );
  const baseMutate = extractStrykerMutate(base);
  const currentMutate = extractStrykerMutate(current);
  for (const negation of currentMutate.negations) {
    if (!baseMutate.negations.has(negation)) {
      findings.push({
        file: relPath,
        key: `mutate ${negation}`,
        type: TYPE_EXEMPTION_ADDED,
        message: `${relPath}: new mutation-testing exclusion "${negation}" — excluding files from a gate is a weakening.`,
      });
    }
  }
  for (const positive of baseMutate.positives) {
    if (!currentMutate.positives.has(positive)) {
      findings.push({
        file: relPath,
        key: `mutate ${positive}`,
        type: TYPE_EXEMPTION_ADDED,
        message: `${relPath}: mutation-testing target "${positive}" was removed — shrinking a gate's coverage is a weakening.`,
      });
    }
  }
  return findings;
}

/**
 * Compare a k6 thresholds pair: numeric bounds plus abortOnFail downgrades.
 * @param {string} relPath Repo-relative path
 * @param {unknown} base Parsed baseline thresholds
 * @param {unknown} current Parsed current thresholds
 * @returns {Finding[]} Bound and abortOnFail findings
 */
function compareK6(relPath, base, current) {
  const baseC = extractK6Constraints(base);
  const currentC = extractK6Constraints(current);
  const findings = compareConstraints(relPath, baseC.numeric, currentC.numeric);
  for (const [key, wasOn] of baseC.booleans) {
    // k6 defaults abortOnFail to false, so DELETING an explicit `true` is as
    // much a weakening as flipping it — anything but a current `true` blocks.
    if (wasOn && currentC.booleans.get(key) !== true) {
      findings.push({
        file: relPath,
        key,
        type: TYPE_WEAKENED,
        base: "true",
        current: "false",
        message: `${relPath}: ${key} turned off — the gate no longer stops the run on failure.`,
      });
    }
  }
  return findings;
}

/**
 * Compare .lisa.config.json allow lists: report added exception entries so a
 * change can never grant itself an exception.
 * @param {string} relPath Repo-relative path
 * @param {unknown} base Parsed baseline config
 * @param {unknown} current Parsed current config
 * @returns {Finding[]} One finding per newly added allow entry
 */
function compareAllowList(relPath, base, current) {
  const baseKeys = new Set(
    extractAllowEntries(base).map(e => `${e.file} ${e.key}`)
  );
  const findings = [];
  for (const entry of extractAllowEntries(current)) {
    if (!baseKeys.has(`${entry.file} ${entry.key}`)) {
      findings.push({
        file: relPath,
        key: `thresholdRatchet.allow ${entry.file}#${entry.key}`,
        type: "allow-added",
        message: `${relPath}: new threshold exception — ${describeAllowScope(entry)}. Exceptions are a human decision: land this entry in its own human-approved change first, then make the threshold change. It needs a reason saying what resolves it and an "until": "YYYY-MM-DD" naming the day it is reviewed, because an exemption that cannot end is a permanent reduction in what the ratchet covers.`,
      });
    }
  }
  return findings;
}

/**
 * Compare one watched file's baseline and current contents and report every
 * weakening. Pure: no filesystem or git access.
 * @param {string} relPath Repo-relative path (forward slashes)
 * @param {string | null} baselineText Baseline contents (null = file is new)
 * @param {string | null} currentText Current contents (null = file deleted)
 * @returns {Finding[]} Every ratchet violation in the change (empty = clean)
 */
export function compareFile(relPath, baselineText, currentText) {
  const family = familyFor(relPath);
  if (!family || baselineText === null || baselineText === undefined) return [];

  if (currentText === null || currentText === undefined) {
    if (family.kind === KIND_ALLOW_LIST) return [];
    return [
      {
        file: relPath,
        key: "*",
        type: "file-deleted",
        message: `${relPath} was deleted — deleting a quality gate is a weakening.`,
      },
    ];
  }

  if (family.kind === "rubocop-yaml") {
    return compareConstraints(
      relPath,
      extractRubocopThresholds(baselineText, family.direction),
      extractRubocopThresholds(currentText, family.direction)
    );
  }

  const base = parseJson(baselineText);
  const current = parseJson(currentText);
  // Both sides are reported, and both used to not be. An unparseable baseline
  // returned no findings at all, which did not merely miss one change: once a
  // malformed threshold file is on the base branch, every later pull request
  // compares against a baseline that yields no constraints, so the ratchet
  // stops having an opinion about that file — permanently, and in silence.
  //
  // This is only reached for a file that EXISTS at the baseline and did not
  // parse. A file absent from the base ref arrives as a null `baselineText`
  // and returned above: new gate files have nothing to weaken, and the caller
  // separates absent from present-but-unreadable with `cat-file -e` before
  // calling.
  //
  // The allow-list carve-out is symmetric with the current side and holds for
  // the same reason: an allow list nobody can read grants no exceptions, so an
  // unreadable one on either side already fails closed. Reporting it would
  // block every change touching the file without making anything safer.
  if (base === undefined) {
    return family.kind === KIND_ALLOW_LIST
      ? []
      : [unparseableBaseline(relPath)];
  }
  if (current === undefined) {
    return family.kind === KIND_ALLOW_LIST ? [] : [unparseable(relPath)];
  }
  switch (family.kind) {
    case "json-num":
      return compareConstraints(
        relPath,
        extractNumericLeaves(base, family.direction),
        extractNumericLeaves(current, family.direction)
      );
    case "stryker":
      return compareStryker(relPath, base, current);
    case "k6":
      return compareK6(relPath, base, current);
    case "lighthouse":
      return compareConstraints(
        relPath,
        extractLighthouseAssertions(base),
        extractLighthouseAssertions(current)
      );
    case KIND_ALLOW_LIST:
      return compareAllowList(relPath, base, current);
    default:
      return [];
  }
}

/**
 * Whether an allow entry's file and key cover a finding.
 * @param {{ file: string, key: string }} entry An allow entry
 * @param {Finding} finding A finding from the change
 * @returns {boolean} True when the entry's scope reaches this finding
 */
function entryCovers(entry, finding) {
  return (
    (finding.file === entry.file || finding.file.endsWith(`/${entry.file}`)) &&
    (entry.key === "*" || entry.key === finding.key)
  );
}

/**
 * Report the allow entries a human has to act on, whether or not this change
 * touched anything they cover.
 *
 * Separate from {@link applyAllowList} because the two answer different
 * questions and only one of them depends on the change under review. An
 * exemption that has outlived its condition is dead weight the moment the
 * condition passes — the way `_thresholdsDivergence` is stale the moment the
 * two floors agree — and saying so is not conditional on anybody happening to
 * touch the gate it covered.
 * @param {Array<{ file: string, key: string, reason?: string, until?: unknown }>} allowEntries
 *   The allow list being honoured
 * @param {number} [now] Clock reading, injected so the check is deterministic
 * @returns {string[]} One line per entry that is expired or unevaluable; empty
 *   when every entry still names a condition that holds
 */
export function describeAllowList(allowEntries, now = Date.now()) {
  const lines = [];
  for (const entry of allowEntries) {
    const { state, detail } = classifyAllowEntry(entry, now);
    if (state !== ALLOW_STATE.LIVE) lines.push(detail);
  }
  return lines;
}

/**
 * Drop findings covered by a LIVE baseline-side allow entry.
 *
 * Three ways a finding leaves here, and they are deliberately distinct:
 *
 *   allowed  a covering entry's condition still holds. Reported, not blocked —
 *            a project mid-migration is not red-walled by expiry.
 *   expired  every covering entry's condition has passed. The weakening the
 *            entry used to permit is REFUSED again, and the refusal names the
 *            entry, its scope, its reason and the remedy. An expiry that
 *            lapsed into "allowed" would be worse than no expiry.
 *   blocked  nothing covered it, or everything that covered it has expired.
 *
 * An entry whose condition nothing can evaluate counts as covering, so the
 * allow list keeps working for entries written before `until` existed;
 * `describeAllowList` reports those every run instead.
 *
 * `allow-added` findings are never dropped, by any entry in any state — an
 * exception cannot approve its own creation, which is the baseline-side fence
 * and is untouched here.
 * @param {Finding[]} findings All findings from the change
 * @param {Array<{ file: string, key: string, reason?: string, until?: unknown }>} allowEntries
 *   Baseline (already-merged) allow list
 * @param {number} [now] Clock reading, injected so the check is deterministic
 * @returns {{
 *   blocked: Finding[],
 *   allowed: Array<{ finding: Finding, entry: { file: string, key: string }, message: string }>,
 *   expired: Array<{ finding: Finding, entry: { file: string, key: string }, message: string }>,
 * }} Findings that still block, findings a live exemption covers, and the
 *   refusals produced by exemptions that have ended
 */
export function applyAllowList(findings, allowEntries, now = Date.now()) {
  const classified = allowEntries.map(entry => ({
    entry,
    ...classifyAllowEntry(entry, now),
  }));
  const blocked = [];
  const allowed = [];
  const expired = [];
  for (const finding of findings) {
    const covering =
      finding.type === "allow-added"
        ? []
        : classified.filter(c => entryCovers(c.entry, finding));
    const live = covering.find(c => c.state !== ALLOW_STATE.EXPIRED);
    if (live) {
      allowed.push({
        finding,
        entry: live.entry,
        message: `allowed by ${live.scope}, which ${live.summary}. It covers: ${finding.message}`,
      });
      continue;
    }
    blocked.push(finding);
    for (const dead of covering) {
      expired.push({
        finding,
        entry: dead.entry,
        message: `${dead.detail} It used to cover: ${finding.message}`,
      });
    }
  }
  return { blocked, allowed, expired };
}

/**
 * Render the operator-facing block message.
 * @param {Finding[]} findings Blocked findings
 * @returns {string} Multi-line report explaining what weakened and the
 *   human-approved exception path
 */
export function formatReport(findings) {
  return [
    "⛔ Quality gate weakened — blocked by the threshold ratchet.",
    "",
    ...findings.map(f => `  • ${f.message}`),
    "",
    "Quality thresholds are a one-way ratchet: they may tighten but never",
    "loosen. Fix the code so it meets the current gate instead of lowering the",
    "gate. If a human decides an exception is genuinely correct, they record it",
    "in .lisa.config.json under thresholdRatchet.allow — with a reason saying",
    'what resolves it, and an "until": "YYYY-MM-DD" naming the day it is',
    "reviewed — in a separate human-approved change; this check honors an",
    "exception only after it is merged, and only until its until date passes.",
  ].join("\n");
}
