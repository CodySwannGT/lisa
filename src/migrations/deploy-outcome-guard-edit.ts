/**
 * The text surgery behind `ensure-deploy-outcome-guard` (CodySwannGT/lisa#3740).
 *
 * Separated from the migration class so the editing rules can be driven
 * directly by tests: what this decides is which host workflows it is willing to
 * touch, and that judgement is the risky half of the migration, not the file
 * I/O around it.
 *
 * ## Two edits, or neither
 *
 * Repairing this defect means suppressing GitHub's implicit `success()` so the
 * deploy job RUNS when the release failed, and adding a first step that fails
 * it loudly. Doing only the first would be **worse than the bug**: a deploy job
 * that runs on a failed release with nothing checking the release result would
 * attempt to ship. So the two edits are produced together or the file is left
 * alone, and a caller cannot obtain one without the other.
 *
 * ## The guard body is read, never written
 *
 * The step this inserts is lifted verbatim out of Lisa's own shipped deploy
 * template. Hardcoding it here would create a fourth copy of a body that
 * `tests/integration/deploy-outcome-guard.test.ts` exists to keep identical
 * across three — and a copy that test cannot see, which is the shape this
 * repository keeps paying for. If the template cannot be read, the migration
 * declines rather than writing something it made up.
 *
 * ## What it refuses
 *
 * A condition it cannot rewrite without guessing is declined, and the doctor
 * finding reports it instead. Two rewrites are accepted and no others:
 *
 * 1. A condition that never mentions the release result — safe to wrap, since
 *    `!cancelled() && (original)` cannot change what the original decides.
 * 2. A flat top-level `&&` chain containing `needs.<release>.result ==
 *    'success'` — the conjunct is dropped and `!cancelled()` prepended.
 *
 * Anything else, including that conjunct nested inside an `||`, is left to a
 * human. Dropping a term from inside a disjunction changes what the condition
 * means in ways this cannot check.
 *
 * ## The self-check
 *
 * Every rewrite is fed back through the same analysis that found the defect,
 * and a rewrite that does not come back `independent` is discarded. A repair
 * that does not repair is refused rather than written.
 * @module migrations/deploy-outcome-guard-edit
 */
import { tokenize } from "../core/github-actions-condition.js";
import {
  type DependenceJob,
  releaseDependence,
} from "../core/deploy-release-dependence.js";

/** The guard step's `name:`, identical in every shipped deploy workflow. */
export const GUARD_STEP_NAME = "🚨 Confirm the release shipped";

/** The status function that suppresses GitHub's implicit `success()`. */
const SUPPRESSOR = "!cancelled()";

/** Tokens that take no space before them when a condition is re-rendered. */
const NO_SPACE_BEFORE = new Set([")", ",", "=="]);

/** Tokens that take no space after them when a condition is re-rendered. */
const NO_SPACE_AFTER = new Set(["(", "!", "=="]);

/**
 * Strip a `${{ }}` wrapper and surrounding whitespace from a condition.
 * @param condition - The raw `if:` text
 * @returns The bare expression
 */
function bareExpression(condition: string): string {
  return condition
    .trim()
    .replace(/^\$\{\{/, "")
    .replace(/\}\}$/, "")
    .trim();
}

/**
 * Re-render a token run as expression text.
 * @param tokens - The tokens, in order
 * @returns Readable expression text
 */
function render(tokens: readonly string[]): string {
  return tokens
    .reduce((text, token, index) => {
      const previous = tokens[index - 1];
      const glued =
        index === 0 ||
        NO_SPACE_BEFORE.has(token) ||
        (previous !== undefined && NO_SPACE_AFTER.has(previous));
      return glued ? text + token : `${text} ${token}`;
    }, "")
    .replace(/ == /g, " == ")
    .trim();
}

/**
 * Split a condition into its top-level `&&` conjuncts.
 * @param tokens - The tokenized condition
 * @returns The conjuncts, or null when the expression is not a flat `&&` chain
 */
function topLevelConjuncts(
  tokens: readonly string[]
): readonly (readonly string[])[] | null {
  const split = tokens.reduce<{
    readonly depth: number;
    readonly parts: readonly (readonly string[])[];
    readonly current: readonly string[];
    readonly flat: boolean;
  }>(
    (state, token) => {
      const depth =
        token === "("
          ? state.depth + 1
          : token === ")"
            ? state.depth - 1
            : state.depth;
      if (state.depth === 0 && token === "||") {
        return { ...state, depth, flat: false };
      }
      if (state.depth === 0 && token === "&&") {
        return {
          depth,
          parts: [...state.parts, state.current],
          current: [],
          flat: state.flat,
        };
      }
      return { ...state, depth, current: [...state.current, token] };
    },
    { depth: 0, parts: [], current: [], flat: true }
  );
  if (!split.flat) return null;
  return [...split.parts, split.current].filter(part => part.length > 0);
}

/**
 * Whether a conjunct is exactly `needs.<release>.result == 'success'`.
 * @param conjunct - One top-level conjunct's tokens
 * @param release - The upstream release job's id
 * @returns True when the conjunct is the hand-written success gate
 */
function isReleaseSuccessGate(
  conjunct: readonly string[],
  release: string
): boolean {
  return (
    conjunct.length === 3 &&
    conjunct[0] === `needs.${release}.result` &&
    conjunct[1] === "==" &&
    conjunct[2] === "'success'"
  );
}

/**
 * Rewrite one job's condition so a failed release no longer skips it.
 * @param job - The deploy job as parsed
 * @param release - The upstream release job's id
 * @returns The new condition text, or null when it must be left to a human
 */
export function rewrittenCondition(
  job: DependenceJob,
  release: string
): string | null {
  const rewritten = proposedCondition(job, release);
  if (rewritten === null) return null;
  // The self-check: a rewrite that does not actually make the job independent
  // of the release result is discarded rather than written.
  return releaseDependence({ ...job, ifCondition: rewritten }, release).kind ===
    "independent"
    ? rewritten
    : null;
}

/**
 * Propose a rewrite, before the self-check decides whether to keep it.
 * @param job - The deploy job as parsed
 * @param release - The upstream release job's id
 * @returns The candidate condition, or null when no rule applies
 */
function proposedCondition(job: DependenceJob, release: string): string | null {
  const original = bareExpression(job.ifCondition);
  if (original === "") return SUPPRESSOR;
  const gate = `needs.${release}.result`;
  if (!original.includes(gate)) {
    return `${SUPPRESSOR} && (${original})`;
  }
  const conjuncts = topLevelConjuncts(tryTokenize(original) ?? []);
  if (conjuncts === null || conjuncts.length === 0) return null;
  const kept = conjuncts.filter(
    conjunct => !isReleaseSuccessGate(conjunct, release)
  );
  // Every remaining conjunct must be free of the release result: one nested
  // inside parentheses is exactly the case this refuses to reason about.
  if (kept.length === conjuncts.length) return null;
  if (kept.some(conjunct => conjunct.some(token => token === gate)))
    return null;
  return [SUPPRESSOR, ...kept.map(render)].join(" && ");
}

/**
 * Tokenize, returning null instead of throwing on an unsupported expression.
 * @param expression - The bare expression text
 * @returns The tokens, or null when the expression cannot be read
 */
function tryTokenize(expression: string): readonly string[] | null {
  try {
    return tokenize(expression);
  } catch {
    return null;
  }
}
