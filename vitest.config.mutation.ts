/**
 * Vitest configuration used only by the mutation gate (`bun run test:mutation`).
 *
 * The gate asks one question of the guard scripts: can their tests fail? Stryker
 * answers it by flipping a branch and re-running the tests, so the run has to be
 * pointed at the suites that exercise those scripts **in-process**, and at
 * nothing else. Two separate reasons, both measured on this repository:
 *
 * 1. Stryker runs the suite inside a sandbox copy of the tree. Suites that read
 *    the real working tree, its git history, or their own file's bytes fail
 *    there for reasons that have nothing to do with a mutant, and one red test
 *    in the dry run aborts the whole gate before a single mutant is tried.
 * 2. Every extra test file is paid on the dry run and again on any mutant that
 *    touches it, because mutant activation is a process global and the runner
 *    pins the pool to a single worker.
 *
 * The include list is DERIVED, never hand-written. A hand-written list is the
 * failure this gate exists to catch: it goes stale in silence, and a guard whose
 * only suite dropped out of the list reports a perfect score because nothing
 * ran. So the list is computed from `stryker.conf.json` itself — every test file
 * that reaches a mutated script through static `import` declarations, directly
 * or through a test helper. Add a guard to the mutate list and its suites join
 * the run on their own.
 *
 * A static import is the requirement, not a style preference. `import()` of a
 * URL assembled at runtime is invisible to Vite's module graph, so neither this
 * resolver nor Stryker's own related-files filter can see the edge, and every
 * mutant in that guard is reported as uncovered.
 * @module vitest.config.mutation
 */
import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";
import type { ViteUserConfig } from "vitest/config";

const ROOT = import.meta.dirname;
const TESTS_DIR = path.join(ROOT, "tests");

/** Only unit suites are eligible; integration suites drive real subprocesses. */
const ELIGIBLE_PREFIX = `tests${path.sep}unit${path.sep}`;

/**
 * Every `.ts` file beneath a directory, as absolute paths.
 * @param dir - Directory to walk
 * @returns Absolute paths of every `.ts` file beneath `dir`
 */
const walk = (dir: string): readonly string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && full.endsWith(".ts") ? [full] : [];
  });

/**
 * Absolute paths a file statically imports, relative specifiers only.
 *
 * Scanned with TypeScript's own preprocessor rather than by hand. The hand
 * scanner this replaces read only `from "…"` on semicolon-split statements, so
 * it silently dropped single-quoted specifiers, side-effect imports with no
 * `from` clause, and — because splitting on `;` merges two semicolon-free
 * declarations into one segment — every specifier but the last of any such pair.
 * Each omission is invisible: the suite simply never joins the run and the guard
 * it covers reports its mutants as uncovered, which is the exact failure this
 * gate exists to catch, reproduced inside the gate's own resolver.
 *
 * A dynamic `import()` whose specifier is built at runtime reports nothing here,
 * which is correct: Vite cannot see that edge either, so the gate must not claim
 * it. Only a literal specifier is ever resolvable, by this resolver or by Vite.
 *
 * `.js` is also offered as `.ts`, because TypeScript's ESM specifiers name the
 * emitted file while the module on disk is the source.
 * @param file - Absolute path of the importing file
 * @param text - Its source text
 * @returns Absolute paths of the modules it names
 */
const importsOf = (file: string, text: string): readonly string[] =>
  ts
    .preProcessFile(text, true, true)
    .importedFiles.map(imported => imported.fileName)
    .filter(specifier => specifier.startsWith("."))
    .flatMap(specifier => {
      const resolved = path.resolve(path.dirname(file), specifier);
      return resolved.endsWith(".js")
        ? [resolved, `${resolved.slice(0, -3)}.ts`]
        : [resolved];
    });

/**
 * Who imports what, inverted: module → the test-tree files naming it.
 * @returns Importer index over the whole test tree
 */
const importerIndex = (): ReadonlyMap<string, readonly string[]> =>
  walk(TESTS_DIR)
    .flatMap(file =>
      importsOf(file, fs.readFileSync(file, "utf8")).map(
        target => [target, file] as const
      )
    )
    .reduce<Map<string, readonly string[]>>(
      (index, [target, file]) =>
        new Map(index).set(target, [...(index.get(target) ?? []), file]),
      new Map()
    );

/**
 * Everything under `tests/` that reaches a set of modules, transitively.
 *
 * Transitive by design: a suite pulling fixtures from a sibling helper that
 * imports the guard exercises that guard as directly as one importing it itself.
 * @param frontier - Modules discovered on the previous round
 * @param seen - Everything discovered so far
 * @param index - Importer index
 * @returns The closure
 */
const reach = (
  frontier: readonly string[],
  seen: ReadonlySet<string>,
  index: ReadonlyMap<string, readonly string[]>
): ReadonlySet<string> => {
  const next = frontier
    .flatMap(module => index.get(module) ?? [])
    .filter(file => !seen.has(file));
  if (next.length === 0) return seen;
  return reach(next, new Set([...seen, ...next]), index);
};

/**
 * Repo-relative mutate targets declared in `stryker.conf.json`, negations
 * dropped.
 * @returns The guard scripts the gate mutates
 */
