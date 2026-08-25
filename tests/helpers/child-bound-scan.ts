/**
 * Static scan of this tree's test sources, for the two budgets a case runs under.
 *
 * Line-oriented and syntactic on purpose. Parsing would report the same thing
 * at ten times the cost, and both defects are legible at exactly this
 * resolution: a number standing where a calibrated call belongs, and a child's
 * deadline standing at or above the deadline of the case that started it.
 *
 * Lives beside the helper it judges rather than inside the suite that runs it,
 * because the suite is where the CASES belong and this is where the machinery
 * does — and because `max-lines` is a real constraint that a scan and its
 * evidence cannot share.
 * @module tests/helpers/child-bound-scan
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { resolveGit } from "../support/git-executable.js";
import {
  MAX_SPAWN_SLOWDOWN,
  boundedSpawnSync,
  caseBudgetFailure,
  liveCaseBudgetMs,
  scaledCaseBudgetFailure,
} from "./io-latency-budget.js";

/** Repository root, resolved from this module rather than from a caller. */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Whether a line is commentary rather than code.
 *
 * Found the hard way: the conformance suite's own comment about the options
 * spelling was reflowed by prettier so the literal it names landed on a `//`
 * line, and the scan reported the guard as its own offender. A budget written
 * in prose runs nothing, and a doc comment discussing a budget is how a scan
 * like this gets explained. Commented-out code is covered by the same rule and
 * correctly so — it is not a budget until somebody uncomments it, at which
 * point the line stops being prose and the scan sees it.
 * @param line - One trimmed source line
 * @returns Whether the line is a comment
 */
export function isProse(line: string): boolean {
  return line.startsWith("//") || line.startsWith("*") || line.startsWith("/*");
}

/**
 * Read a fragment as a bare numeric budget.
 * @param text - Source fragment standing in the budget position
 * @returns Its value, or undefined when it is not a bare number
 */
export function bareBudgetValue(text: string): number | undefined {
  if (!/^\d[\d_]*$/u.test(text)) return undefined;
  return Number(text.replaceAll("_", ""));
}

/**
 * Helper calls whose `baseMs` really becomes a child's kill deadline.
 *
 * Keyed on the CALL, never on the file. `caseBudgetFailure`'s own cases pass
 * deliberately-violating triples and would have to be exempted by path
 * otherwise — and a path-shaped exemption is a bypass the moment a real call
 * site moves into an exempted file. `bounded-spawn-sync.test.ts` needs no
 * exemption at all under this rule: its `baseMs: 1` plants are REAL bounded
 * calls, and a base of 1 clears every margin by four orders of magnitude,
 * which is the correct verdict rather than a waived one.
 */
const BOUNDED_CHILD_CALLS: ReadonlySet<string> = new Set([
  "boundedExecFileSync",
  "boundedSpawnSync",
]);

/** Trailing characters of a line that opens a call taking one object literal. */
const CALL_OPENS = "({";

/** One character that may appear inside a JavaScript identifier. */
const IDENTIFIER_CHAR = /[\w$]/u;

/** A `baseMs:` property standing on its own line, as prettier writes one. */
const CHILD_BASE = /^baseMs: ([^\s,]+),?$/u;

/** A module-scope constant bound to a bare number, exported or not. */
const NUMERIC_CONST = /^(?:export )?const ([A-Za-z_$][\w$]*) = (\d[\d_]*);$/u;

/**
 * A named-import clause, and the module specifier it draws from.
 *
 * Anchored to a line start. Without that, a synthetic module written as a
 * quoted string inside a suite — which is how the cases exercise this — is read
 * as that suite's own import, and the scan goes looking for a module that was
 * never meant to exist.
 */
const IMPORT_CLAUSE = /^import \{([^}]*)\} from "([^"]+)";$/gmsu;

/** The call that replaces the flat case budget with a scaled one. */
const SCALED_BUDGET_CALL = /^useIoLatencyBudget\(([^)]*)\);$/u;

/** Export whose value decides the default case budget of a scaling file. */
export const DEFAULT_CASE_BASE = "IO_LATENCY_TEST_TIMEOUT_MS";

/** The call a scaling file imports, and through which its default is found. */
const SCALED_BUDGET_IMPORT = "useIoLatencyBudget";

