/**
 * Hold the gates declaration against the ruleset that enforces it.
 *
 * Three surfaces answer "what must pass before this merges" — the project's
 * `gates` declarations, the shipped ruleset template, and the live GitHub
 * ruleset — and until this module existed no comparator joined the first to
 * either of the others. `contextsFor()` derived contexts from declarations,
 * `lisa health` compared template against live, and the two halves never met,
 * so a declaration and the protection enforcing it could disagree indefinitely
 * with every check green.
 *
 * Two properties are load-bearing, and both are structural rather than
 * conventional:
 *
 * 1. **`off` and undeclared are different findings.** `off` is a decision that
 *    a property is not proved here, so protection requiring it is a live
 *    contradiction. Undeclared is silence — the registry still has gates whose
 *    jobs run with no declaration at all, so silence must never be read as
 *    "not required", and must never justify removing live protection.
 * 2. **Agreement is not proof.** A `matched` verdict means the declaration and
 *    the ruleset name the same required context. It says nothing about whether
 *    that context proves anything: one required context in this repository
 *    ships a skip step printing "This job going green does NOT mean any
 *    ast-grep rule has test coverage", and a required review context has gone
 *    green carrying "Review skipped". A drift report that could not tell
 *    "agreed and proved" from "agreed and unproved" would itself be a control
 *    reporting more than it measured, so the word this module uses is
 *    `matched` — the two surfaces agree — and never `enforced` or `proved`.
 * 3. **A remedy may say "remove the context" only where Lisa renamed the job
 *    itself.** The original rule here was that no remedy could ever say it,
 *    and the reason was sound: third-party contexts are enforced by
 *    construction and declared by nobody, so a comparator free to propose a
 *    removal would eventually propose deleting one. That reason does not cover
 *    one case, and #3067 is what the gap costs. When the shipped registry
 *    carries a `previousLabels` entry, Lisa is not inferring that nothing owns
 *    a context — it is reading its OWN record that it renamed the job, which
 *    is proof that this exact string can never be posted again. A required
 *    context that never reports does not fail a pull request; GitHub waits for
 *    it forever, so leaving that unsaid red-walls the repository silently.
 *
 *    The narrowing is structural, not conventional. Exactly one verdict,
 *    `enforced-context-retired`, maps to the single removal remedy, and that
 *    verdict is reachable only from a `previousLabels` match. A context with
 *    no owner at all is still `enforced-not-lisa-owned` with remedy `none`, so
 *    the original guarantee holds unchanged for every third-party check.
 *
 * The ownership map this comparison reads — which gate produces a context
 * string, under which caller chain, and whether the registry records that
 * name as renamed away — is built in `core/gate-context-owners`. That is a
 * different question from the one here: it knows the registry and the chain
 * rules and nothing about verdicts, and this module knows the verdicts and
 * reads the map through `ReadonlyMap<string, ContextOwner>` without knowing
 * how it was derived. The seam is the one the signatures already drew.
 * @module core/gate-declaration-drift
 */
import {
  MERGE_MOMENT,
  type ContextOwner,
  type DeclarationState,
  type RetiredRename,
} from "./gate-context-owners.js";

/** Which enforcing surface a comparison was made against. */
export type DriftSurface = "ruleset-templates" | "live-ruleset";

/**
 * One context's verdict, in the vocabulary an operator can act on.
 *
 * Six members rather than a matched/unmatched pair, because the four unmatched
 * cases need four different actions and one of them is not a defect at all.
 */
