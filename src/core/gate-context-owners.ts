/**
 * Which gate produces a required status context, and under which caller chain.
 *
 * Split out of `core/gate-declaration-drift` because it answers a different
 * question. This module knows the shipped registry, the merge moment and the
 * caller-chain rules, and produces one map from context string to owning gate.
 * The comparator consumes that map as a `ReadonlyMap<string, ContextOwner>`
 * and knows none of it. Nothing here reaches an enforcing surface or reasons
 * about a verdict, so the two vocabularies the comparator's note warns about —
 * the verdict table and the sentences explaining it — stay together over
 * there, undisturbed by this seam.
 *
 * The one rule that lives here rather than in the comparator: a retired label
 * some OTHER gate has since adopted as its current label is not retired. That
 * string is posted again, by a different job, so requiring it is not a
 * permanent wait — and telling an operator to delete it would be this check
 * inventing a defect. The guard is why the map is built from the WHOLE
 * registry rather than one entry's field.
 * @module core/gate-context-owners
 */

/**
 * What the settings file says about one gate at one moment.
 *
 * `off` and `not-declared` are deliberately separate. Collapsing them is what
 * let a declaration govern nothing: the CI façade read both as
 * `configured=false` and ran its built-in fallback, so `off` could not turn a
 * job off.
 */
export type DeclarationState = "required" | "optional" | "off" | "not-declared";

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
  /**
   * The external signal this gate's merge declaration awaits INSTEAD of this
   * context, or null.
   *
   * Non-null on exactly one kind of key: the facade-derived
   * `<caller chain> / <label>` string of a gate whose merge-moment declaration
   * is an `await`. That declaration promises the awaited signal's own name as
   * the merge condition — `contextsFor` derives only that name for such a gate
   * — so the facade string is a context this declaration never asked for.
   *
   * Without this field the two derivations of the same promise disagree: this
   * map would report a gate declared `required` with `await:` as promising a
   * facade context, a ruleset would (rightly) not require it, and the operator
   * would be told to start requiring a string that, for a gate with no
   * hand-written job, nothing will ever post — the permanent-pending trap,
   * manufactured by the check written to find it.
   */
  readonly awaitedInstead: string | null;
}

/** One label the shipped registry records as renamed away. */
export interface RetiredRename {
  /** The job label that no longer exists. */
  readonly label: string;
  /** The context the same gate posts today, spelled in full. */
  readonly replacement: string;
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
          awaitedInstead: hit?.mode === "await" ? hit.awaits : null,
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
              // The awaited signal's own name IS what the declaration
              // promises, so nothing is awaited instead of it.
              awaitedInstead: null,
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
          // A retired name is dead however the gate is declared, and the
          // retirement verdict already outranks every declaration branch.
          awaitedInstead: null,
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
