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
 * @module core/gate-declaration-drift
 */
/* eslint-disable max-lines -- one comparator: splitting the verdict table
   from the sentences explaining it is how two vocabularies drift apart */

/**
 * What the settings file says about one gate at one moment.
 *
 * `off` and `not-declared` are deliberately separate. Collapsing them is what
 * let a declaration govern nothing: the CI façade read both as
 * `configured=false` and ran its built-in fallback, so `off` could not turn a
 * job off.
 */
export type DeclarationState = "required" | "optional" | "off" | "not-declared";

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

/** The gate a context belongs to, and what the settings file says about it. */
export interface ContextOwner {
  /** Registry gate id. */
  readonly gateId: string;
  /** The declaration at the merge moment. */
  readonly declaration: DeclarationState;
  /** Whether the registry permits declaring this gate at the merge moment. */
  readonly legalAtMerge: boolean;
  /**
   * The rename this context is the losing half of, or null for a live name.
   *
   * Non-null means the gate exists and still runs — under a DIFFERENT name.
   * The declaration is therefore irrelevant to the verdict: a gate declared
   * `required` posts its current label, not this one, so requiring this string
   * is a permanent wait however the gate is declared.
   */
  readonly retired: RetiredRename | null;
}

/** One label the shipped registry records as renamed away. */
export interface RetiredRename {
  /** The job label that no longer exists. */
  readonly label: string;
  /** The context the same gate posts today, spelled in full. */
  readonly replacement: string;
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

/** The slice of the shipped registry this comparison reads. */
export interface MergeContextRegistry {
  readonly REGISTRY: Readonly<
    Record<
      string,
      {
        readonly label: string;
        readonly moments: readonly string[];
        /**
         * Labels this gate's job used to post under, and no longer does.
         *
         * Optional because a consumer may hold an older copy of the shipped
         * registry that predates the field. Absent reads as "this gate was
         * never renamed" — which is what every registry before it meant, and
         * which can only make this comparison report LESS, never a false
         * defect.
         */
        readonly previousLabels?: readonly string[];
      }
    >
  >;
  readonly resolveMoment: (options: {
    gates: Record<string, unknown>;
    moment: string;
    includeOff?: boolean;
  }) => readonly {
    readonly id: string;
    readonly level: string;
    readonly mode: string;
    readonly awaits: string | null;
    /**
     * The chain this declaration overrode the caller-wide one with, raw.
     *
     * Optional because a consumer may hold an older copy of the shipped
     * registry that predates the field. Absent reads as "no override", which
     * is what every registry before it meant.
     */
    readonly callerChain?: readonly string[] | string | null;
  }[];
  readonly momentFamily: (moment: string) => string;
  /**
   * Join one declaration's own chain into the prefix its context carries.
   *
   * Optional for the same reason, and its absence is NOT a licence to join the
   * chain here: a second implementation of the joining rule is how a rename
   * lands in one derivation and not the other. Where it is absent, an override
   * cannot be honoured, and the comparison says so rather than deriving the
   * caller-wide name as though nothing had been declared.
   */
  readonly callerPrefix?: (chain: readonly string[] | string) => string;
}

/** The moment a branch ruleset guards. */
export const MERGE_MOMENT = "pull-request";

/** Every verdict, named once so no two mentions can drift apart. */
const MATCHED = "matched";
const DECLARED_NOT_ENFORCED = "declared-not-enforced";
const ENFORCED_DECLARED_OPTIONAL = "enforced-declared-optional";
const ENFORCED_DECLARED_OFF = "enforced-declared-off";
const ENFORCED_UNDECLARED = "enforced-undeclared";
const ENFORCED_NOT_LISA_OWNED = "enforced-not-lisa-owned";
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
  [ENFORCED_CONTEXT_RETIRED]: "stop-requiring-the-retired-context",
};

/** Every verdict, so a count of zero is still a stated zero. */
const VERDICTS = Object.keys(REMEDIES) as readonly DriftVerdict[];

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
 * The declaration state one resolved level names.
 *
 * Anything that is not one of the three levels is `not-declared`, because an
 * unknown level is a typo rather than a claim.
 * @param level - The resolved level
 * @returns The declaration state
 */
