/**
 * Find every fixture that stages a shipped script's dependencies by NAME.
 *
 * A fixture that copies a shipped script into a temporary tree has to bring the
 * modules that script imports, or node cannot start it. Naming those modules
 * makes the fixture a second, silent copy of the script's dependency set — one
 * that was correct when it was written and stops being correct the moment the
 * script acquires another import. Nothing fails in between. The fixture keeps
 * passing, which is the problem (CodySwannGT/lisa#3082).
 *
 * When it does finally break, it lies about where. The failure surfaces as
 * `ERR_MODULE_NOT_FOUND` against a path inside `node_modules/@codyswann/lisa/…`,
 * so it reads as the published package missing a file — a far more serious
 * diagnosis than the true one, and one that sends the reader to the npm `files`
 * allowlist instead of to the fixture. One instance was sharper still: a
 * fixture modelling a copy missing `scripts/schemas/` died on a missing MODULE
 * before reaching the readable-envelope path, so the case asserting "no raw
 * stack" failed WITH a raw stack, about a file the fixture itself had chosen
 * not to copy.
 *
 * Five instances were found and repaired in CodySwannGT/lisa#3076 and
 * CodySwannGT/lisa#3080, all with the same one-line fix. This scan exists
 * because fixing five instances does not touch the habit that produced them.
 *
 * ## The rule, and what it deliberately does NOT match
 *
 * > **A directory a shipped script imports INTO is a bucket, not a list.** A
 * > fixture may name the scripts it is staging. It may not name the modules
 * > those scripts reach into another directory for — those come as a directory
 * > read, because that is the only form that moves when the imports move.
 *
 * Three shapes that name a module and are left alone, each of them real code in
 * this tree rather than a hypothetical:
 *
 * - **Naming the subject.** `deploy-gate-blocks-release.test.ts` copies
 *   `lisa-gates.mjs` and `lisa-run-gates.mjs` by name — two entry points that
 *   sit flat beside each other, one importing the other — and copies their
 *   `lib/` as a DIRECTORY. That is the safe form, and it has to clear the scan
 *   or nobody adopts it. A flat `./sibling.mjs` import is a peer the fixture
 *   chose; it is not a bucket whose membership drifts.
 * - **Naming without staging.** `plugin-sync-scripts.test.ts` writes the
 *   literal `invoked-as-script.mjs` several times to build the paths its
 *   assertions expect the build to produce. It never copies it. The scan is
 *   anchored on the copy call, not on the string.
 * - **Reading the bucket.** `conflict-prover-consumer-layouts.test.ts` copies
 *   `lib/` entry by entry from a `readdirSync`, so the basename is a loop
 *   variable rather than a literal and there is no roster to fall behind.
 *
 * ## The scan carries no roster of its own
 *
 * The set of "modules a fixture must not name" is DERIVED, every run, from the
 * import statements of the shipped scripts themselves. A scan that carried its
 * own list would be this defect one level up: correct when written, rotting the
 * next time a script grew an import, and reporting clean throughout. When
 * `lisa-gates.mjs` gains a second `./lib/` import, this scan knows about it
 * without being edited.
 *
 * ## Why an AST rather than a grep, and why not ast-grep or ESLint
 *
 * The literal almost never sits at the copy call. It arrives through a
 * module-level `const`, through `path.join(REPO_ROOT, …)` whose head is opaque,
 * or through a `for … of` over an array of names declared eighty lines earlier.
 * A line-oriented scan sees none of those, and a per-file matcher — ast-grep or
 * an ESLint rule — cannot answer the question at all, because the question is
 * "does another file import this one, and from where", which lives in a second
 * file's import statements. Both would have to be handed the roster the scan
 * exists to avoid.
 * @module tests/helpers/staged-dependency-scan
 */
import * as path from "node:path";

import ts from "typescript";

/** The copy calls a fixture stages a file with, however they are reached. */
const COPY_CALLS: readonly string[] = [
  "copyFileSync",
  "copyFile",
  "copySync",
  "cpSync",
  "copy",
];

/** Path builders whose trailing literal arguments are path segments. */
const PATH_JOINERS: readonly string[] = ["join", "resolve"];

/** How deep an identifier chain is followed before the fold gives up. */
const MAX_FOLD_DEPTH = 12;