/**
 * How a module's text is obtained, so the scan can run over synthetic ones.
 *
 * Returns undefined for a path no module sits at. A relative specifier can name
 * something this scan has no source for, and the honest answer there is an
 * unresolved base reported by name — not an exception thrown from the middle of
 * a tree walk.
 */
export type ReadSource = (name: string) => string | undefined;

/** One `baseMs:` handed to a bounded-child helper. */
export interface ChildSite {
  /** One-based line the property is written on. */
  readonly at: number;
  /** Source fragment standing in the base position. */
  readonly token: string;
}

/**
 * Read a module's text as trimmed lines.
 * @param name - Repository-relative path
 * @param read - How to obtain a module's text
 * @returns One trimmed line per source line
 */
function trimmedLines(name: string, read: ReadSource): readonly string[] {
  return (read(name) ?? "").split("\n").map(line => line.trim());
}

/**
 * The identifier a line's trailing `({` belongs to.
 *
 * Spelled with string operations rather than a regex. The obvious pattern
 * scans from every start position on a line of identifier characters, which is
 * super-linear and `sonarjs/slow-regex` refuses it — and the work here is one
 * backwards walk from a fixed suffix.
 * @param line - One trimmed source line
 * @returns The callee's name, or undefined when the line opens no call
 */
function calleeOpening(line: string): string | undefined {
  if (!line.endsWith(CALL_OPENS)) return undefined;
  const head = line.slice(0, -CALL_OPENS.length);
  const back = [...head]
    .reverse()
    .findIndex(character => !IDENTIFIER_CHAR.test(character));
  const name = back === -1 ? head : head.slice(head.length - back);
  return name === "" ? undefined : name;
}

/**
 * Whether the block a line sits directly in was opened by a bounded-child call.
 *
 * Walks up to the enclosing block, stepping OVER any sibling block on the way:
 * `env: buildEnv({ ... }),` above a `baseMs:` would otherwise report `buildEnv`
 * as the target and drop a real site in silence.
 * @param lines - The module's trimmed lines
 * @param index - Zero-based index of the property line
 * @returns Whether a bounded-child helper opened the enclosing block
 */
function insideBoundedCall(lines: readonly string[], index: number): boolean {
  const above = lines
    .slice(0, index)
    .filter(line => !isProse(line))
    .reverse();
  const settled = above.reduce<{
    readonly nested: number;
    readonly opener: string | undefined;
    readonly done: boolean;
  }>(
    (state, line) => {
      if (state.done) return state;
      if (line.startsWith("}")) return { ...state, nested: state.nested + 1 };
      if (!line.endsWith("{")) return state;
      if (state.nested > 0) return { ...state, nested: state.nested - 1 };
      return { ...state, done: true, opener: calleeOpening(line) };
    },
    { nested: 0, opener: undefined, done: false }
  );
  return BOUNDED_CHILD_CALLS.has(settled.opener ?? "");
}

/**
 * Repository-relative target of one relative module specifier.
 * @param from - Repository-relative path of the importing module
 * @param specifier - The specifier as written, with its `.js` extension
 * @returns Repository-relative path of the imported `.ts` module
 */
function moduleTarget(from: string, specifier: string): string {
  return path.posix.normalize(
    path.posix.join(
      path.posix.dirname(from),
      specifier.replace(/\.js$/u, ".ts")
    )
  );
}

/**
 * Map each name a module imports to the module it came from.
 *
 * Only relative specifiers: a package import leaves this tree, and a base that
 * came from one is reported unresolved rather than guessed at.
 * @param name - Repository-relative path of the importing module
 * @param read - How to obtain a module's text
 * @returns Local name to repository-relative path of its source module
 */
export function importedFrom(
  name: string,
  read: ReadSource
): ReadonlyMap<string, string> {
  return new Map(
    [...(read(name) ?? "").matchAll(IMPORT_CLAUSE)]
      .filter(clause => (clause[2] ?? "").startsWith("."))
      .flatMap(clause =>
        (clause[1] ?? "")
          .split(",")
          .map(raw =>
            raw
              .trim()
              .replace(/^type /u, "")
              .split(" as ")[0]
              ?.trim()
          )
          .filter(
            (local): local is string => local !== undefined && local !== ""
          )
          .map(local => [local, moduleTarget(name, clause[2] ?? "")] as const)
      )
  );
}