function asDeclaration(level: string | undefined): DeclarationState {
  return level === "required" || level === "optional" || level === "off"
    ? level
    : "not-declared";
}

/**
 * Map every context a registry gate can produce to that gate.
 *
 * Built from the whole registry rather than from the declared gates, which is
 * the difference between "protection requires a context whose gate nobody
 * declared" and "protection requires a context Lisa knows nothing about". Those
 * are different findings with different remedies, and a map built only from
 * declarations could not tell them apart.
 * @param options - Inputs
 * @param options.registry - The shipped registry
 * @param options.gates - The project's gates block
 * @param options.workflowName - The workflow whose name prefixes a context
 * @returns Context string to owning gate
 */
export function contextOwners(options: {
  registry: MergeContextRegistry;
  gates: Record<string, unknown>;
  workflowName: string;
}): ReadonlyMap<string, ContextOwner> {
  const { registry, gates, workflowName } = options;
  const resolved = resolveMergeMoment(registry, gates);
  const family = registry.momentFamily(MERGE_MOMENT);
  const owners = Object.entries(registry.REGISTRY).map(
    ([gateId, definition]): readonly [string, ContextOwner] => {
      const hit = resolved.get(gateId);
      return [
        `${prefixFor(registry, hit?.callerChain, workflowName)} / ${definition.label}`,
        {
          gateId,
          declaration: asDeclaration(hit?.level),
          legalAtMerge: definition.moments.includes(family),
          retired: null,
        },
      ] as const;
    }
  );
  const awaited = [...resolved.values()].flatMap(hit =>
    hit.mode === "await" && hit.awaits !== null
      ? [
          [
            hit.awaits,
            {
              gateId: hit.id,
              declaration: asDeclaration(hit.level),
              legalAtMerge:
                registry.REGISTRY[hit.id]?.moments.includes(family) === true,
              retired: null,
            },
          ] as const,
        ]
      : []
  );
  // Retired entries go FIRST so a later current-label or awaited entry always
  // wins the key. The collision filter below already covers the reachable
  // case; the ordering covers the one nobody thought of.
  return new Map([
    ...retiredOwners(registry, resolved, workflowName, family),
    ...owners,
    ...awaited,
  ]);
}

/**
 * The contexts the registry records as renamed away, keyed by their old name.
 *
 * Built from the whole registry — like the current-label map, and for the same
 * reason. It is what separates "a required context nothing in Lisa produces"
 * (which may be CodeRabbit, a Sonar status, a manual status, or a job the host
 * repository's own CI defines, and is not a defect) from "a required context
 * Lisa itself retired" (which no run can post, ever). Only the second is
 * reportable, and only the second earns a removal remedy.
 *
 * A retired label some other gate has since adopted as its CURRENT label is
 * skipped: that string is posted again, by a different job, so requiring it is
 * not a permanent wait. Missing this would turn a legitimate requirement into
 * a false "delete this" instruction.
 * @param registry - The shipped registry
 * @param resolved - The resolved merge moment, keyed by gate id
 * @param workflowName - The caller chain that prefixes a run gate's context
 * @param family - The merge moment's family
 * @returns Retired context to owning gate
 */
function retiredOwners(
  registry: MergeContextRegistry,
  resolved: ReadonlyMap<string, { level: string }>,
  workflowName: string,
  family: string
): readonly (readonly [string, ContextOwner])[] {
  const live = new Set(
    Object.values(registry.REGISTRY).map(definition => definition.label)
  );
  return Object.entries(registry.REGISTRY).flatMap(([gateId, definition]) =>
    (definition.previousLabels ?? [])
      .filter(label => !live.has(label))
      .map((label): readonly [string, ContextOwner] => [
        `${workflowName} / ${label}`,
        {
          gateId,
          declaration: asDeclaration(resolved.get(gateId)?.level),
          legalAtMerge: definition.moments.includes(family),
          retired: {
            label,
            replacement: `${workflowName} / ${definition.label}`,
          },
        },
      ])
  );
}

