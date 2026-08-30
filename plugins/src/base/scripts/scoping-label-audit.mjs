#!/usr/bin/env node
/**
 * Scoping-label smell detection for `/lisa:validate-tracker-mapping` (#3420).
 *
 * ## The gap this closes
 *
 * The mapping audit walks LIFECYCLE roles only — every pair it checks comes
 * from a `(role, configured-name)` mapping declared in `.lisa.config.json`
 * (`jira.workflow`, `github.labels.build`, `github.labels.prd`, and friends).
 * The SCOPING vocabulary (`type:`, `priority:`, `points:`, `component:`) is
 * declared in no config key at all, so there is no configured name to compare a
 * live name against. The audit was not failing to check those labels; it had
 * nothing to check them with.
 *
 * That matters because `lisa-github-write-issue` instructs the write path to
 * `gh label create` any label it needs, which is correct for bootstrapping a
 * fresh repo and makes the scoping vocabulary unbounded and self-expanding.
 * Every typo becomes a permanent new label, and two labels meaning one thing
 * silently split every query that filters on them — including the
 * `--label "component:<component>"` related-work query that same skill runs.
 *
 * ## Report shape, not membership (owner ruling, 2026-08-29)
 *
 * Lisa asserts no authority over a project's label vocabularies. `component:`
 * is open BY DESIGN — an open vocabulary has no wrong member, only inconsistent
 * ones — so this module reports SMELLS, not violations. `type:` and `priority:`
 * are the exception: they are closed sets already enumerated by
 * `lisa-github-write-issue`, so membership there is checked against the
 * declared set and costs nothing extra.
 *
 * **Advisory only. This is not a gate and must not become one.** A heuristic
 * that guesses at synonyms will be wrong sometimes, and a wrong gate is worse
 * than no gate. Every finding carries `severity: "advisory"`, the CLI always
 * exits 0, and callers must leave the audit's verdict and exit status
 * untouched by anything in here.
 *
 * ## Why rarity AND proximity, never either alone
 *
 * The ruling names two component smells — "a value used exactly once while a
 * near-neighbour is well established" and "two values within a small edit
 * distance of each other". Implemented as two independent rules, the second
 * one fires forever on healthy repositories: measured on this repository's own
 * live labels, `component:ci` (238 issues) and `component:cli` (103 issues) sit
 * at edit distance 1 and are genuinely distinct components. A finding that
 * cannot be acted on and cannot be silenced is noise, and noise is how an
 * advisory report gets ignored wholesale.
 *
 * So the two are one rule with both conditions required: a RARE value that has
 * an ESTABLISHED near neighbour. That also satisfies the ruling's own
 * counter-example — a single-use `component:billing` with no near neighbour is
 * NOT reported, because rarity alone is not evidence of a synonym.
 *
 * ## Where the closed sets come from
 *
 * `lisa-github-write-issue` is the authority, and it is quoted here rather than
 * re-decided. Its CREATE-time field table is the operative list, because that
 * is the one the write path is told to satisfy.
 * `scoping-label-vocabulary-contract.test.ts` asserts the literal below equals
 * both of the skill's tables, so it cannot drift away from them.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Scoping labels are `<family>:<value>`; these are the families audited. */
export const SCOPING_LABEL_FAMILIES = Object.freeze([
  "type",
  "priority",
  "points",
  "component",
]);

/**
 * The closed issue-type vocabulary, verbatim from `lisa-github-write-issue`'s
 * CREATE-time field table.
 *
 * `Task` belongs here. Issue #3420's own summary table omitted it, but the
 * skill's CREATE row lists it and this repository carries 91 issues labelled
 * `type:Task` — encoding the shorter list would have opened the audit by
 * reporting 91 correctly-labelled issues as vocabulary violations.
 */
export const CLOSED_TYPE_VOCABULARY = Object.freeze([
  "Epic",
  "Story",
  "Task",
  "Bug",
  "Sub-task",
  "Spike",
  "Improvement",
]);

/**
 * The closed priority vocabulary, verbatim from `lisa-github-write-issue`.
 *
 * Four members, not three: the skill's Priority row is
 * `priority:<low|medium|high|critical>`.
 */
export const CLOSED_PRIORITY_VOCABULARY = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
]);

/**
 * The Fibonacci estimation scale `points:` conventionally follows.
 *
 * `points:` is an OPEN family — a project may legitimately estimate off-scale —
 * so a value outside this set is reported as a smell, never as invalid.
 */
export const FIBONACCI_POINT_SCALE = Object.freeze([1, 2, 3, 5, 8, 13, 21]);

/**
 * Usage count at or below which a value is RARE.
 *
 * The ruling says "used exactly once". Zero is included because a label that
 * exists in the repository's label set and was never applied carries the same
 * smell for the same reason — it was created on demand by a write path and
 * nothing has corroborated it since. A freshly bootstrapped repository where
 * every count is 0 still reports nothing, because nothing there is ESTABLISHED.
 */
export const RARE_USAGE_MAX = 1;

/** Minimum usage before a value can serve as the established side of a pair. */
export const ESTABLISHED_USAGE_FLOOR = 5;