export const mutatedGuards = (): readonly string[] => {
  const conf = JSON.parse(
    fs.readFileSync(path.join(ROOT, "stryker.conf.json"), "utf8")
  ) as { readonly mutate?: readonly string[] };
  return (conf.mutate ?? []).filter(entry => !entry.startsWith("!"));
};

/**
 * The eligible unit suites inside a reachability closure, repo-relative.
 * @param seeds - Absolute paths of the modules to start from
 * @param index - Importer index
 * @returns Sorted repo-relative suite paths
 */
const suitesReaching = (
  seeds: readonly string[],
  index: ReadonlyMap<string, readonly string[]>
): readonly string[] =>
  [...reach(seeds, new Set(seeds), index)]
    .filter(file => file.endsWith(".test.ts"))
    .map(file => path.relative(ROOT, file))
    .filter(rel => rel.startsWith(ELIGIBLE_PREFIX))
    .sort((a, b) => a.localeCompare(b));

/**
 * Which unit suites reach each mutated guard.
 *
 * A guard mapping to an empty list is the silent-green case in miniature: every
 * one of its mutants is reported uncovered, it contributes nothing but
 * denominator, and the aggregate can still clear the floor. The
 * `mutation-gate-wiring` suite asserts this map has no empty entry.
 * @returns Guard path → the unit suites that statically reach it
 */
export const suitesByGuard = (): ReadonlyMap<string, readonly string[]> => {
  const index = importerIndex();
  return new Map(
    mutatedGuards().map(guard => [
      guard,
      suitesReaching([path.resolve(ROOT, guard)], index),
    ])
  );
};

/**
 * The guards a diff-scoped run is actually mutating.
 *
 * `scripts/lisa-mutation.mjs` — the shipped gate — passes Stryker `--mutate`
 * for only the changed line ranges and exports the same list as
 * `MUTATION_SCOPE`.
 * Without this, the dry run still loads every suite that reaches ANY mutate
 * target, and the dry run is the fixed cost that a diff-scoped run cannot
 * otherwise shrink: it was measured at 159s of the whole gate's work.
 *
 * A suite that cannot reach a mutated guard cannot kill one of its mutants, so
 * dropping it is free. That also bounds the damage from a wrong value here:
 * narrowing only ever removes kills, so every reachable setting of
 * `MUTATION_SCOPE` lowers the score or leaves it alone. It is not a bypass.
 *
 * An unrecognised scope falls back to the whole list rather than to nothing —
 * running everything is slow, running nothing is a gate that reports success
 * having mutated nothing.
 * @returns The mutate targets this run is scoped to
 */
export const scopedGuards = (): readonly string[] => {
  const requested = (process.env.MUTATION_SCOPE ?? "")
    .split(",")
    // Stryker's `path:start-end` suffix narrows mutation instrumentation, but
    // the importer index is keyed by the path alone. Keeping the suffix here
    // makes every line-scoped run look unrecognised and silently falls back to
    // every guard suite — restoring the multi-minute dry-run cost this scope
    // exists to remove.
    .map(entry =>
      path.normalize(
        entry.trim().replace(/:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/u, "")
      )
    )
    .filter(Boolean);
  const declared = mutatedGuards();
  if (requested.length === 0) return declared;
  const wanted = new Set(requested);
  const narrowed = declared.filter(guard => wanted.has(path.normalize(guard)));
  return narrowed.length > 0 ? narrowed : declared;
};

/**
 * Every unit suite that reaches at least one mutated guard.
 * @returns Repo-relative suite paths for vitest's `include`
 */
export const suitesReachingGuards = (): readonly string[] =>
  suitesReaching(
    scopedGuards().map(guard => path.resolve(ROOT, guard)),
    importerIndex()
  );

/**
 * Narrow the derived list to an explicitly requested subset.
 *
 * `LISA_MUTATION_SUITES` exists for the gate's own bite test, which has to run a
 * guard's suites with one of them withheld and prove the gate goes red. It is an
 * INTERSECTION, never a replacement, and that is what keeps it from becoming a
 * bypass: withholding a suite can only remove kills, so every reachable value of
 * this variable lowers the score or leaves it alone. No setting of it turns a
 * failing gate green.
 * @param derived - Suites discovered from the mutate list
 * @returns The suites to run
 */
const requestedSubsetOf = (derived: readonly string[]): readonly string[] => {
  const requested = (process.env.LISA_MUTATION_SUITES ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
  if (requested.length === 0) return derived;
  const wanted = new Set(requested.map(entry => path.normalize(entry)));
  return derived.filter(suite => wanted.has(path.normalize(suite)));
};

/**
 * The narrowed config, resolved lazily.
 *
 * The base config is loaded inside the factory rather than at module scope, and
 * that is not a style choice. `./vitest.config` resolves this package's own
 * built entry points, so importing it eagerly would make the two suites that
 * import the helpers above fail to collect whenever `dist/` is stale or absent —
 * a test that cannot even load is the loudest possible version of the silence
 * this gate exists to remove. Vitest accepts a function here and calls it.
 * @returns The mutation-gate vitest config
 */
export default async (): Promise<ViteUserConfig> => {
  const { default: baseConfig } = await import("./vitest.config");
  return {
    ...baseConfig,
    test: {
      ...baseConfig.test,
      include: [...requestedSubsetOf(suitesReachingGuards())],
      coverage: { enabled: false },
    },
  };
};
