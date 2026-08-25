/**
 * anchored-rewrite — make every step of a multi-step text transform
 * individually accountable (CodySwannGT/lisa#3081).
 *
 * @remarks
 * ## The defect this removes
 *
 * A transform with N anchored rewrites, guarded by comparing its finished
 * output to its input, passes as soon as **any one** step lands:
 *
 * ```ts
 * const out = source.replace(A, A2).replace(B, B2);
 * if (out === source) throw new Error("the rewrite no longer applies");
 * ```
 *
 * That guard asks "did something change". It cannot answer "did everything I
 * asked for happen". The N−1 other steps can silently stop matching and it
 * stays green — and it degrades in the direction nobody watches, because it was
 * written when N was 1, where the check is sound, and became unsound the moment
 * a second step was added without anyone noticing the question had changed
 * underneath them.
 *
 * It has already bitten this repository. CodySwannGT/lisa#2980 deleted the
 * import line that the FIRST rewrite of a test fixture anchored on. The second
 * rewrite still matched, so `out !== source`, so the guard passed — and the
 * fixture built a module referencing `fileURLToPath` without importing it.
 * Every case downstream then failed inside a module-resolution error, in a test
 * about repository layout, for a reason that had nothing to do with what it was
 * testing. The partially-applied output was not merely incomplete, it was
 * **invalid**, and it surfaced far from the guard that let it through.
 *
 * ## Why a helper rather than a convention
 *
 * The remedy — assert each anchor is present before replacing — is uniform and
 * cheap, and writing it by hand is three lines per step that read like noise.
 * An idiom is adopted when the safe form is the SHORTEST one to write, so this
 * module exists to make `replaceOrThrow(text, anchor, replacement, context)`
 * shorter than the unguarded `text.replace(anchor, replacement)` plus the
 * hand-rolled assertion it needs to be correct.
 *
 * ## The failure names the step
 *
 * "Something did not apply" is barely better than the guard it replaces: the
 * reader still has to find which of the N steps it means. Every failure here
 * names the anchor verbatim (truncated for legibility, never elided to a
 * count), the caller-supplied `context`, and the step's `label` or ordinal when
 * one is available. The replaced guard in #2980 said "the root default moved",
 * which was not what had happened and sent its reader to the wrong file.
 *
 * ## Optional steps are declared, not implied
 *
 * Some rewrites genuinely may or may not apply — reconciling a block that a
 * given host file may simply not have, for instance. A mechanism with no way to
 * say that is a mechanism people route around, and a routed-around guard
 * protects nothing. So `optional: true` is a first-class part of the rewrite
 * shape: it says "this step is allowed to find nothing", it is visible in
 * review, and it is visible to the `check:whole-output-guards` sweep, which
 * reads a declared-optional step as accounted for rather than as a finding.
 *
 * `optional` never suppresses a REQUIRED step's failure — each entry carries
 * its own flag, so one optional step in a list of four leaves the other three
 * fully enforced.
 * @module core/anchored-rewrite
 */

/** Longest anchor text quoted verbatim in a failure before truncation. */
const ANCHOR_EXCERPT_LIMIT = 120;

/** One anchored step of a multi-step transform. */
export interface Rewrite {
  /**
   * The text (or pattern) the step replaces. A string anchor replaces its
   * FIRST occurrence, matching `String.prototype.replace`; a regular
   * expression replaces according to its own flags.
   */
  readonly anchor: string | RegExp;
  /** What the anchor is replaced with. */
  readonly replacement: string;
  /**
   * Whether this step is allowed to find nothing. Defaults to `false` — a step
   * is REQUIRED unless it says otherwise, so forgetting the flag fails loudly
   * rather than silently weakening the guard.
   */
  readonly optional?: boolean;
  /**
   * Human-readable name for this step, quoted in the failure. Without one the
   * failure names the step by its 1-based position, which is usable but worse:
   * a position shifts when someone inserts a step above it.
   */
  readonly label?: string;
}

/**
 * A required anchored rewrite whose anchor was not present.
 *
 * Carries the anchor, label and context as fields as well as in the message so
 * a caller that wants to report the miss its own way does not have to parse
 * prose back out of a string.
 */
export class MissingAnchorError extends Error {
  /** The anchor that was not found, verbatim. */
  readonly anchor: string;

  /** The step's label, or its 1-based position when it had none. */
  readonly step: string;

  /** What the caller said it was transforming. */
  readonly context: string;

