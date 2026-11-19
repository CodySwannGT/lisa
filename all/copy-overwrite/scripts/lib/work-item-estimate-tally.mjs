// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The completion tally: actual tokens and dollar cost next to the estimate
 * (CodySwannGT/lisa#4956).
 *
 * The actual is the work item's `## Lisa Usage` ledgers, the existing ledger
 * every agent already records its spend into, on the body and on any comment;
 * there is no second ledger. A total that any run leaves unknown
 * (`unavailable` telemetry, a measured subset) is shown as unknown, never as
 * zero, a partial sum or a guess. The tally is
 * written into the `## Lisa Estimate` section as an `Actual` row plus one
 * `<!-- lisa:estimate-actual ... -->` token, and the done gate checks that the
 * recorded tally still matches the ledger.
 * @module scripts/lib/work-item-estimate-tally
 */
import { LISA_USAGE_HEADING, parseLisaUsageSection } from "./usage-ledger.mjs";
import {
  actualTokenFields,
  renderActual,
} from "./work-item-estimate-actual.mjs";
import { EstimateConfigError } from "./work-item-estimate-config.mjs";
import {
  parseEstimateSection,
  renderEstimateSection,
  upsertEstimateSection,
} from "./work-item-estimate.mjs";

const NO_LEDGER =
  "No Lisa Usage entry is recorded on this item. It cannot reach done without one: record each run through lisa-usage-accounting (source unavailable is the honest value when the runtime gives no telemetry), then run lisa-estimate tally.";
const MIXED_CURRENCY = "mixed";
const COST_SCALE = 12;

/**
 * A document's usage ledger, when it has a readable one that records any run:
 * a direct entry, or child work its rollup carries (a parent whose only spend
 * is its children's has no direct entries of its own). A section without a
 * rollup token still has its direct entries counted, so no run vanishes from
 * the actual; it simply has no child aggregate.
 * @param {unknown} document - Item body or comment.
 * @returns {{entries: object[], children: object | null} | null} Direct entries and the rollup when it carries child work, or null.
 */
function readLedger(document) {
  if (typeof document !== "string" || !document.includes(LISA_USAGE_HEADING))
    return null;
  try {
    const { entries, rollup } = parseLisaUsageSection(document);
    const children = rollup?.childEntryIds.length ? rollup : null;
    return entries.length || children ? { entries, children } : null;
  } catch {
    return null;
  }
}

/**
 * Whether a run's token count is unknown or only part of the run.
 * @param {object} entry - Parsed usage entry.
 * @returns {boolean} True when the run has no full token count.
 */
const partialTokens = entry =>
  entry.totalTokens === null ||
  entry.source === "measured-subset" ||
  (entry.measuredSubsetTokens ?? null) !== null;

/**
 * Add decimal amounts without binary floating-point drift.
 * @param {number[]} amounts - Finite amounts.
 * @returns {number} Their sum.
 */
function addAmounts(amounts) {
  const scale = 10n ** BigInt(COST_SCALE);
  const total = amounts.reduce(
    (sum, amount) => sum + BigInt(amount.toFixed(COST_SCALE).replace(".", "")),
    0n
  );
  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const fraction = String(magnitude % scale).padStart(COST_SCALE, "0");
  return Number(`${negative ? "-" : ""}${magnitude / scale}.${fraction}`);
}

/**
 * Every distinct run the item's ledgers record, by run identity (entry id).
 * The same run written in two places (the body's ledger and an evidence
 * comment that repeats it) is counted once, so a comment that repeats the
 * body's runs and adds its own Verify run is an ordinary, complete layout.
 * Child work arrives only as each ledger's aggregate, which cannot be split:
 * a ledger's child runs are counted once when none was counted before,
 * skipped when every one was, and make the total ambiguous only when some
 * were counted and some were not.
 * @param {{entries: object[], children: object | null}[]} ledgers - Parsed ledgers, body first.
 * @returns {{runs: object[], children: object[], ids: Set<string>, ambiguous: boolean}} Distinct direct runs, child aggregates, every run id, and whether the total is ambiguous.
 */
function distinctRuns(ledgers) {
  const ids = new Set();
  const runs = [];
  const children = [];
  let ambiguous = false;
  for (const { entries } of ledgers)
    for (const entry of entries)
      if (!ids.has(entry.entryId)) {
        ids.add(entry.entryId);
        runs.push(entry);
      }
  for (const { children: rollup } of ledgers) {
    const own = rollup?.childEntryIds ?? [];
    const repeated = own.filter(id => ids.has(id)).length;
    if (own.length === 0 || repeated === own.length) continue;
    ambiguous ||= repeated > 0;
    for (const id of own) ids.add(id);
    children.push(rollup);
  }
  return { runs, children, ids, ambiguous };
}

/**
 * The actual spend across every usage ledger the item carries: the body's and
 * any comment's. Completion accepts a run recorded in either place, so the
 * actual counts every distinct run once. A total is unknown, never a partial
 * sum, when any run behind it is unknown or the runs cannot be told apart.
 * @param {string[]} documents - Item body, then its comments.
 * @returns {import("./work-item-estimate-actual.mjs").Actual | null} The actual, or null when no ledger has an entry.
 */
export function ledgerActual(documents) {
  const ledgers = documents.map(readLedger).filter(ledger => ledger !== null);
  if (ledgers.length === 0) return null;
  const { runs, children, ids, ambiguous } = distinctRuns(ledgers);
  const tokensKnown =
    !ambiguous &&
    !runs.some(partialTokens) &&
    children.every(
      child =>
        child.childTokensIncomplete !== true && child.childTokens !== null
    );
  const currencies = new Set([
    ...runs.map(entry => entry.currency).filter(Boolean),
    ...children.map(child => child.childCurrency).filter(Boolean),
  ]);
  const costKnown =
    !ambiguous &&
    currencies.size <= 1 &&
    !currencies.has(MIXED_CURRENCY) &&
    runs.every(entry => entry.cost !== null) &&
    children.every(child => child.childCost !== null);
  const currency =
    currencies.size > 1
      ? MIXED_CURRENCY
      : (currencies.values().next().value ?? null);
  return {
    tokens: tokensKnown
      ? [
          ...runs.map(entry => entry.totalTokens),
          ...children.map(child => child.childTokens),
        ].reduce((sum, value) => sum + value, 0)
      : null,
    cost: costKnown
      ? addAmounts([
          ...runs.map(entry => entry.cost),
          ...children.map(child => child.childCost),
        ])
      : null,
    currency,
    sources: [...new Set(runs.map(entry => entry.source))].sort(),
    entries: ids.size,
  };
}

/**
 * Rewrite the estimate section with the actual from the usage ledger.
 * @param {string} body - Item body.
 * @param {string[]} [documents] - Where the ledger may live: the body, then comments.
 * @returns {string} Updated body.
 */
export function tallyEstimate(body, documents = [body]) {
  const actual = ledgerActual(documents);
  if (!actual) throw new EstimateConfigError(NO_LEDGER);
  const { count, estimate } = parseEstimateSection(body);
  if (count > 1)
    throw new EstimateConfigError(
      "The body has more than one Lisa Estimate section; remove the extra copies first."
    );
  return upsertEstimateSection(
    body,
    renderEstimateSection(estimate, renderActual(actual, estimate))
  );
}

/**
 * The actual tally recorded in a section, as written.
 * @param {string | null} section - Estimate section text.
 * @returns {{tokens: string, cost: string, currency: string, sources: string, entries: string} | null} Raw recorded fields.
 */
function recordedActual(section) {
  const fields = actualTokenFields(section);
  if (!fields) return null;
  try {
    return {
      tokens: fields.tokens,
      cost: fields.cost,
      currency: decodeURIComponent(fields.currency ?? "null"),
      sources: decodeURIComponent(fields.sources ?? ""),
      entries: fields.entries ?? "null",
    };
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/**
 * Why an item may not reach done yet, from the estimate's point of view.
 * @param {string} body - Item body.
 * @param {string[]} [documents] - Where the ledger may live: the body, then comments.
 * @returns {string[]} Problems; empty when done may proceed.
 */
export function doneProblems(body, documents = [body]) {
  const actual = ledgerActual(documents);
  if (!actual) return [NO_LEDGER];
  const { count, section } = parseEstimateSection(body);
  if (count > 1)
    return [`The body has ${count} Lisa Estimate sections; keep exactly one.`];
  const recorded = recordedActual(section);
  if (!recorded)
    return [
      "The estimate does not yet show the actual tokens and cost. Run lisa-estimate tally and write the body back.",
    ];
  const current = {
    tokens: String(actual.tokens ?? "null"),
    cost: String(actual.cost ?? "null"),
    currency: actual.currency ?? "null",
    sources: actual.sources.join(","),
    entries: String(actual.entries),
  };
  // Every recorded field, not only the totals: two unavailable runs and one
  // both total null, so only the entry count tells them apart.
  return Object.keys(current).every(key => recorded[key] === current[key])
    ? []
    : [
        `The actual tally is stale: it records ${recorded.tokens} tokens and ${recorded.cost} ${recorded.currency} over ${recorded.entries} usage entries, but the usage ledger now totals ${current.tokens} tokens and ${current.cost} ${current.currency} over ${current.entries}. Run lisa-estimate tally again.`,
      ];
}