/**
 * The prefix one gate's context carries, honouring a per-declaration override.
 *
 * Three states, and the third is the one that matters. No override means the
 * caller-wide name, unchanged — which is what keeps every existing declaration
 * deriving exactly what it derived before this field existed. An override with
 * a registry able to join it means that gate's own chain. An override with a
 * registry too old to join it is refused outright, because the alternative is
 * to derive the caller-wide name for a gate whose declaration has just said
 * that name is wrong — a comparison that would report a clean match against a
 * context nothing posts.
 * @param registry - The shipped registry
 * @param chain - The declared override, when there is one
 * @param workflowName - The caller-wide chain
 * @returns The prefix
 * @throws {Error} When an override cannot be joined
 */
function prefixFor(
  registry: MergeContextRegistry,
  chain: readonly string[] | string | null | undefined,
  workflowName: string
): string {
  if (chain === null || chain === undefined) return workflowName;
  if (registry.callerPrefix === undefined) {
    throw new Error(
      `a gate declares its own caller chain (${JSON.stringify(chain)}), but ` +
        `the installed copy of Lisa's check registry is too old to derive a ` +
        `context from one. Update Lisa, or remove the override; deriving the ` +
        `default name here would report agreement about a check that never ` +
        `reports.`
    );
  }
  return registry.callerPrefix(chain);
}

/**
 * Resolve the merge moment, treating a refusal as "nothing resolved".
 *
 * A refusal is never swallowed by the caller: `readTemplateEnforcement` and the
 * health check both report the declaration problems separately. What must not
 * happen here is a throw that turns a comparison into no comparison at all.
 * @param registry - The shipped registry
 * @param gates - The project's gates block
 * @returns Resolved gates keyed by id
 */
function resolveMergeMoment(
  registry: MergeContextRegistry,
  gates: Record<string, unknown>
): ReadonlyMap<
  string,
  {
    id: string;
    level: string;
    mode: string;
    awaits: string | null;
    callerChain?: readonly string[] | string | null;
  }
> {
  try {
    return new Map(
      registry
        .resolveMoment({ gates, moment: MERGE_MOMENT, includeOff: true })
        .map(entry => [entry.id, { ...entry }])
    );
  } catch {
    return new Map();
  }
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
      .filter(
        ([, owner]) =>
          owner.declaration === "required" && retirementOf(owner) === null
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
}): string {
  const { verdict, gateId, sources, rulesets, retired } = options;
  const surface = SURFACE_NAMES[options.surface];
  const where = sources.length === 0 ? "" : ` (${sources.join(", ")})`;
  if (verdict === ENFORCED_CONTEXT_RETIRED && retired !== null) {
    const named =
      rulesets.length === 0
        ? " The ruleset holding it was not named by the reader."
        : ` The requirement lives in ${rulesets.length === 1 ? "ruleset" : "rulesets"} ${rulesets.map(name => `"${name}"`).join(", ")}, which Lisa may not manage — reported here, never edited automatically.`;
    return `NOTHING WILL EVER POST THIS. Lisa's registry records that the gate "${String(gateId)}" was renamed from "${retired.label}", and ${surface} still requires the old name${where}. This is not a failing check — GitHub holds a required context that never reports at "Expected — Waiting for status to be reported" indefinitely, so every pull request in this repository is blocked with no red tick and no log to open. The gate posts "${retired.replacement}" now.${named} Remove the old context first, then require the new one: requiring the new one before the job posts it creates the same permanent wait in the other direction.`;
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
  const enforcedEntries = sorted(grouped.keys()).map(
    (context): DeclarationDriftEntry => {
      const owner = owners.get(context);
      const verdict = verdictForEnforced(owner);
      const found = grouped.get(context);
      const sources = sorted(new Set(found?.sources ?? []));
      const rulesets = sorted(new Set(found?.rulesets ?? []));
      return {
        context,
        verdict,
        remedy: REMEDIES[verdict],
        gateId: owner?.gateId ?? null,
        declaration: owner?.declaration ?? null,
        rulesets,
        sources,
        detail: detailFor({
          verdict,
          surface,
          gateId: owner?.gateId ?? null,
          sources,
          rulesets,
          retired: retirementOf(owner),
        }),
      };
    }
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
        rulesets: [],
        sources: [],
        detail: detailFor({
          verdict: DECLARED_NOT_ENFORCED,
          surface,
          gateId,
          sources: [],
          rulesets: [],
          retired: null,
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
/* eslint-enable max-lines -- restore repository defaults */
