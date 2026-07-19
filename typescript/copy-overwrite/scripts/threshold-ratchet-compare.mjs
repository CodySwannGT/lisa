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
  extractExemptionEntries,
  extractK6Constraints,
  extractNumericLeaves,
  extractRubocopThresholds,
  extractStrykerConstraints,
  extractStrykerMutate,
  familyFor,
  parseJson,
} from "./threshold-ratchet-families.mjs";

/** Finding type: a numeric bound or boolean gate moved the weakening way. */
const TYPE_WEAKENED = "weakened";
/** Finding type: an exemption entry was added (Tier 3). */
const TYPE_EXEMPTION_ADDED = "exemption-added";
/** Family kind for .lisa.config.json (the thresholdRatchet.allow carrier). */
const KIND_ALLOW_LIST = "allow-list";

/**
 * @typedef {object} Finding
 * @property {string} file Repo-relative path of the gate file
 * @property {string} key Dotted key path within the file
 * @property {"weakened"|"removed"|"exemption-added"|"file-deleted"|"allow-added"|"unparseable"} type
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
    if (wasOn && currentC.booleans.get(key) === false) {
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
 * Compare an exemption-list pair (audit ignore files): report added entries.
 * @param {string} relPath Repo-relative path
 * @param {unknown} base Parsed baseline list
 * @param {unknown} current Parsed current list
 * @returns {Finding[]} One finding per newly added ignore entry
 */
function compareExemptions(relPath, base, current) {
  const baseEntries = extractExemptionEntries(base);
  const findings = [];
  for (const entry of extractExemptionEntries(current)) {
    if (!baseEntries.has(entry)) {
      findings.push({
        file: relPath,
        key: entry,
        type: TYPE_EXEMPTION_ADDED,
        message: `${relPath}: new security-audit ignore entry "${entry}" — ignoring a finding weakens the gate and needs a human's sign-off.`,
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
  if (base === undefined) return [];
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
    case "exemption-list":
      return compareExemptions(relPath, base, current);
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