/** Repository-relative module path to the modules it imports. */
export type ModuleGraph = ReadonlyMap<string, ReadonlySet<string>>;

/** What one fixture stages, and which of those stagings are enumerations. */
export interface StagingReport {
  /** Shipped modules this fixture copies by literal name. */
  readonly staged: readonly string[];
  /** One `path:line: module` entry per named dependency. */
  readonly offenders: readonly string[];
}

/** A path expression folded to whatever trailing segments are literal. */
interface Folded {
  /** Trailing path segments that are known literally. */
  readonly segments: readonly string[];
  /** Whether those segments are the WHOLE path rather than a suffix. */
  readonly whole: boolean;
}

/** A path expression nothing can be read off. */
const OPAQUE: readonly Folded[] = [{ segments: [], whole: false }];

/**
 * Name of the function a call expression invokes, ignoring how it is reached.
 *
 * `fs.copySync(…)` and `copySync(…)` stage the same file; a scan that knew only
 * the bare identifier would be walked around by an import style.
 * @param callee - Expression in the callee position
 * @returns The invoked name, or undefined when it is computed
 */
function calleeName(callee: ts.Expression): string | undefined {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/**
 * Split a literal path fragment into segments.
 *
 * A fragment containing `..` is treated as unreadable rather than kept: this
 * scan matches by path SUFFIX, and `REPO_ROOT` is spelled
 * `path.resolve(__dirname, "..", "..", "..")` in nearly every suite here. Kept,
 * those dots prepend themselves to the suffix and every match silently fails —
 * a scan that finds nothing because it is asking a malformed question.
 * @param text - A literal path or path fragment
 * @returns Its segments, or none when it walks upward
 */
function segmentsOf(text: string): readonly string[] {
  const parts = text.split("/").filter(part => part.length > 0 && part !== ".");
  return parts.includes("..") ? [] : parts;
}

/**
 * Fold a path expression to the trailing segments that are literal.
 *
 * Returns SEVERAL candidates rather than one, because the canonical spelling of
 * this defect is a literal array consumed by a loop:
 *
 * ```ts
 * const DEPENDENCIES = [join("lib", "invoked-as-script.mjs"), …];
 * for (const dependency of DEPENDENCIES) copySync(join(SRC, dependency), …);
 * ```
 *
 * The copy call's argument is one expression; what it can be is the whole
 * array. A fold that returned a single answer would be blind to the clearest
 * instance shape there is — the one that literally IS a list.
 * @param node - A path expression
 * @param bindings - Module-level consts and `for … of` bindings in scope
 * @param depth - Guard against a cyclic identifier chain
 * @returns Every path this expression can be, folded as far as literals allow
 */
function fold(
  node: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  depth = 0
): readonly Folded[] {
  if (depth > MAX_FOLD_DEPTH) return OPAQUE;
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return fold(node.expression, bindings, depth + 1);
  }
  if (ts.isIdentifier(node)) {
    const bound = bindings.get(node.text);
    return bound === undefined ? OPAQUE : fold(bound, bindings, depth + 1);
  }
  return foldConstruct(node, bindings, depth);
}

/**
 * Fold the expressions that BUILD a path rather than stand for one.
 *
 * Split from {@link fold} only to keep either half readable; the two are one
 * recursion.
 * @param node - A path expression that is not a name or a wrapper
 * @param bindings - Module-level consts and `for … of` bindings in scope
 * @param depth - Guard against a cyclic identifier chain
 * @returns Every path this expression can be
 */
function foldConstruct(
  node: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  depth: number
): readonly Folded[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const segments = segmentsOf(node.text);
    return segments.length === 0 ? OPAQUE : [{ segments, whole: true }];
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap(element => fold(element, bindings, depth + 1));
  }
  if (
    ts.isCallExpression(node) &&
    PATH_JOINERS.includes(calleeName(node.expression) ?? "")
  ) {
    return foldJoin(node.arguments, bindings, depth);
  }
  return OPAQUE;
}

/**
 * Fold `join(…)` / `resolve(…)` from its LAST argument backwards.
 *
 * Backwards because the head is almost always opaque — `REPO_ROOT`, a temp
 * directory, a fixture root — and the tail is the part that names a module. The
 * walk stops at the first argument that is not wholly literal, which is exactly
 * what makes the safe form safe: `join(LIB_DIR, name)` where `name` came from a
 * `readdirSync` folds to nothing, so a directory read can never be an offender.
 * @param args - The joiner's arguments, in source order
 * @param bindings - Module-level consts and `for … of` bindings in scope
 * @param depth - Guard against a cyclic identifier chain
 * @returns Every trailing path this join can produce
 */