export type DriftVerdict =
  /** Declared `required`, and the enforcing surface requires it. */
  | "matched"
  /** Declared `required`; nothing on the enforcing surface requires it. */
  | "declared-not-enforced"
  /** Enforced, while the declaration says `optional`. */
  | "enforced-declared-optional"
  /** Enforced, while the declaration says `off` — a live contradiction. */
  | "enforced-declared-off"
  /** Enforced, and a registry gate produces it, but nothing declares it. */
  | "enforced-undeclared"
  /** Enforced, and no registry gate produces it — a third-party check. */
  | "enforced-not-lisa-owned"
  /**
   * Enforced, and a registry gate carries this label — but that gate's merge
   * declaration `await`s an external signal, so it promises a DIFFERENT
   * context and never asked for this one.
   *
   * A gap rather than a contradiction, and deliberately not `matched`. An
   * awaited gate gets no job leg of its own, so unless this project hand-wrote
   * a job posting this exact string, the ruleset is waiting on a name nothing
   * reports. Reporting it as agreement would be the check making its own
   * assertion trivially true — the one resolution #3609 forbids.
   */
  | "enforced-awaited-elsewhere"
  /**
   * Enforced, and Lisa's own registry records that it RENAMED the job posting
   * it, so nothing will ever post this name again.
   *
   * Not a failure and not a gap — an absence. GitHub holds a required context
   * that never reports at "Expected — Waiting for status to be reported"
   * indefinitely: no red tick, no log, `mergeable: MERGEABLE` with
   * `mergeStateStatus: BLOCKED`, and every pull request in the repository
   * red-walled with nothing naming the cause.
   */
  | "enforced-context-retired";

/**
 * What to do about one verdict.
 *
 * Deliberately closed, and deliberately without a removal. See the module note.
 */
export type DriftRemedy =
  | "none"
  | "declare-the-gate"
  | "enforce-the-context"
  | "resolve-the-contradiction"
  | "decide-which-surface-wins"
  /**
   * The one removal in the vocabulary, and reachable from exactly one verdict.
   *
   * See the module note: it is not "this context looks unowned, drop it". It
   * is "Lisa's registry records that Lisa renamed this job, so this exact
   * string cannot be posted by anything, ever". A context with no owner at all
   * never reaches this remedy — it is `enforced-not-lisa-owned`, whose remedy
   * is still `none`.
   */
  | "stop-requiring-the-retired-context";

/** One required status context, and where the requirement was read from. */
export interface EnforcedContext {
  /** The context string, exactly as the ruleset spells it. */
  readonly context: string;
  /** The ruleset requiring it. */
  readonly ruleset: string;
  /**
   * Where the requirement was read. A package-relative template path or a
   * settings-file key — never an absolute path, which differs per machine and
   * would break the byte-identical property the report is built on.
   */
  readonly source: string;
}

/** One context, its verdict, and the evidence behind it. */
export interface DeclarationDriftEntry {
  /** The context string. */
  readonly context: string;
  /** The verdict. */
  readonly verdict: DriftVerdict;
  /** The action this verdict calls for. Never a removal. */
  readonly remedy: DriftRemedy;
  /** The registry gate producing this context, when one does. */
  readonly gateId: string | null;
  /** What the settings file says, or null when no gate owns the context. */
  readonly declaration: DeclarationState | null;
  /**
   * The signal this gate's declaration awaits INSTEAD of this context, or null.
   *
   * Carried on the entry as well as the owner so a consumer can name it
   * without re-deriving it from the sentence in `detail`.
   */
  readonly awaitedInstead: string | null;
  /** The rulesets requiring it, sorted. Empty when nothing enforces it. */
  readonly rulesets: readonly string[];
  /** Where the requirement was read from, sorted. */
  readonly sources: readonly string[];
  /** One operator-readable sentence. */
  readonly detail: string;
}

/** The whole comparison against one enforcing surface. */
export interface DeclarationDriftReport {
  /** Which surface the declarations were held against. */
  readonly surface: DriftSurface;
  /** One entry per context, sorted by context. */
  readonly entries: readonly DeclarationDriftEntry[];
  /** How many entries carry each verdict. Every key is present. */
  readonly counts: Readonly<Record<DriftVerdict, number>>;
  /** Entries whose verdict is a contradiction rather than a gap. */
  readonly contradictions: number;
  /** Entries whose verdict is a gap the declaration surface could close. */
  readonly gaps: number;
  /**
   * Entries the enforcing surface requires and nothing can post.
   *
   * Counted separately from `contradictions` and `gaps` because it is neither.
   * A contradiction has two surfaces saying opposite things and a gap has one
   * surface silent; this has one surface waiting on a name that no longer
   * exists. Folding it into either bucket would give an operator the wrong
   * remedy, and folding it into `gaps` would let it warn when it must fail.
   */
  readonly unpostable: number;
}