  /**
   * Build the failure, naming the step and quoting the anchor verbatim.
   * @param anchor - The anchor that was not found.
   * @param step - The step's label or 1-based position.
   * @param context - What the caller said it was transforming.
   */
  constructor(anchor: string, step: string, context: string) {
    super(
      `${context}: rewrite ${step} did not apply — the text does not contain ` +
        `${excerpt(anchor)}. Re-anchor the rewrite on text that is still ` +
        `there, or mark the step \`optional: true\` if it is allowed to find ` +
        `nothing.`
    );
    this.name = "MissingAnchorError";
    this.anchor = anchor;
    this.step = step;
    this.context = context;
  }
}

/**
 * Quote an anchor for a failure message, truncating a long one.
 * @param anchor - The anchor's source text.
 * @returns A quoted, length-bounded excerpt.
 */
function excerpt(anchor: string): string {
  const quoted = JSON.stringify(anchor);
  return quoted.length <= ANCHOR_EXCERPT_LIMIT
    ? quoted
    : `${quoted.slice(0, ANCHOR_EXCERPT_LIMIT)}…"`;
}

/**
 * The anchor's source text, for reporting.
 * @param anchor - A string or regular-expression anchor.
 * @returns The text to quote in a failure.
 */
function anchorText(anchor: string | RegExp): string {
  return typeof anchor === "string" ? anchor : String(anchor);
}

/**
 * Whether an anchor is present in the text.
 *
 * A global regular expression is tested with a FRESH copy rather than the
 * caller's: `RegExp.prototype.test` advances `lastIndex` on a `/g` pattern, so
 * testing the caller's object first would leave it mid-string and make the
 * `replace` that follows start from the wrong offset. That is a defect the
 * presence check would have INTRODUCED, which is the worst kind for a guard to
 * carry.
 * @param text - The text being transformed.
 * @param anchor - The anchor to look for.
 * @returns Whether the anchor matches at least once.
 */
function anchorPresent(text: string, anchor: string | RegExp): boolean {
  if (typeof anchor === "string") return text.includes(anchor);
  return new RegExp(anchor.source, anchor.flags.replace("g", "")).test(text);
}

/**
 * Replace an anchor, failing when it is not there.
 *
 * The shortest correct spelling of one step of a multi-step transform. Use it
 * everywhere a rewrite is REQUIRED to land; for a step that may legitimately
 * find nothing use {@link replaceOptional}, which says so in the source.
 * @param text - The text to transform.
 * @param anchor - The text or pattern to replace.
 * @param replacement - What to put in its place.
 * @param context - What is being transformed, quoted in the failure (e.g. the
 *   file path, or the name of the fixture being built).
 * @param step - Optional name for this step, quoted in the failure.
 * @returns The transformed text.
 * @throws {MissingAnchorError} When the anchor is not present.
 */
export function replaceOrThrow(
  text: string,
  anchor: string | RegExp,
  replacement: string,
  context: string,
  step?: string
): string {
  if (!anchorPresent(text, anchor)) {
    throw new MissingAnchorError(
      anchorText(anchor),
      step === undefined ? "(unnamed)" : `"${step}"`,
      context
    );
  }
  return text.replace(anchor, replacement);
}

/**
 * Replace an anchor that is allowed not to be there.
 *
 * The declared escape hatch. It does exactly what a bare `.replace` does — the
 * value is that it SAYS the step is optional, which a reader can see and the
 * `check:whole-output-guards` sweep can read. A transform mixing required and
 * optional steps stays fully enforced on the required ones.
 * @param text - The text to transform.
 * @param anchor - The text or pattern to replace, if present.
 * @param replacement - What to put in its place.
 * @returns The transformed text, or the input unchanged when absent.
 */
export function replaceOptional(
  text: string,
  anchor: string | RegExp,
  replacement: string
): string {
  return text.replace(anchor, replacement);
}

/**
 * Apply an ordered list of anchored rewrites, each individually accountable.
 *
 * Steps run in order against the running text, so a later step may anchor on
 * text an earlier one produced. The first REQUIRED step whose anchor is absent
 * throws, naming that step — nothing partially applied is ever returned,
 * because the throw happens before the caller receives anything.
 * @param text - The text to transform.
 * @param rewrites - The steps, in order.
 * @param context - What is being transformed, quoted in any failure.
 * @returns The transformed text.
 * @throws {MissingAnchorError} On the first required step that does not apply.
 */
export function applyRewrites(
  text: string,
  rewrites: readonly Rewrite[],
  context: string
): string {
  return rewrites.reduce((current, rewrite, index) => {
    if (rewrite.optional === true) {
      return replaceOptional(current, rewrite.anchor, rewrite.replacement);
    }
    return replaceOrThrow(
      current,
      rewrite.anchor,
      rewrite.replacement,
      context,
      rewrite.label ?? `#${index + 1}`
    );
  }, text);
}