function foldJoin(
  args: ts.NodeArray<ts.Expression>,
  bindings: ReadonlyMap<string, ts.Expression>,
  depth: number
): readonly Folded[] {
  const step = (
    index: number,
    tails: readonly (readonly string[])[]
  ): readonly Folded[] => {
    if (index < 0) return tails.map(segments => ({ segments, whole: true }));
    const folds = fold(args[index] as ts.Expression, bindings, depth + 1);
    const grown = tails.flatMap(tail =>
      folds.map(one => [...one.segments, ...tail])
    );
    return folds.some(one => one.whole)
      ? step(index - 1, grown)
      : grown.map(segments => ({ segments, whole: false }));
  };

  return args.length === 0 ? OPAQUE : step(args.length - 1, [[]]);
}

/**
 * Every module-level const and `for … of` binding a fold may follow.
 *
 * A loop binding resolves to the ITERABLE, not to a value, so
 * `for (const dependency of DEPENDENCIES)` makes `dependency` fold to whatever
 * `DEPENDENCIES` can be. That is what reaches the array-of-names shape; it is
 * also what keeps the directory read out of reach, since
 * `for (const name of readdirSync(dir))` folds `name` to a call this scan
 * cannot read and therefore to nothing.
 * @param node - Subtree root
 * @param source - The parsed file, for child traversal
 * @returns Name/expression pairs, outermost first
 */
function bindingsIn(
  node: ts.Node,
  source: ts.SourceFile
): readonly (readonly [string, ts.Expression])[] {
  const here: readonly (readonly [string, ts.Expression])[] =
    ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)
      ? node.initializer.declarations
          .filter(declaration => ts.isIdentifier(declaration.name))
          .map(
            declaration =>
              [
                (declaration.name as ts.Identifier).text,
                node.expression,
              ] as const
          )
      : ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer !== undefined
        ? [[node.name.text, node.initializer] as const]
        : [];
  return [
    ...here,
    ...node.getChildren(source).flatMap(child => bindingsIn(child, source)),
  ];
}

/**
 * Every relative module a source imports, resolved against a known roster.
 *
 * Static imports, re-exports, and dynamic `import()` all count: each one is a
 * file that has to be present for the importer to run, which is the whole
 * question a staging fixture is answering.
 * @param name - Repository-relative path of the importing module
 * @param source - Its text
 * @param known - Repository-relative paths that exist
 * @returns Repository-relative paths it imports
 */
function relativeImports(
  name: string,
  source: string,
  known: ReadonlySet<string>
): readonly string[] {
  const parsed = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );

  /**
   * The module a node imports, if it imports one that exists.
   * @param node - One node of the parsed source
   * @returns A repository-relative path, or undefined
   */
  const importedAt = (node: ts.Node): string | undefined => {
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length > 0 &&
            ts.isStringLiteral(node.arguments[0] as ts.Expression)
          ? (node.arguments[0] as ts.StringLiteral).text
          : undefined;
    if (specifier === undefined || !specifier.startsWith(".")) return undefined;
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(name), specifier)
    );
    return known.has(resolved) ? resolved : undefined;
  };

  /**
   * Every imported module at or below one node.
   * @param node - Subtree root
   * @returns Repository-relative paths from the subtree
   */
  const collect = (node: ts.Node): readonly string[] => {
    const here = importedAt(node);
    const below = node.getChildren(parsed).flatMap(collect);
    return here === undefined ? below : [here, ...below];
  };

  return collect(parsed);
}

/**
 * Build the import graph the scan derives its answers from.
 * @param sources - Repository-relative path to source text, for every module
 * @returns Each module mapped to the modules it imports
 */
export function moduleGraph(sources: ReadonlyMap<string, string>): ModuleGraph {
  const known = new Set(sources.keys());
  return new Map(
    [...sources].map(([name, text]) => [
      name,
      new Set(relativeImports(name, text, known)),
    ])
  );
}

/**
 * Every module reachable from a set of roots, roots included.
 * @param graph - The import graph
 * @param roots - Where to start
 * @returns The transitive closure
 */