/** Every verdict, named once so no two mentions can drift apart. */
const MATCHED = "matched";
const DECLARED_NOT_ENFORCED = "declared-not-enforced";
const ENFORCED_DECLARED_OPTIONAL = "enforced-declared-optional";
const ENFORCED_DECLARED_OFF = "enforced-declared-off";
const ENFORCED_UNDECLARED = "enforced-undeclared";
const ENFORCED_NOT_LISA_OWNED = "enforced-not-lisa-owned";
const ENFORCED_AWAITED_ELSEWHERE = "enforced-awaited-elsewhere";
const ENFORCED_CONTEXT_RETIRED = "enforced-context-retired";

/** Verdicts where the two surfaces state opposite things. */
const CONTRADICTIONS: ReadonlySet<DriftVerdict> = new Set<DriftVerdict>([
  DECLARED_NOT_ENFORCED,
  ENFORCED_DECLARED_OFF,
]);

/** Verdicts where one surface is silent rather than contrary. */
const GAPS: ReadonlySet<DriftVerdict> = new Set<DriftVerdict>([
  ENFORCED_DECLARED_OPTIONAL,
  ENFORCED_UNDECLARED,
  ENFORCED_AWAITED_ELSEWHERE,
]);

/** Verdicts where the surface requires a name nothing can post. */
const UNPOSTABLE: ReadonlySet<DriftVerdict> = new Set<DriftVerdict>([
  ENFORCED_CONTEXT_RETIRED,
]);

/** The remedy each verdict calls for. */
const REMEDIES: Readonly<Record<DriftVerdict, DriftRemedy>> = {
  [MATCHED]: "none",
  [DECLARED_NOT_ENFORCED]: "enforce-the-context",
  [ENFORCED_DECLARED_OPTIONAL]: "decide-which-surface-wins",
  [ENFORCED_DECLARED_OFF]: "resolve-the-contradiction",
  [ENFORCED_UNDECLARED]: "declare-the-gate",
  [ENFORCED_NOT_LISA_OWNED]: "none",
  [ENFORCED_AWAITED_ELSEWHERE]: "decide-which-surface-wins",
  [ENFORCED_CONTEXT_RETIRED]: "stop-requiring-the-retired-context",
};

/** Every verdict, so a count of zero is still a stated zero. */
const VERDICTS = Object.keys(REMEDIES) as readonly DriftVerdict[];

/**
 * Whether a verdict is two surfaces stating opposite things.
 *
 * Exported because every consumer that acts on this report used to re-list the
 * membership inline, and a hand-copied list is how a verdict added here lands
 * in the report and in NO consumer — a new finding that reaches a JSON payload
 * and never changes a pass into a warn. The sets and these predicates are the
 * single place the membership is written.
 * @param verdict - The verdict
 * @returns Whether it is a contradiction
 */
export function isContradiction(verdict: DriftVerdict): boolean {
  return CONTRADICTIONS.has(verdict);
}

/**
 * Whether a verdict is one surface being silent rather than contrary.
 * @param verdict - The verdict
 * @returns Whether it is a gap
 */
export function isGap(verdict: DriftVerdict): boolean {
  return GAPS.has(verdict);
}

/** How the enforcing surface is named in a sentence. */
const SURFACE_NAMES: Readonly<Record<DriftSurface, string>> = {
  "ruleset-templates": "the shipped ruleset template",
  "live-ruleset": "the live branch-protection ruleset",
};

/**
 * Sort strings the same way everywhere, so two runs emit the same bytes.
 * @param values - Caller-owned strings
 * @returns A sorted copy
 */
function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

/**
 * The contexts a `required` declaration promises protection will require.
 * @param owners - Context to owning gate
 * @returns The contexts, sorted
 */
