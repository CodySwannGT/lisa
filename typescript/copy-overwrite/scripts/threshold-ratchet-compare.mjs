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
        message: `${relPath}: new threshold exception for ${entry.file} → ${entry.key}. Exceptions are a human decision: land this entry in its own human-approved change first, then make the threshold change.`,
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
 * Drop findings covered by baseline-side allow entries. `allow-added`
 * findings are never dropped — an exception cannot approve its own creation.
 * @param {Finding[]} findings All findings from the change
 * @param {Array<{ file: string, key: string }>} allowEntries Baseline
 *   (already-merged) allow list
 * @returns {{ blocked: Finding[], allowed: Finding[] }} Findings that still
 *   block vs. findings covered by a recorded exception
 */
export function applyAllowList(findings, allowEntries) {
  const blocked = [];
  const allowed = [];
  for (const finding of findings) {
    const isAllowed =
      finding.type !== "allow-added" &&
      allowEntries.some(
        e =>
          (finding.file === e.file || finding.file.endsWith(`/${e.file}`)) &&
          (e.key === "*" || e.key === finding.key)
      );
    if (isAllowed) allowed.push(finding);
    else blocked.push(finding);
  }
  return { blocked, allowed };
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
    "in .lisa.config.json under thresholdRatchet.allow (with a reason) in a",
    "separate human-approved change; this check honors exceptions only after",
    "they are merged.",
  ].join("\n");
}