/**
 * Resolve a source fragment to the number it denotes.
 *
 * Follows a name to its binding, and a binding to the module it was imported
 * from, because the three forms in this tree are a literal (`baseMs: 30_000`),
 * a local constant (`LEDGER_CHECK_BASE_MS`) and an imported one
 * (`HOOK_RUN_BUDGET_MS`, declared two directories away). A scan that skipped
 * what it could not parse would be the inert guard one layer down — so an
 * unresolvable form returns undefined and is REPORTED, never dropped.
 * @param name - Repository-relative path of the module the fragment is written in
 * @param token - The fragment
 * @param read - How to obtain a module's text
 * @param seen - Bindings already followed, so a cycle terminates
 * @returns The value, or undefined when no bare number backs it
 */
export function numberBehind(
  name: string,
  token: string,
  read: ReadSource,
  seen: ReadonlySet<string> = new Set()
): number | undefined {
  const literal = bareBudgetValue(token);
  if (literal !== undefined) return literal;
  const key = `${name}#${token}`;
  if (seen.has(key)) return undefined;
  const followed = new Set([...seen, key]);
  for (const line of trimmedLines(name, read)) {
    if (isProse(line)) continue;
    const bound = NUMERIC_CONST.exec(line);
    if (bound?.[1] === token) return bareBudgetValue(bound[2] ?? "");
  }
  const source = importedFrom(name, read).get(token);
  if (source === undefined) return undefined;
  return numberBehind(source, token, read, followed);
}

/**
 * Find every bounded-child base a module hands the helper.
 * @param name - Repository-relative path
 * @param read - How to obtain a module's text
 * @returns One entry per `baseMs:` passed to a bounded-child helper
 */
export function childSites(
  name: string,
  read: ReadSource
): readonly ChildSite[] {
  const lines = trimmedLines(name, read);
  return lines.flatMap((line, index) => {
    if (isProse(line)) return [];
    const base = CHILD_BASE.exec(line);
    if (base === null) return [];
    if (!insideBoundedCall(lines, index)) return [];
    return [{ at: index + 1, token: base[1] ?? "" }];
  });
}

/**
 * The quiet-box base a module's case budget scales from, when it scales at all.
 * @param name - Repository-relative path
 * @param read - How to obtain a module's text
 * @returns The case budget's base, or undefined when the module keeps the flat one
 */
export function caseBaseMs(name: string, read: ReadSource): number | undefined {
  for (const line of trimmedLines(name, read)) {
    if (isProse(line)) continue;
    const call = SCALED_BUDGET_CALL.exec(line);
    if (call === null) continue;
    const argument = (call[1] ?? "").trim();
    if (argument !== "") return numberBehind(name, argument, read);
    // The default lives in the helper, and almost no caller imports its NAME —
    // they import the function. So follow the function to its module and read
    // the default there. Restating 60,000 here instead would agree with the
    // helper right up until somebody re-derived it, which is the shape of
    // staleness this whole scan exists to catch.
    const helper = importedFrom(name, read).get(SCALED_BUDGET_IMPORT);
    return helper === undefined
      ? undefined
      : numberBehind(helper, DEFAULT_CASE_BASE, read);
  }
  return undefined;
}

/**
 * Every module one suite reaches, itself included.
 *
 * Recursive rather than a worklist loop, so the frontier is a value at each
 * step instead of an array being pushed into. The recursion is bounded by the
 * module count, since a module enters `seen` at most once.
 * @param from - Repository-relative path of the suite to start at
 * @param edges - Module path to the modules it imports
 * @returns Every module reachable from the starting one
 */
function reachableFrom(
  from: string,
  edges: ReadonlyMap<string, readonly string[]>
): ReadonlySet<string> {
  const grow = (
    frontier: readonly string[],
    seen: ReadonlySet<string>
  ): ReadonlySet<string> => {
    const next = [
      ...new Set(
        frontier.flatMap(at =>
          (edges.get(at) ?? []).filter(to => !seen.has(to))
        )
      ),
    ];
    return next.length === 0 ? seen : grow(next, new Set([...seen, ...next]));
  };
  return grow([from], new Set([from]));
}