export function declaredRequiredContexts(
  owners: ReadonlyMap<string, ContextOwner>
): readonly string[] {
  return sorted(
    [...owners.entries()]
      // A retired label is never a promise. Its gate's declaration promises
      // the CURRENT context, so listing the old name here would report a
      // `declared-not-enforced` gap against a string no declaration asks for
      // and tell the operator to start requiring a context nothing posts —
      // the permanent-pending trap, created by the check meant to find it.
      // `awaitedInstead` drops the facade-derived name of a gate declared
      // `required` with an `await:`. That declaration promises the awaited
      // signal — which has its OWN entry in this map — and promises nothing
      // about the facade string. Listing it here reported the gate as
      // `declared-not-enforced` against a context it never asked for, and the
      // remedy told the operator to start requiring a name that, for a gate
      // with no hand-written job, nothing posts: the permanent wait, created
      // by the check meant to find it.
      .filter(
        ([, owner]) =>
          owner.declaration === "required" &&
          retirementOf(owner) === null &&
          awaitedInsteadOf(owner) === null
      )
      .map(([context]) => context)
  );
}

/**
 * The rename one owner is the losing half of, normalized to null.
 * @param owner - The gate producing a context, when one does
 * @returns The rename, or null
 */
function retirementOf(owner: ContextOwner | undefined): RetiredRename | null {
  // `?? null` rather than `!== null`, because an owner built before this field
  // existed carries `undefined` — and `undefined !== null` is true, which would
  // classify EVERY context as retired and tell an operator to delete their
  // whole required list. Callers include fixtures and any consumer holding an
  // older shape, so the normalization lives here rather than at each read.
  return owner?.retired ?? null;
}

/**
 * The signal one owner awaits instead of its own facade name, normalized.
 *
 * `?? null` for the same reason `retirementOf` uses it: a consumer holding a
 * `ContextOwner` built before this field existed carries `undefined`, and
 * `undefined !== null` would classify EVERY context as awaited elsewhere.
 * @param owner - The gate producing a context, when one does
 * @returns The awaited signal, or null
 */
function awaitedInsteadOf(owner: ContextOwner | undefined): string | null {
  return owner?.awaitedInstead ?? null;
}

/**
 * The verdict for one enforced context.
 * @param owner - The gate producing it, when one does
 * @returns The verdict
 */
function verdictForEnforced(owner: ContextOwner | undefined): DriftVerdict {
  if (owner === undefined) return ENFORCED_NOT_LISA_OWNED;
  // Ahead of every declaration branch, because the declaration cannot rescue
  // it. The gate may be declared `required` and run on every pull request —
  // it posts its CURRENT label, so this string still never reports. Reading
  // the declaration first would classify the exact #3067 case as `matched`.
  if (retirementOf(owner) !== null) return ENFORCED_CONTEXT_RETIRED;
  // Ahead of the declaration branches for the same reason retirement is: the
  // gate may be declared `required`, and this is still not the context that
  // declaration promises. Reading the declaration first would call it
  // `matched` — agreement about a string the settings file never named.
  if (awaitedInsteadOf(owner) !== null) return ENFORCED_AWAITED_ELSEWHERE;
  if (owner.declaration === "required") return MATCHED;
  if (owner.declaration === "optional") return ENFORCED_DECLARED_OPTIONAL;
  if (owner.declaration === "off") return ENFORCED_DECLARED_OFF;
  return ENFORCED_UNDECLARED;
}

