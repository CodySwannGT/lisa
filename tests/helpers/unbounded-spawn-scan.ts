/**
 * Find every synchronous child start in a test source that carries no deadline.
 *
 * A test that starts a program and waits has no way to give up if that program
 * hangs, and the runner's own per-case deadline CANNOT rescue it: `spawnSync`
 * blocks the worker's event loop for the whole life of the child, and vitest's
 * budget is a timer on that loop. The one safety net that exists is unavailable
 * for exactly the case it was built for (CodySwannGT/lisa#2906).
 *
 * Worse, the failure lies about itself. When the run is eventually killed from
 * outside, the hung child hands back EMPTY streams, so the assertion below it
 * fails as a content mismatch — "expected X, got ''" — and nothing anywhere
 * says the word timeout. That is why this class was repeatedly diagnosed as
 * real test failures (CodySwannGT/lisa#2940).
 *
 * ## Why an AST rather than a grep
 *
 * Three of the shapes in this tree defeat a line-oriented scan, and each one
 * fails in the direction that produces a false verdict:
 *
 * - a fixture writes another program's source as a template literal containing
 *   `execSync(...)`, which a grep reports as an offender that does not exist;
 * - prettier breaks a call across five lines, so the callee and its options
 *   object never share a line and a grep pairs them with the wrong call;
 * - the same identifiers appear in prose, in `@module` headers, and in this
 *   file's own constants.
 *
 * A parse costs a few milliseconds per file and gets all three right.
 *
 * ## Why the rule is "carries a timeout" and nothing more
 *
 * Deliberately the criterion as written, not a stricter one of this scan's own
 * invention. In practice every callsite in the tree reaches the bound through
 * {@link tests/helpers/io-latency-budget}, which pairs the deadline with the
 * completion assertion so a kill cannot be mistaken for empty output — but the
 * thing a guard is allowed to fail a branch for is the stated rule.
 *
 * **There is no exemption list, and there is not going to be one.** An earlier
 * draft of CodySwannGT/lisa#2940 proposed grandfathering the existing callsites
 * and failing only on new ones; that was rejected, because it solves for not
 * being able to fix them all and they can all be fixed. An allowlist added to
 * harden a guard has already become the way around one in this repository.
 * @module tests/helpers/unbounded-spawn-scan
 */
import ts from "typescript";

/**
 * The synchronous child starts this scan governs.
 *
 * The three that block the calling thread. Their asynchronous siblings return
 * to the event loop, so the per-case budget can still fire over them and they
 * are a different problem with a different remedy.
 */
export const SYNCHRONOUS_CHILD_STARTS: readonly string[] = [
  "spawnSync",
  "execFileSync",
  "execSync",
];

/** Option that makes a child start bounded. */
const DEADLINE_OPTION = "timeout";

/**
 * Name of the function a call expression invokes, ignoring how it is reached.
 *
 * Both `execSync(...)` and `childProcess.execSync(...)` start the same child;
 * a scan that knew only the bare identifier would be walked around by an
 * import style.
 * @param callee - Expression in the callee position
 * @returns The invoked name, or undefined when it is computed
 */
function calleeName(callee: ts.Expression): string | undefined {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/**
 * Whether an argument is an options object that states a deadline.
 *
 * A `ConditionalExpression` counts when EITHER branch states one, and that is
 * not a convenience — it is what keeps this scan honest inside Stryker's
 * sandbox. Stryker instruments a bounded call by rewriting the options object
 * into a conditional:
 *
 * ```js
 * spawnSync(cmd, args, stryMutAct_9fa48("123") ? {} : { timeout: 5000 });
 * ```
 *
 * so a scan that insists on an object literal reports every bounded call in a
 * mutate target as unbounded — measured on a DRY RUN, before a single mutant
 * was active. Reading the file as text does not help: the instrumentation is
 * written into the sandbox's own copy on disk, so a text read gets the
 * rewritten source like any other reader.
 *
 * That false positive is worse than a missed one here. This scan's job is to go
 * red over call sites that genuinely fail open and STAY honest; one that cries
 * wolf inside the sandbox gets "fixed" by adding the exemption list
 * CodySwannGT/lisa#2940 explicitly ruled out, and the exemption then outlives
 * the reason for it.
 *
 * EITHER, not both, and the asymmetry is deliberate rather than sloppy. The
 * instrumented form's mutant branch is `{}` — no deadline — so requiring every
 * branch to state one would flag exactly the case this clause exists to
 * tolerate. The question being asked is "does the SOURCE state a deadline",
 * and under instrumentation the source is the branch Stryker did not write.
 *
 * The cost, stated rather than hidden: a hand-written
 * `cond ? { timeout: 1 } : {}` reads as bounded when one of its paths is not.
 * That is a real false negative. It is accepted because the alternative
 * misfires on every bounded call in every mutate target, and because a
 * hand-written conditional in the options position is a shape that does not
 * occur in this tree — if one ever does, it wants rejecting on style long
 * before it reaches this scan.
 *
 * Recursing rather than matching the `stryMutAct_` name deliberately: naming
 * the instrumenter would tie this scan to one tool's internal spelling, and
 * that spelling is a private detail Stryker is free to change.
 * @param argument - One argument of a child-start call
 * @returns Whether any path it can take states a `timeout`
 */
function statesDeadline(argument: ts.Expression): boolean {
  if (ts.isConditionalExpression(argument)) {
    return (
      statesDeadline(argument.whenTrue) || statesDeadline(argument.whenFalse)
    );
  }
  if (!ts.isObjectLiteralExpression(argument)) return false;
  return argument.properties.some(
    property =>
      property.name !== undefined &&
      ts.isIdentifier(property.name) &&
      property.name.text === DEADLINE_OPTION
  );
}

/**
 * Find every unbounded synchronous child start in one source file.
 *
 * Pure over `(name, source)` rather than reading the disk itself, so the
 * detector can be pointed at a source containing a known offender. Both arms
 * of the guard this feeds otherwise scan a clean tree and assert `[]`, which
 * proves the scan RAN and says nothing about whether it can fail — the exact
 * shape of façade this whole effort exists to remove.
 * @param name - Repository-relative path, for the diagnostic
 * @param source - The file's text
 * @returns One `path:line: text` entry per unbounded child start
 */
export function unboundedSpawns(
  name: string,
  source: string
): readonly string[] {
  const parsed = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  /**
   * The offender this node is, if it is one.
   * @param node - One node of the parsed source
   * @returns A `path:line: callee` entry, or undefined
   */
  const offenderAt = (node: ts.Node): string | undefined => {
    if (!ts.isCallExpression(node)) return undefined;
    const invoked = calleeName(node.expression);
    if (invoked === undefined || !SYNCHRONOUS_CHILD_STARTS.includes(invoked)) {
      return undefined;
    }
    if (node.arguments.some(argument => statesDeadline(argument))) {
      return undefined;
    }
    const at =
      parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
    return `${name}:${at}: ${invoked}`;
  };

  /**
   * Every offender at or below one node, in source order.
   * @param node - Subtree root
   * @returns Offender entries from the subtree
   */
  const collect = (node: ts.Node): readonly string[] => {
    const here = offenderAt(node);
    const below = node.getChildren(parsed).flatMap(collect);
    return here === undefined ? below : [here, ...below];
  };

  return collect(parsed);
}
