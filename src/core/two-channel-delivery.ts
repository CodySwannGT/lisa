/**
 * Measure the gap between the two speeds Lisa ships a change at.
 *
 * Lisa reaches a consumer down two channels, and they do not move together:
 *
 * | half | channel | reaches a consumer |
 * | --- | --- | --- |
 * | the reusable workflow body | `uses: …@main` | their next workflow run |
 * | scripts, configs, declarations | `lisa apply` | their next apply |
 *
 * For an *additive* change the asymmetry is harmless — the new workflow finds
 * no declaration and falls back. For a change that REMOVES a built-in and
 * replaces it with something the consumer's tree must provide, the halves are
 * not interchangeable and they land in the wrong order: the removing half is
 * live everywhere immediately, the restoring half only where someone applied.
 * In the gap the property is proved by nothing, and nothing reads as red —
 * the replacement never runs, so it posts no context, and an ABSENT required
 * context is not a failing one (CodySwannGT/lisa#3050).
 *
 * ## What this module measures, and what it deliberately does not
 *
 * A **coupling** is one step of a `@main`-delivered reusable workflow naming a
 * path in the CALLER's tree. `scripts/check-e2e-coverage.mjs` is a coupling;
 * `node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-gates.mjs` is
 * not — that path is inside the installed package, and whether it survives a
 * release is `check-workflow-package-paths.mjs`'s question (#2960).
 *
 * That script states its own boundary: *"HOST-relative candidates in the same
 * step (`scripts/foo.mjs`) do not count and are never extracted."* This module
 * is exactly that excluded arm. The two do not overlap, and neither subsumes
 * the other: #2960 asks whether a PACKAGE path survives a release, this asks
 * whether a HOST path ever arrives at all.
 *
 * ## Why the resolver loop matters more than it looks
 *
 * Most steps resolve a script by trying candidates in order — the packaged
 * copy first, the consumer's own copy as a fallback. Such a step is
 * `package-backed`: the package channel delivers it, and the host copy is
 * belt-and-braces. **A step naming a host path with NO package candidate has
 * exactly one delivery channel, and it is the slow one.** Those are the
 * couplings this module exists to count.
 *
 * ## Why an inventory of apply-lagged couplings is the deliverable, not a failure
 *
 * Fourteen of Lisa's own fifteen host-only couplings are `apply-lagged`, and
 * every one of them is deliberate — Lisa's design is that `quality.yml` calls
 * scripts `lisa apply` installs. Failing on them would mean ratifying fourteen
 * entries on day one, and an allowlist that large stops being a record of
 * decisions and becomes the bypass (the lesson of #2639). So `apply-lagged` is
 * RECORDED. The ledger is the baseline; a change that adds a coupling shows up
 * as a ledger diff a reviewer must look at, which is the reachable check the
 * issue asked for.
 *
 * What fails is the shape nothing restores: `never-delivered` (create-only, so
 * an existing consumer receives it once at scaffold time or never) and
 * `undelivered` (Lisa ships no such path anywhere). Those are #3030's lesson
 * — *"fixed upstream" is not "a bump brings it"* — reached from the other
 * side, and #3169's honestly-stated haves/have-nots split.
 *
 * ## Refusing to pass on nothing
 *
 * Zero workflows, zero steps, zero couplings, or an empty delivery inventory
 * all mean the measurement did not happen, and every one of them is reported
 * as unmeasured rather than as a clean sweep. An empty comparison and a
 * converged consumer must not produce the same output — this whole subject is
 * failures that read as normal, and reproducing that here would be perverse.
 * @module core/two-channel-delivery
 */

/**
 * How one artifact reaches a consumer that already exists.
 *
 * Named by SPEED rather than by mechanism, because speed is what the two-
 * channel defect is about. `workflow-ref` and `package` both arrive without
 * anyone acting on the consumer's side; `apply` needs an apply; `create-only`
 * and `undelivered` never arrive at all.
 */
export type DeliveryChannel =
  /** Travels with the workflow body itself — live on the next run. */
  | "workflow-ref"
  /** Inside the installed package — live on the next dependency bump. */
  | "package"
  /** A refreshing copy strategy — live on the next `lisa apply`. */
  | "apply"
  /** Written once at scaffold time — an existing consumer never receives it. */
  | "create-only"
  /** Lisa ships nothing at this path; the consumer must author it. */
  | "undelivered";