/**
 * The sentence one verdict is explained with.
 * @param options - Inputs
 * @param options.verdict - The verdict
 * @param options.surface - The enforcing surface
 * @param options.gateId - The owning gate, when there is one
 * @param options.sources - Where the requirement was read from
 * @param options.rulesets - The rulesets requiring it, sorted
 * @param options.retired - The rename it is the losing half of, or null
 * @param options.awaited - The signal its declaration awaits instead, or null
 * @returns One operator-readable sentence
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- one branch per verdict keeps the wording auditable
function detailFor(options: {
  verdict: DriftVerdict;
  surface: DriftSurface;
  gateId: string | null;
  sources: readonly string[];
  rulesets: readonly string[];
  retired: RetiredRename | null;
  awaited: string | null;
}): string {
  const { verdict, gateId, sources, rulesets, retired, awaited } = options;
  const surface = SURFACE_NAMES[options.surface];
  const where = sources.length === 0 ? "" : ` (${sources.join(", ")})`;
  if (verdict === ENFORCED_CONTEXT_RETIRED && retired !== null) {
    const named =
      rulesets.length === 0
        ? " The ruleset holding it was not named by the reader."
        : ` The requirement lives in ${rulesets.length === 1 ? "ruleset" : "rulesets"} ${rulesets.map(name => `"${name}"`).join(", ")}, which Lisa may not manage — reported here, never edited automatically.`;
    return `NOTHING WILL EVER POST THIS. Lisa's registry records that the gate "${String(gateId)}" was renamed from "${retired.label}", and ${surface} still requires the old name${where}. This is not a failing check — GitHub holds a required context that never reports at "Expected — Waiting for status to be reported" indefinitely, so every pull request in this repository is blocked with no red tick and no log to open. The gate posts "${retired.replacement}" now.${named} Remove the old context first, then require the new one: requiring the new one before the job posts it creates the same permanent wait in the other direction.`;
  }
  if (verdict === ENFORCED_AWAITED_ELSEWHERE) {
    return `${surface} requires this context${where}, but the settings file declares "${String(gateId)}" at ${MERGE_MOMENT} with await: "${String(awaited)}" — so the declaration promises "${String(awaited)}" as the merge condition and never asked for this string. An awaited gate gets no job of its own, so unless a job this project hand-wrote posts this exact name, the requirement waits forever at "Expected — Waiting for status to be reported". Name which surface wins: require "${String(awaited)}" instead, or declare the gate with a run: so a job posts this name.`;
  }
  if (verdict === MATCHED) {
    return `Declared required, and ${surface} requires it${where}. The two surfaces agree; that is not evidence the check proves its property.`;
  }
  if (verdict === DECLARED_NOT_ENFORCED) {
    return `The settings file declares "${String(gateId)}" required at ${MERGE_MOMENT}, but ${surface} does not require this context, so the declaration blocks nothing.`;
  }
  if (verdict === ENFORCED_DECLARED_OPTIONAL) {
    return `${surface} requires this context${where}, while the settings file declares "${String(gateId)}" optional at ${MERGE_MOMENT}. Two surfaces, two answers — name which one wins.`;
  }
  if (verdict === ENFORCED_DECLARED_OFF) {
    return `The settings file declares "${String(gateId)}" off at ${MERGE_MOMENT} — an explicit decision not to prove it here — yet ${surface} requires this context${where}. That is a contradiction, not a gap.`;
  }
  if (verdict === ENFORCED_UNDECLARED) {
    return `${surface} requires this context${where}, and it is produced by the gate "${String(gateId)}", which the settings file never declares at any moment. Undeclared is silence, not permission to stop requiring it.`;
  }
  return `${surface} requires this context${where}, and no gate in Lisa's registry produces it — it comes from a third-party app or from a job this project's own CI defines. Matching is on the exact context string, never on a job name that merely resembles it: a third-party app status and a Lisa job with a similar name are different things, and treating them as one produces a false drift report, or worse a false clean one. Reported so it can be told apart from a Lisa gate that fell out of the settings file, never so it can be removed.`;
}

/**
 * Group enforced contexts, keeping every ruleset and source that named one.
 * @param enforced - Enforced contexts, possibly repeating a context
 * @returns Context to its rulesets and sources
 */
function groupEnforced(
  enforced: readonly EnforcedContext[]
): ReadonlyMap<string, { rulesets: string[]; sources: string[] }> {
  return enforced.reduce((grouped, entry) => {
    const existing = grouped.get(entry.context) ?? {
      rulesets: [],
      sources: [],
    };
    return new Map(grouped).set(entry.context, {
      rulesets: [...existing.rulesets, entry.ruleset],
      sources: [...existing.sources, entry.source],
    });
  }, new Map<string, { rulesets: string[]; sources: string[] }>());
}