/** How many times an established value must out-use the rare one beside it. */
export const ESTABLISHED_USAGE_FACTOR = 10;

/** Maximum Levenshtein distance at which two values are near neighbours. */
export const SYNONYM_EDIT_DISTANCE_MAX = 2;

/**
 * Shortest value length eligible for proximity matching.
 *
 * On a two- or three-character value a single edit is a whole different word,
 * not a typo — `ci` and `cli` again. Below this length, proximity carries no
 * signal, so short values are compared for equality only.
 */
export const SYNONYM_MIN_VALUE_LENGTH = 4;

/** Every finding this module can emit. Advisory, all of them. */
export const SCOPING_FINDING_KINDS = Object.freeze([
  "outside-vocabulary",
  "probable-synonym",
  "off-scale",
]);

/**
 * @typedef {{ readonly name?: string, readonly count?: number, readonly usage?: number }} LabelUsage
 *
 * @typedef {{
 *   readonly family: string
 *   readonly label: string
 *   readonly value: string
 *   readonly usage: number
 *   readonly kind: string
 *   readonly severity: "advisory"
 *   readonly detail: string
 *   readonly neighbour?: string
 *   readonly neighbourUsage?: number
 *   readonly distance?: number
 * }} ScopingFinding
 */

/**
 * Levenshtein edit distance between two strings.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} the minimum single-character edits between `a` and `b`
 */
export function editDistance(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const substitution =
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }

  return previous[right.length];
}

/**
 * Split a label name into its scoping family and value.
 *
 * Returns `null` for anything that is not `<audited-family>:<value>` — lifecycle
 * labels (`status:`, `prd-*`) and free-form labels are not this module's
 * business and must fall through untouched.
 *
 * @param {unknown} name
 * @returns {{ family: string, value: string } | null}
 */
export function parseScopingLabel(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) return null;
  const family = trimmed.slice(0, separator).toLowerCase();
  const value = trimmed.slice(separator + 1).trim();
  if (value.length === 0) return null;
  if (!SCOPING_LABEL_FAMILIES.includes(family)) return null;
  return { family, value };
}

/**
 * Audit a repository's scoping labels for consistency smells.
 *
 * Total and read-only: it mutates nothing, reaches nothing over the network,
 * and returns every finding it has rather than the first. `advisory` is on the
 * result as a standing reminder to callers — the ruling forbids this becoming
 * a gate, and the flag is what a caller asserts against.
 *
 * @param {{ readonly labels?: readonly (string | LabelUsage)[] }} input
 *   `labels` is the union of the repository's declared label set and the labels
 *   observed on its issues, each with the number of issues carrying it.
 * @returns {{
 *   readonly findings: readonly ScopingFinding[]
 *   readonly familiesWalked: readonly string[]
 *   readonly advisory: true
 * }}
 */
export function auditScopingLabels(input = {}) {
  const byFamily = groupByFamily(input.labels);

  const findings = [
    ...closedVocabularyFindings(byFamily.get("type") ?? [], {
      family: "type",
      allowed: CLOSED_TYPE_VOCABULARY,
      caseSensitive: true,
    }),
    ...closedVocabularyFindings(byFamily.get("priority") ?? [], {
      family: "priority",
      allowed: CLOSED_PRIORITY_VOCABULARY,
      caseSensitive: false,
    }),
    ...pointsScaleFindings(byFamily.get("points") ?? []),
    ...synonymFindings(byFamily.get("component") ?? [], "component"),
  ];

  return {
    findings,
    familiesWalked: SCOPING_LABEL_FAMILIES,
    advisory: true,
  };
}

/**
 * Normalize the caller's label list into `family -> [{ label, value, usage }]`.
 *
 * Duplicates collapse by keeping the highest usage seen: callers assemble the
 * list from two sources (the declared label set, which knows no counts, and the
 * issue scan, which does), and the counted entry is the informative one.
 *
 * @param {readonly (string | LabelUsage)[] | undefined} labels
 * @returns {Map<string, { label: string, value: string, usage: number }[]>}
 */
function groupByFamily(labels) {
  /** @type {Map<string, Map<string, { label: string, value: string, usage: number }>>} */
  const families = new Map();

  for (const entry of Array.isArray(labels) ? labels : []) {
    const name = typeof entry === "string" ? entry : entry?.name;
    const parsed = parseScopingLabel(name);
    if (!parsed) continue;

    const rawUsage =
      typeof entry === "string" ? 0 : (entry?.count ?? entry?.usage ?? 0);
    const usage =
      Number.isFinite(rawUsage) && rawUsage > 0 ? Number(rawUsage) : 0;

    if (!families.has(parsed.family)) families.set(parsed.family, new Map());
    const bucket = families.get(parsed.family);
    const existing = bucket.get(parsed.value);
    if (existing) {
      existing.usage = Math.max(existing.usage, usage);
      continue;
    }
    bucket.set(parsed.value, {
      label: `${parsed.family}:${parsed.value}`,
      value: parsed.value,
      usage,
    });
  }

  return new Map(
    [...families].map(([family, bucket]) => [family, [...bucket.values()]])
  );
}

