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
 * A document's usage ledger, when it has a readable one with entries.
 * @param {unknown} document - Item body or comment.
 * @returns {{entries: object[], rollup: object} | null} The ledger, or null.
 */
function readLedger(document) {
  if (typeof document !== "string" || !document.includes(LISA_USAGE_HEADING))
    return null;
  try {
    const { entries, rollup } = parseLisaUsageSection(document);
    return entries.length && rollup ? { entries, rollup } : null;
  } catch {
    return null;
  }
}

/**
 * One ledger's complete token total. It is unknown when any run it counts has
 * no token count (`unavailable` telemetry) or only part of one (a measured
 * subset): the rollup's own total adds up only the runs it knows, which is a
 * partial sum, not the actual.
 * @param {{entries: object[], rollup: object}} ledger - Parsed ledger.
 * @returns {number | null} Total, or null when unknown.
 */
function ledgerTokens({ entries, rollup }) {
  const unknownRun = entries.some(
    entry =>
      entry.totalTokens === null ||
      entry.source === "measured-subset" ||
      (entry.measuredSubsetTokens ?? null) !== null
  );
  const unknownChildren =
    rollup.childTokensIncomplete === true ||
    (rollup.childEntryIds.length > 0 && rollup.childTokens === null);
  return unknownRun || unknownChildren ? null : rollup.totalTokens;
}

/**
 * One ledger's complete cost, unknown when any run it counts is unpriced.
 * @param {{entries: object[], rollup: object}} ledger - Parsed ledger.
 * @returns {number | null} Total cost, or null when unknown.
 */
function ledgerCost({ entries, rollup }) {
  const unpricedRun = entries.some(entry => entry.cost === null);
  const unpricedChildren =
    rollup.childEntryIds.length > 0 && rollup.childCost === null;
  return unpricedRun || unpricedChildren || rollup.currency === MIXED_CURRENCY
    ? null
    : rollup.totalCost;
}

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
 * The ledgers that hold distinct runs. A ledger whose runs were all counted
 * already is a copy and is skipped; one that repeats only some of them makes
 * the total ambiguous.
 * @param {{entries: object[], rollup: object}[]} ledgers - Parsed ledgers, body first.
 * @returns {{ledgers: object[], ids: Set<string>, ambiguous: boolean}} Distinct ledgers and the run ids they cover.
 */
function distinctLedgers(ledgers) {
  const ids = new Set();
  const kept = [];
  let ambiguous = false;
  for (const ledger of ledgers) {
    const own = [
      ...ledger.entries.map(entry => entry.entryId),
      ...ledger.rollup.childEntryIds,
    ];
    const repeated = own.filter(id => ids.has(id)).length;
    if (repeated === own.length) continue;
    ambiguous ||= repeated > 0;
    for (const id of own) ids.add(id);
    kept.push(ledger);
  }
  return { ledgers: kept, ids, ambiguous };
}

/**
 * The actual spend across every usage ledger the item carries: the body's and
 * any comment's. Completion accepts a run recorded in either place, so the
 * actual counts both. A total is unknown, never a partial sum, when any run
 * behind it is unknown.
 * @param {string[]} documents - Item body, then its comments.
 * @returns {import("./work-item-estimate-actual.mjs").Actual | null} The actual, or null when no ledger has an entry.
 */
export function ledgerActual(documents) {
  const { ledgers, ids, ambiguous } = distinctLedgers(
    documents.map(readLedger).filter(ledger => ledger !== null)
  );
  if (ledgers.length === 0) return null;
  const tokens = ledgers.map(ledgerTokens);
  const costs = ledgers.map(ledgerCost);
  const currencies = new Set(
    ledgers.map(ledger => ledger.rollup.currency).filter(Boolean)
  );
  const currency =
    currencies.size > 1
      ? MIXED_CURRENCY
      : (currencies.values().next().value ?? null);
  return {
    tokens:
      ambiguous || tokens.includes(null)
        ? null
        : tokens.reduce((sum, value) => sum + value, 0),
    cost:
      ambiguous || costs.includes(null) || currencies.size > 1
        ? null
        : addAmounts(costs),
    currency,
    sources: [
      ...new Set(
        ledgers.flatMap(ledger => ledger.entries.map(entry => entry.source))
      ),
    ].sort(),
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
 * @returns {{tokens: string, cost: string, currency: string} | null} Raw recorded fields.
 */
function recordedActual(section) {
  const fields = actualTokenFields(section);
  if (!fields) return null;
  try {
    return {
      tokens: fields.tokens,
      cost: fields.cost,
      currency: decodeURIComponent(fields.currency ?? "null"),
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
  };
  return recorded.tokens === current.tokens &&
    recorded.cost === current.cost &&
    recorded.currency === current.currency
    ? []
    : [
        `The actual tally is stale: it records ${recorded.tokens} tokens and ${recorded.cost} ${recorded.currency}, but the usage ledger now totals ${current.tokens} tokens and ${current.cost} ${current.currency}. Run lisa-estimate tally again.`,
      ];
}