function reachableFrom(
  graph: ModuleGraph,
  roots: ReadonlySet<string>
): ReadonlySet<string> {
  const step = (
    frontier: ReadonlySet<string>,
    seen: ReadonlySet<string>
  ): ReadonlySet<string> => {
    const next = new Set(
      [...frontier]
        .flatMap(module => [...(graph.get(module) ?? [])])
        .filter(module => !seen.has(module))
    );
    return next.size === 0 ? seen : step(next, new Set([...seen, ...next]));
  };

  return step(roots, roots);
}

/**
 * Whether an import descends INTO a directory below the importer's own.
 *
 * This is the whole discriminator. `./lisa-gates.mjs` is a peer sitting flat
 * beside its importer; `./lib/invoked-as-script.mjs` is one member of a bucket
 * whose membership is the thing that moves. Only the second is a roster.
 * @param importer - Repository-relative path of the importing module
 * @param imported - Repository-relative path of the imported module
 * @returns Whether the import descends
 */
function descends(importer: string, imported: string): boolean {
  return path.posix
    .dirname(imported)
    .startsWith(`${path.posix.dirname(importer)}/`);
}

/**
 * Modules a fixture must not name, given what it stages.
 * @param graph - The import graph
 * @param staged - Modules the fixture copies by literal name
 * @returns Modules reached by a descending import from the staged closure
 */
function bucketMembers(
  graph: ModuleGraph,
  staged: ReadonlySet<string>
): ReadonlySet<string> {
  return new Set(
    [...reachableFrom(graph, staged)].flatMap(importer =>
      [...(graph.get(importer) ?? [])].filter(imported =>
        descends(importer, imported)
      )
    )
  );
}

/**
 * Shipped modules one fixture stages by literal name, and which are rosters.
 *
 * Pure over `(name, source, graph)` rather than reading the disk itself, so the
 * detector can be pointed at a source containing a known offender. A guard that
 * only ever scans a clean tree and asserts `[]` proves that it RAN and says
 * nothing about whether it can fail.
 * @param name - Repository-relative path, for the diagnostic
 * @param source - The file's text
 * @param graph - The import graph derived from the shipped modules
 * @returns What the fixture stages, and one entry per named dependency
 */
export function stagedScriptCopies(
  name: string,
  source: string,
  graph: ModuleGraph
): StagingReport {
  const modules = [...graph.keys()];
  const parsed = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const bindings = new Map(bindingsIn(parsed, parsed));

  /**
   * Known modules a folded suffix can name.
   *
   * Matched by suffix because a fixture spells its source relative to an opaque
   * root, and at a segment boundary because `gates.mjs` must not answer for
   * `lisa-gates.mjs`.
   * @param segments - Trailing literal path segments
   * @returns Repository-relative paths the suffix matches
   */
  const named = (segments: readonly string[]): readonly string[] => {
    if (segments.length === 0) return [];
    const suffix = segments.join("/");
    return modules.filter(
      module => module === suffix || module.endsWith(`/${suffix}`)
    );
  };

  /**
   * Every copy call in the file, with the modules its source can name.
   * @param node - Subtree root
   * @returns One entry per copy call that names at least one known module
   */
  const copies = (
    node: ts.Node
  ): readonly {
    readonly line: number;
    readonly named: readonly string[];
  }[] => {
    const here =
      ts.isCallExpression(node) &&
      COPY_CALLS.includes(calleeName(node.expression) ?? "") &&
      node.arguments.length > 0
        ? [
            ...new Set(
              fold(node.arguments[0] as ts.Expression, bindings).flatMap(one =>
                named(one.segments)
              )
            ),
          ]
        : [];
    const below = node.getChildren(parsed).flatMap(copies);
    return here.length === 0
      ? below
      : [
          {
            line:
              parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line +
              1,
            named: here,
          },
          ...below,
        ];
  };

  const found = copies(parsed);
  const staged = new Set(found.flatMap(one => one.named));
  const buckets = bucketMembers(graph, staged);
  return {
    staged: [...staged],
    offenders: found.flatMap(one => {
      const rosters = one.named.filter(module => buckets.has(module));
      return rosters.length === 0
        ? []
        : [`${name}:${one.line}: ${rosters.join(", ")}`];
    }),
  };
}