/**
 * The suites whose case budget governs each module's bounded children.
 *
 * A suite governs itself. A support module is governed by every suite that
 * reaches it transitively, and by the FLAT budget when none does — the
 * strictest reading available, so a module whose caller this scan cannot see is
 * judged hard rather than waved through.
 * @param modules - Every tracked module under `tests`
 * @param read - How to obtain a module's text
 * @returns Module path to the suites that govern it
 */
export function governedBy(
  modules: readonly string[],
  read: ReadSource
): ReadonlyMap<string, readonly string[]> {
  const edges = new Map(
    modules.map(name => [name, [...importedFrom(name, read).values()]])
  );
  const reached = modules
    .filter(name => name.endsWith(".test.ts"))
    .map(suite => ({ suite, modules: reachableFrom(suite, edges) }));
  return new Map(
    modules.map(name => [
      name,
      reached.filter(from => from.modules.has(name)).map(from => from.suite),
    ])
  );
}

/**
 * Judge every bounded child one module starts, under one owner's case budget.
 *
 * `owner` is the suite whose budget actually governs: for a `.test.ts` that is
 * itself, and for a support module it is each suite that reaches it. The two
 * differ, and assuming otherwise would have missed a real inverted site —
 * `tests/integration/support/rails-learnings-budget-gate.ts` spawns a child at
 * a 30,000ms base on behalf of a suite that did not scale its case budget.
 * @param name - Repository-relative path of the module holding the call sites
 * @param owner - Repository-relative path of the suite whose budget governs
 * @param read - How to obtain a module's text
 * @returns One `path:line: message` entry per site that fails the relation
 */
export function childBoundFailures(
  name: string,
  owner: string,
  read: ReadSource
): readonly string[] {
  const caseBase = caseBaseMs(owner, read);
  const via = name === owner ? "" : ` (started for ${owner})`;
  return childSites(name, read).flatMap(site => {
    const baseMs = numberBehind(name, site.token, read);
    if (baseMs === undefined) {
      return [
        `${name}:${site.at}${via}: \`${site.token}\` does not resolve to a ` +
          `number this scan can read, so its bound cannot be judged. Bind it ` +
          `to a bare numeric constant, or pass the literal.`,
      ];
    }
    const failure =
      caseBase === undefined
        ? caseBudgetFailure({
            baseMs,
            maxSlowdown: MAX_SPAWN_SLOWDOWN,
            caseBudgetMs: liveCaseBudgetMs(),
          })
        : scaledCaseBudgetFailure({ baseMs, caseBaseMs: caseBase });
    return failure === undefined
      ? []
      : [`${name}:${site.at}${via}: ${failure}`];
  });
}

/**
 * Every tracked module under `tests`, suites and their support modules alike.
 *
 * `.ts`, not `.test.ts`. A support module's bounded children run inside
 * whichever suite imported it, so a scan restricted to suites examines the call
 * sites one import away not at all — which is where two of them live.
 *
 * Derived from `git ls-files` rather than a hardcoded roster: a hand-written
 * list stops covering the tree the moment somebody adds a module, and the
 * omission is silent.
 * @returns Repository-relative paths
 */
export function trackedTestModules(): readonly string[] {
  // `resolveGit()` rather than a bare "git": the lint ruleset refuses a command
  // resolved through a writeable PATH (`sonarjs/no-os-command-from-path`).
  const listed = boundedSpawnSync({
    label: "git ls-files tests",
    command: resolveGit(),
    args: ["ls-files", "tests"],
    cwd: REPO_ROOT,
    baseMs: 30_000,
  });
  return listed.stdout.split("\n").filter(name => name.endsWith(".ts"));
}

/**
 * Read a module's source from disk, or report that there is none.
 * @param name - Repository-relative path
 * @returns The file's text, or undefined when nothing sits at that path
 */
export function moduleSource(name: string): string | undefined {
  const at = path.join(REPO_ROOT, name);
  return existsSync(at) ? readFileSync(at, "utf8") : undefined;
}

/**
 * Judge every bounded child in the tree, under the budget that governs it.
 * @param read - How to obtain a module's text
 * @returns One entry per failing site
 */
export function treeChildBoundFailures(read: ReadSource): readonly string[] {
  const modules = trackedTestModules();
  const owners = governedBy(modules, read);
  return modules.flatMap(name => {
    const governing = owners.get(name) ?? [];
    if (governing.length === 0) return childBoundFailures(name, name, read);
    return governing.flatMap(owner => childBoundFailures(name, owner, read));
  });
}