/**
 * One entry for a context the enforcing surface requires.
 * @param options - Inputs
 * @param options.context - The context string
 * @param options.surface - The enforcing surface
 * @param options.owner - The gate producing it, when one does
 * @param options.grouped - Every ruleset and source that named a context
 * @returns The entry
 */
function enforcedEntry(options: {
  context: string;
  surface: DriftSurface;
  owner: ContextOwner | undefined;
  grouped: ReadonlyMap<string, { rulesets: string[]; sources: string[] }>;
}): DeclarationDriftEntry {
  const { context, surface, owner } = options;
  const verdict = verdictForEnforced(owner);
  const found = options.grouped.get(context);
  const sources = sorted(new Set(found?.sources ?? []));
  const rulesets = sorted(new Set(found?.rulesets ?? []));
  return {
    context,
    verdict,
    remedy: REMEDIES[verdict],
    gateId: owner?.gateId ?? null,
    declaration: owner?.declaration ?? null,
    awaitedInstead: awaitedInsteadOf(owner),
    rulesets,
    sources,
    detail: detailFor({
      verdict,
      surface,
      gateId: owner?.gateId ?? null,
      sources,
      rulesets,
      retired: retirementOf(owner),
      awaited: awaitedInsteadOf(owner),
    }),
  };
}

/**
 * Compare a project's declarations with one enforcing surface.
 *
 * Total and pure — the same inputs always produce the same entries in the same
 * order. Reaching the surface is the caller's job, and a caller that could not
 * reach it must report an unknown rather than call this with an empty list: a
 * comparison against nothing would report every declaration as unenforced,
 * which is a different and false claim.
 * @param options - Inputs
 * @param options.surface - Which surface `enforced` was read from
 * @param options.owners - Context to owning gate
 * @param options.enforced - Contexts the surface requires
 * @returns The comparison
 */
export function classifyDeclarationDrift(options: {
  surface: DriftSurface;
  owners: ReadonlyMap<string, ContextOwner>;
  enforced: readonly EnforcedContext[];
}): DeclarationDriftReport {
  const { surface, owners, enforced } = options;
  const grouped = groupEnforced(enforced);
  const enforcedEntries = sorted(grouped.keys()).map(context =>
    enforcedEntry({ context, surface, owner: owners.get(context), grouped })
  );
  const unenforced = declaredRequiredContexts(owners)
    .filter(context => !grouped.has(context))
    .map((context): DeclarationDriftEntry => {
      const gateId = owners.get(context)?.gateId ?? null;
      return {
        context,
        verdict: DECLARED_NOT_ENFORCED,
        remedy: REMEDIES[DECLARED_NOT_ENFORCED],
        gateId,
        declaration: "required",
        // Unreachable by construction: `declaredRequiredContexts` excludes an
        // owner that awaits something else, so nothing here ever promises a
        // context its declaration did not name.
        awaitedInstead: null,
        rulesets: [],
        sources: [],
        detail: detailFor({
          verdict: DECLARED_NOT_ENFORCED,
          surface,
          gateId,
          sources: [],
          rulesets: [],
          retired: null,
          awaited: null,
        }),
      };
    });
  const entries = [...enforcedEntries, ...unenforced].sort((left, right) =>
    left.context.localeCompare(right.context)
  );
  return {
    surface,
    entries,
    counts: Object.fromEntries(
      VERDICTS.map(verdict => [
        verdict,
        entries.filter(entry => entry.verdict === verdict).length,
      ])
    ) as Record<DriftVerdict, number>,
    contradictions: entries.filter(entry => CONTRADICTIONS.has(entry.verdict))
      .length,
    gaps: entries.filter(entry => GAPS.has(entry.verdict)).length,
    unpostable: entries.filter(entry => UNPOSTABLE.has(entry.verdict)).length,
  };
}