/** The channel a refreshing lane puts an artifact on. */
const CHANNEL_APPLY = "apply";

/** The channel a scaffold-time-only lane puts an artifact on. */
const CHANNEL_CREATE_ONLY = "create-only";

/** The channel the installed package puts an artifact on. */
const CHANNEL_PACKAGE = "package";

/** The channel of a path nothing delivers. */
const CHANNEL_UNDELIVERED = "undelivered";

/** Copy strategies that REFRESH an existing consumer's file on every apply. */
const REFRESHING_LANES: ReadonlySet<string> = new Set([
  "copy-overwrite",
  "copy-contents",
  "merge",
  "tagged-merge",
  "package-lisa",
]);

/** The one lane that writes a file exactly once and never returns to it. */
const CREATE_ONLY_LANE = CHANNEL_CREATE_ONLY;

/**
 * One coupling's verdict, in the vocabulary an operator can act on.
 *
 * Four members rather than a drifted/clean pair, because the remedies differ
 * and one of the four is not a defect at all.
 */
export type CouplingVerdict =
  /** The step also names a package candidate, so the fast channel covers it. */
  | "package-backed"
  /** Host-only, and a refreshing lane delivers it — arrives on the next apply. */
  | "apply-lagged"
  /** Host-only, and only `create-only` delivers it — never arrives. */
  | "never-delivered"
  /** Host-only, and Lisa delivers no such path at all. */
  | "undelivered";

/** What to do about one verdict. */
export type CouplingRemedy =
  | "none"
  | "run-lisa-apply"
  | "adopt-the-artifact"
  | "author-the-artifact";

/** Every verdict, named once so no two mentions can drift apart. */
const PACKAGE_BACKED = "package-backed";
const APPLY_LAGGED = "apply-lagged";
const NEVER_DELIVERED = "never-delivered";
const UNDELIVERED = CHANNEL_UNDELIVERED;

/** The remedy each verdict calls for. */
const REMEDIES: Readonly<Record<CouplingVerdict, CouplingRemedy>> = {
  [PACKAGE_BACKED]: "none",
  [APPLY_LAGGED]: "run-lisa-apply",
  [NEVER_DELIVERED]: "adopt-the-artifact",
  [UNDELIVERED]: "author-the-artifact",
};

/** Every verdict, so a count of zero is still a stated zero. */
const VERDICTS = Object.keys(REMEDIES) as readonly CouplingVerdict[];

/** Verdicts where nothing Lisa does on its own ever closes the gap. */
const UNRESTORABLE: ReadonlySet<CouplingVerdict> = new Set<CouplingVerdict>([
  NEVER_DELIVERED,
  UNDELIVERED,
]);

/** One host-relative path read by one step of one reusable workflow. */
export interface CouplingInput {
  /** Workflow file name, as a consumer spells it after `@main`. */
  readonly workflow: string;
  /** The step's `name:`, or an empty string for an unnamed step. */
  readonly step: string;
  /** The caller-tree path the step names. */
  readonly path: string;
  /**
   * Delivery lanes shipping that path, as `<stack>/<strategy>` (for example
   * `all/copy-overwrite`). Empty when Lisa ships nothing there.
   */
  readonly lanes: readonly string[];
  /** Whether the same step also names a package-relative candidate. */
  readonly packageBacked: boolean;
  /**
   * Whether the read sits behind a file-existence test.
   *
   * Not a verdict, and deliberately not one. A guard changes the SHAPE of the
   * failure rather than its existence: unguarded, an absent path fails the job
   * loudly; guarded, the step skips and the gate silently proves nothing. The
   * second is the worse outcome and the one #3050 is about, so it is recorded
   * on the entry and said in the detail rather than folded into the verdict.
   */
  readonly guarded: boolean;
}

/** One coupling, its verdict, and the evidence behind it. */
export interface CouplingEntry extends CouplingInput {
  /** Stable identity, `<workflow>::<path>`, used to key ratifications. */
  readonly key: string;
  /** The channel the path actually arrives on. */
  readonly channel: DeliveryChannel;
  /** The verdict. */
  readonly verdict: CouplingVerdict;
  /** The action this verdict calls for. */
  readonly remedy: CouplingRemedy;
  /** One operator-readable sentence. */
  readonly detail: string;
}