/**
 * Report values outside a family's declared closed set.
 *
 * `type:` compares case-sensitively because its members are capitalized proper
 * nouns the write path emits verbatim (`type:Sub-task`), so `type:bug` is drift
 * worth seeing. `priority:` members are lowercase tokens where casing carries
 * no meaning.
 *
 * @param {readonly { label: string, value: string, usage: number }[]} values
 * @param {{ family: string, allowed: readonly string[], caseSensitive: boolean }} options
 * @returns {ScopingFinding[]}
 */
function closedVocabularyFindings(values, options) {
  const fold = value => (options.caseSensitive ? value : value.toLowerCase());
  const allowed = new Set(options.allowed.map(fold));

  return values
    .filter(entry => !allowed.has(fold(entry.value)))
    .map(entry => ({
      family: options.family,
      label: entry.label,
      value: entry.value,
      usage: entry.usage,
      kind: "outside-vocabulary",
      severity: /** @type {"advisory"} */ ("advisory"),
      detail:
        `"${entry.label}" is outside the declared ${options.family} vocabulary ` +
        `(${options.allowed.join(", ")}), which lisa-github-write-issue closes.`,
    }));
}

/**
 * Report `points:` values off the Fibonacci estimation scale.
 *
 * A non-numeric value is off-scale too — `points:xl` is a scale change, not an
 * estimate, and it breaks every query that sorts or sums on points.
 *
 * @param {readonly { label: string, value: string, usage: number }[]} values
 * @returns {ScopingFinding[]}
 */
function pointsScaleFindings(values) {
  return values
    .filter(entry => !FIBONACCI_POINT_SCALE.includes(Number(entry.value)))
    .map(entry => ({
      family: "points",
      label: entry.label,
      value: entry.value,
      usage: entry.usage,
      kind: "off-scale",
      severity: /** @type {"advisory"} */ ("advisory"),
      detail:
        `"${entry.label}" is off the Fibonacci estimation scale ` +
        `(${FIBONACCI_POINT_SCALE.join(", ")}). points is an open family, so ` +
        `this is a consistency smell, not an invalid value.`,
    }));
}

/**
 * Report rare values that look like typos of an established neighbour.
 *
 * Both conditions are required — see the module preamble on why an ungated
 * proximity rule reports healthy repositories forever. Each rare value is
 * reported at most once, against its closest established neighbour, so a value
 * near two established ones does not produce two findings saying the same
 * thing.
 *
 * @param {readonly { label: string, value: string, usage: number }[]} values
 * @param {string} family
 * @returns {ScopingFinding[]}
 */
function synonymFindings(values, family) {
  const established = values.filter(
    entry => entry.usage >= ESTABLISHED_USAGE_FLOOR
  );

  return values.flatMap(entry => {
    if (entry.usage > RARE_USAGE_MAX) return [];

    const neighbour = established
      .filter(candidate => candidate.value !== entry.value)
      .filter(
        candidate =>
          candidate.usage >= ESTABLISHED_USAGE_FACTOR * Math.max(entry.usage, 1)
      )
      .filter(
        candidate =>
          Math.max(candidate.value.length, entry.value.length) >=
          SYNONYM_MIN_VALUE_LENGTH
      )
      .map(candidate => ({
        candidate,
        distance: editDistance(
          candidate.value.toLowerCase(),
          entry.value.toLowerCase()
        ),
      }))
      .filter(pair => pair.distance <= SYNONYM_EDIT_DISTANCE_MAX)
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          right.candidate.usage - left.candidate.usage
      )[0];

    if (!neighbour) return [];

    return [
      {
        family,
        label: entry.label,
        value: entry.value,
        usage: entry.usage,
        kind: "probable-synonym",
        severity: /** @type {"advisory"} */ ("advisory"),
        detail:
          `"${entry.label}" is used ${entry.usage} time(s) and is ` +
          `${neighbour.distance} edit(s) from "${neighbour.candidate.label}", ` +
          `used ${neighbour.candidate.usage} time(s). ${family} is an open ` +
          `vocabulary, so this is a probable synonym to reconcile, not an ` +
          `invalid value — a human decides.`,
        neighbour: neighbour.candidate.label,
        neighbourUsage: neighbour.candidate.usage,
        distance: neighbour.distance,
      },
    ];
  });
}

/**
 * CLI: read `{ labels: [{ name, count }] }` on stdin, print the findings.
 *
 * Exits 0 unconditionally, including when findings exist. The ruling is that
 * this reports and a human decides; a non-zero exit would turn an advisory
 * heuristic into a gate the first time a caller ran it under `set -e`.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

  process.stdout.write(
    `${JSON.stringify(auditScopingLabels({ labels: payload.labels }), null, 2)}\n`
  );
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * Written out rather than imported: this is a plugin payload, which has no
 * `./lib/` to resolve against. Same rule and same reasoning as
 * `scripts/lib/invoked-as-script.mjs` and `lifecycle-label-trust.mjs`.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
