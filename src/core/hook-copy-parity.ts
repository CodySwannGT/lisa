/**
 * Sibling copies of one git hook, derived from the tree rather than written down.
 *
 * Three tracked copies of the pre-push hook existed in this repository; every
 * test that could have caught the third drifting six commits behind was named a
 * parity test and hardcoded a two-entry roster that omitted it. Each such test
 * proves parity across the copies it happens to list, so "the copies agree"
 * silently meant "the copies someone remembered agree" the moment a third copy
 * appeared (CodySwannGT/lisa#2847).
 *
 * The roster here is derived from the set of tracked paths, so a copy added
 * tomorrow joins every check that consumes it without anyone editing a list.
 *
 * The feature axis is the gate ids a hook declares through `lisa_gate_covers`.
 * That marker is the one machine-readable link between a built-in hook step and
 * the gate registry entry that can stand it down, so a copy missing an id is a
 * copy in which that property is either unprovable or ungovernable — the exact
 * shape the drift took. Comparing whole bytes instead would be useless: sibling
 * copies legitimately differ (Lisa's own hook is not its shipped template), so a
 * byte check would be permanently red and would prove nothing about behaviour.
 * @module core/hook-copy-parity
 */

/** One tracked copy of a hook, with the features it declares. */
export interface HookCopy {
  /** Repo-relative path of this copy. */
  readonly path: string;
  /** Features this copy declares, sorted. */
  readonly features: readonly string[];
}

/** Every tracked copy of one hook name. */
export interface HookCopyGroup {
  /** The hook's file name, e.g. `pre-push`. */
  readonly hook: string;
  /** Repo-relative paths of every tracked copy, sorted. */
  readonly paths: readonly string[];
}

/** A feature some copies of a hook declare and others do not. */
export interface HookCopyFinding {
  /** The hook name the disagreeing copies share. */
  readonly hook: string;
  /** The feature that is present in one copy and absent from another. */
  readonly feature: string;
  /** Copies that declare the feature, sorted. */
  readonly present: readonly string[];
  /** Copies that do not, sorted. */
  readonly absent: readonly string[];
}

/** Matches any tracked path that is a file directly inside a `.husky` directory. */
const HUSKY_HOOK = /(?:^|\/)\.husky\/([^/]+)$/u;

/**
 * Matches a `lisa_gate_covers` call and captures its arguments.
 *
 * Anchored at the start of a shell word so the helper's own definition
 * (`lisa_gate_covers() {`) and its body never register as declarations — only a
 * call site passing at least one gate id does.
 */
const GATE_COVERS = /(?:^|\s)lisa_gate_covers((?:[ \t]+[A-Za-z0-9][\w-]*)+)/gmu;

/**
 * Alphabetical order that does not depend on the ambient locale's default.
 * @param left - First name
 * @param right - Second name
 * @returns Negative, zero, or positive per `String.localeCompare`
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

/**
 * Group tracked paths into the hooks they are copies of.
 *
 * Identity is the file name under `.husky/`: `.husky/pre-push` and
 * `any/prefix/.husky/pre-push` are two copies of one logical hook. Paths that
 * are not hooks are ignored, and a hook with a single copy still gets a group —
 * callers decide what a one-copy group means.
 * @param trackedPaths - Repo-relative paths of every tracked file
 * @returns One group per hook name, sorted by hook name
 */
export function deriveHookCopyGroups(
  trackedPaths: readonly string[]
): readonly HookCopyGroup[] {
  const located = trackedPaths.flatMap(trackedPath => {
    const hook = HUSKY_HOOK.exec(trackedPath)?.[1];
    return hook === undefined ? [] : [{ hook, path: trackedPath }];
  });
  return [...new Set(located.map(entry => entry.hook))]
    .sort(byName)
    .map(hook => ({
      hook,
      paths: located
        .filter(entry => entry.hook === hook)
        .map(entry => entry.path)
        .sort(byName),
    }));
}

/**
 * The features one hook's source declares.
 * @param source - Full text of the hook
 * @returns Declared feature ids, sorted and de-duplicated
 */
export function declaredHookFeatures(source: string): readonly string[] {
  const declared = [...source.matchAll(GATE_COVERS)].flatMap(match =>
    (match[1] ?? "")
      .trim()
      .split(/[ \t]+/u)
      .map(id => `gate:${id}`)
  );
  return [...new Set(declared)].sort(byName);
}

/**
 * Report every feature that sibling copies of one hook disagree about.
 *
 * A hook with fewer than two copies can never disagree, and a feature no copy
 * declares is not a feature, so both cases produce nothing.
 * @param hook - The hook name these copies share
 * @param copies - Every tracked copy of that hook
 * @returns One finding per disputed feature, sorted by feature
 */
export function findHookCopyDrift(
  hook: string,
  copies: readonly HookCopy[]
): readonly HookCopyFinding[] {
  if (copies.length < 2) return [];
  const union = [...new Set(copies.flatMap(copy => [...copy.features]))].sort(
    byName
  );
  return union.flatMap(feature => {
    const present = copies
      .filter(copy => copy.features.includes(feature))
      .map(copy => copy.path)
      .sort(byName);
    const absent = copies
      .filter(copy => !copy.features.includes(feature))
      .map(copy => copy.path)
      .sort(byName);
    return absent.length === 0 ? [] : [{ hook, feature, present, absent }];
  });
}

/**
 * One operator-readable line per finding.
 * @param finding - A disputed feature
 * @returns A sentence naming the feature and both sides
 */
export function describeHookCopyFinding(finding: HookCopyFinding): string {
  return (
    `${finding.hook}: ${finding.feature} is declared by ` +
    `${finding.present.join(", ")} but absent from ${finding.absent.join(", ")}`
  );
}