/** What a run looked at, so a clean report can never mean an empty one. */
export interface InspectionCounts {
  /** Reusable workflows read. */
  readonly workflows: number;
  /** Steps inside them. */
  readonly steps: number;
  /** Caller-tree path reads found in those steps. */
  readonly couplings: number;
  /** Paths in the delivery inventory the lanes were resolved against. */
  readonly inventory: number;
}

/** The whole measurement. */
export interface TwoChannelReport {
  /** One entry per coupling, sorted by key. */
  readonly entries: readonly CouplingEntry[];
  /** How many entries carry each verdict. Every key is present. */
  readonly counts: Readonly<Record<CouplingVerdict, number>>;
  /** What the run inspected. Printed on every run, clean or not. */
  readonly inspected: InspectionCounts;
  /**
   * Unrestorable couplings nobody ratified — the findings.
   *
   * Sorted by key, so two runs over the same tree emit the same bytes.
   */
  readonly findings: readonly CouplingEntry[];
  /**
   * Ratification keys matching no live coupling.
   *
   * Reported as a failure, not pruned silently. A ratification is a record of
   * a decision about a specific coupling; once that coupling is gone the entry
   * is an unexamined permission that the next matching path inherits for free,
   * which is how an allowlist added to harden a guard becomes the bypass.
   */
  readonly staleRatifications: readonly string[];
  /** False when the run did not actually measure anything. */
  readonly measured: boolean;
  /** Why the run measured nothing, or null when it measured something. */
  readonly unmeasuredReason: string | null;
}

/**
 * Which channel a path arrives on, given the lanes shipping it.
 *
 * A refreshing lane wins over `create-only` when both ship the same path,
 * because an apply reaching ANY refreshing lane rewrites the file. That is
 * deliberately optimistic and stated rather than hidden: a project on only the
 * create-only stack still never receives it, and resolving lanes per active
 * stack is a later stage. Optimism that is written down can be argued with;
 * optimism inside a `find` cannot.
 * @param lanes - `<stack>/<strategy>` lanes shipping the path
 * @returns The channel an existing consumer receives it on
 */
export function resolveDeliveryChannel(
  lanes: readonly string[]
): DeliveryChannel {
  const strategies = lanes.map(lane => lane.slice(lane.indexOf("/") + 1));
  if (strategies.some(strategy => REFRESHING_LANES.has(strategy))) {
    return CHANNEL_APPLY;
  }
  if (strategies.includes(CREATE_ONLY_LANE)) return CHANNEL_CREATE_ONLY;
  return CHANNEL_UNDELIVERED;
}

/**
 * The verdict for one coupling.
 * @param input - The coupling
 * @param channel - The channel its path arrives on
 * @returns The verdict
 */
function verdictFor(
  input: CouplingInput,
  channel: DeliveryChannel
): CouplingVerdict {
  // Ahead of every channel branch: a step that names a package candidate is
  // covered by the fast channel whatever the host copy's lane says. Reading
  // the lane first would classify every resolver loop in `quality.yml` as
  // apply-lagged and drown the twenty real couplings in ninety false ones.
  if (input.packageBacked) return PACKAGE_BACKED;
  if (channel === CHANNEL_APPLY) return APPLY_LAGGED;
  if (channel === CHANNEL_CREATE_ONLY) return NEVER_DELIVERED;
  return UNDELIVERED;
}

/**
 * How an absent path shows up, which is not the same as whether it is absent.
 * @param guarded - Whether the read sits behind an existence test
 * @returns One clause describing the failure's shape
 */
function absenceShape(guarded: boolean): string {
  return guarded
    ? "The read is guarded by an existence test, so an absent path SKIPS rather than fails — the step posts no context, and an absent required context is not a red one. Nothing reads as broken."
    : "The read is unguarded, so an absent path fails the job loudly. Visible, which makes it the better of the two failures.";
}

/**
 * The sentence one verdict is explained with.
 * @param input - The coupling
 * @param verdict - Its verdict
 * @returns One operator-readable sentence
 */
function detailFor(input: CouplingInput, verdict: CouplingVerdict): string {
  const called = `\`${input.workflow}\` is delivered at \`@main\`, so this step is live in every consumer on their next run.`;
  if (verdict === PACKAGE_BACKED) {
    return `${called} It resolves \`${input.path}\` only after a package-relative candidate, which travels with the installed package — the caller-tree copy is a fallback, not the delivery channel.`;
  }
  if (verdict === APPLY_LAGGED) {
    return `${called} It reads \`${input.path}\` from the CALLER's tree with no package-relative candidate, and Lisa delivers that path on the \`lisa apply\` channel (${input.lanes.join(", ")}). The two halves land in the wrong order: this step is live everywhere immediately, the file it needs is live only where somebody applied. ${absenceShape(input.guarded)}`;
  }
  if (verdict === NEVER_DELIVERED) {
    return `${called} It reads \`${input.path}\` from the CALLER's tree, and Lisa ships that path create-only (${input.lanes.join(", ")}) — written once at scaffold time and never refreshed, so an existing consumer NEVER receives it. Fixing it upstream does not mean a bump brings it; adoption is a manual step the consumer must take. ${absenceShape(input.guarded)}`;
  }
  return `${called} It reads \`${input.path}\` from the CALLER's tree, and Lisa ships no such path in any delivery lane — no apply and no bump ever produces it. Either the consumer authors it or this step proves nothing wherever it is absent. ${absenceShape(input.guarded)}`;
}

/** Anything carrying the stable `<workflow>::<path>` identity. */
interface Keyed {
  readonly key: string;
}

/**
 * Compare `<workflow>::<path>` keys the same way everywhere, so two runs over
 * the same tree emit the same bytes.
 * @param left - One keyed value
 * @param right - The other
 * @returns Sort order
 */
function byKey(left: Keyed, right: Keyed): number {
  return left.key.localeCompare(right.key);
}

/**
 * Turn one raw coupling into a classified entry.
 * @param input - The coupling
 * @returns The entry
 */
function toEntry(input: CouplingInput): CouplingEntry {
  const channel = input.packageBacked
    ? CHANNEL_PACKAGE
    : resolveDeliveryChannel(input.lanes);
  const verdict = verdictFor(input, channel);
  return {
    ...input,
    key: `${input.workflow}::${input.path}`,
    channel,
    verdict,
    remedy: REMEDIES[verdict],
    detail: detailFor(input, verdict),
  };
}

/**
 * Why a run measured nothing, or null when it measured something.
 * @param inspected - What the run looked at
 * @returns The reason, or null
 */
function unmeasuredReasonFor(inspected: InspectionCounts): string | null {
  if (inspected.workflows === 0) {
    return "no reusable workflows were discovered, so the fast channel was never read";
  }
  if (inspected.steps === 0) {
    return "the reusable workflows yielded no steps, so nothing could name a caller-tree path";
  }
  if (inspected.inventory === 0) {
    return "the delivery inventory is empty, so every path would resolve to `undelivered` whether or not Lisa ships it";
  }
  if (inspected.couplings === 0) {
    return "no step named a caller-tree path, which cannot be true of a tree that ships reusable workflows at all";
  }
  return null;
}

/**
 * Classify every coupling and decide whether the run measured anything.
 *
 * Total and pure — the same inputs always produce the same entries in the same
 * order. Reaching the tree is the caller's job, and a caller that could not
 * reach it must pass the zeroes it actually saw rather than omit them: this
 * function reports an empty sweep as unmeasured precisely so a caller cannot
 * turn "I could not look" into "there was nothing to find".
 * @param options - Inputs
 * @param options.couplings - Every caller-tree path read that was found
 * @param options.inspected - What the run looked at
 * @param options.ratified - Ratification reasons, keyed `<workflow>::<path>`
 * @returns The measurement
 */
export function classifyTwoChannelDelivery(options: {
  couplings: readonly CouplingInput[];
  inspected: InspectionCounts;
  ratified: Readonly<Record<string, string>>;
}): TwoChannelReport {
  const { couplings, inspected, ratified } = options;
  const entries = couplings.map(toEntry).sort(byKey);
  const unrestorable = entries.filter(entry => UNRESTORABLE.has(entry.verdict));
  const live = new Set(unrestorable.map(entry => entry.key));
  const unmeasuredReason = unmeasuredReasonFor(inspected);
  return {
    entries,
    counts: Object.fromEntries(
      VERDICTS.map(verdict => [
        verdict,
        entries.filter(entry => entry.verdict === verdict).length,
      ])
    ) as Record<CouplingVerdict, number>,
    inspected,
    findings: unrestorable.filter(entry => !Object.hasOwn(ratified, entry.key)),
    staleRatifications: Object.keys(ratified)
      .filter(key => !live.has(key))
      .sort((left, right) => left.localeCompare(right)),
    measured: unmeasuredReason === null,
    unmeasuredReason,
  };
}
