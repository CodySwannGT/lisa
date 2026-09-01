/**
 * CI gate for the canonical project learnings document and its hard budgets.
 *
 * With ONE argument it checks that file and nothing else, which is what the
 * `📚 Learnings Budget` job's consumer path uses.
 *
 * With ZERO arguments it checks TWO files: the shipped template, and this
 * repository's own ledger resolved the way the contract resolves it. It used to
 * check only the template — 0 entries, so it passed unconditionally — which
 * made `bun run check:learnings-budget` look like a gate on the ledger and act
 * like a gate on nothing. The quality job worked around that by passing the
 * resolved path explicitly, and the comment there said so out loud: "passing
 * the real path explicitly is what keeps this a gate and not a silent no-op."
 * A default whose only safe use is not using it is a trap, so the default now
 * covers both surfaces and the workaround is no longer load-bearing (#2932).
 *
 * The two surfaces are genuinely different and both matter: the template is
 * what every adopting project starts from, and the ledger is what this
 * repository's agents actually read. Both are committed in a source checkout,
 * so a missing one there is a failure — see `checkDefaultSurfaces` for why the
 * ledger's absence used to be a pass and no longer is. Running from the
 * published package, where no tarball carries a ledger, its absence stays the
 * ordinary quiet pass.
 *
 * A within-budget ledger reports one of TWO verdicts, not one: `learnings
 * budget passed` while room remains, and `learnings budget saturated` once the
 * next capture would not fit (#3089). Both exit 0. The reasoning for warning
 * rather than failing lives on `describeLearningsSaturation` in the core.
 * @module scripts/check-learnings-budget
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type * as BudgetCheckModule from "../src/core/learnings-budget-check.js";
import type * as ConfiguredPathModule from "../src/core/configured-learnings-path.js";
import type * as OverflowPathModule from "../src/core/learnings-overflow-path.js";

type BudgetChecker = Pick<
  typeof BudgetCheckModule,
  "checkLearningsBudget" | "formatBudgetVerdict" | "formatDiagnosticPath"
>;

const REPO_ROOT = path.resolve(import.meta.dir, "..");

const TEMPLATE_LEARNINGS_FILE = path.resolve(
  REPO_ROOT,
  "all",
  "create-only",
  ".lisa",
  "PROJECT_LEARNINGS.md"
);

/**
 * This repository's own ledger, resolved the way the contract resolves it.
 *
 * Reads `learnings.file` from `.lisa.config.json` and falls back to the
 * documented default. Resolving it here rather than writing the path into a
 * workflow is what stops the two drifting: an override would otherwise move the
 * ledger and leave every caller checking a file that no longer exists.
 * @returns Project-relative path to the ledger, whether or not it exists
 */
async function resolveLedgerRelative(): Promise<string> {
  const configPath = path.join(REPO_ROOT, ".lisa.config.json");
  const resolver = await loadConfiguredLearningsResolver();
  const parsed: unknown = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : {};
  return resolver(parsed, configPath);
}

/** Resolve this repository's configured ledger to an absolute path. */
async function resolveLedger(): Promise<string> {
  return path.resolve(REPO_ROOT, await resolveLedgerRelative());
}

/** Resolve the configured ledger's sibling overflow through the shared rule. */
async function resolveOverflow(): Promise<string> {
  const resolver = await loadOverflowResolver();
  return path.resolve(REPO_ROOT, resolver(await resolveLedgerRelative()));
}

/**
 * Whether this script is running from a source checkout rather than from the
 * published package, decided by the presence of the TypeScript core the
 * published tarball deliberately excludes.
 *
 * The same discriminator the quality workflow uses to choose between running
 * this script and running the shipped CLI subcommand, so the two agree on what
 * "Lisa's own repository" means by construction rather than by convention.
 * @returns True when the in-tree TypeScript core is present
 */
function isSourceCheckout(): boolean {
  return existsSync(
    path.join(REPO_ROOT, "src", "core", "learnings-budget-check.ts")
  );
}

/** Run the package-facing checker with zero or one explicit file path. */
async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) {
    fail(
      "Usage: bun run check:learnings-budget -- [PROJECT_LEARNINGS.md | --overflow]"
    );
  }

  const checker = await loadBudgetChecker();
  const inspected =
    arguments_[0] === "--overflow"
      ? await checkOverflowSurface(checker, await resolveOverflow())
      : arguments_.length === 1
        ? await checkExplicitSurface(checker, arguments_[0] as string)
        : await checkDefaultSurfaces(checker);

  // VACUITY GUARD. Every path above either judges a document or exits, so this
  // should be unreachable — which is the point. A run that inspected nothing
  // and a run that inspected a healthy ledger produce identical output and an
  // identical exit code, and that ambiguity is how this gate spent a release
  // checking only a 0-entry template while looking like a gate on the ledger
  // (#2932). Counting what was actually judged makes "nothing" say so instead
  // of reporting all-clear.
  if (inspected === 0) {
    fail(
      "inspected no learnings surface — an empty inspection is indistinguishable from a healthy ledger, so it fails rather than reporting all-clear"
    );
  }
}

/** Check the optional overflow, whose absence is the expected empty state. */
async function checkOverflowSurface(
  checker: BudgetChecker,
  file: string
): Promise<number> {
  const result = await checker.checkLearningsBudget(file, {
    surface: "overflow",
  });
  if (result.kind === "missing") {
    console.log(
      `no learnings overflow file at ${checker.formatDiagnosticPath(file)} — nothing to check`
    );
    return 1;
  }
  if (result.kind === "violation") {
    fail(`${checker.formatDiagnosticPath(file)}: ${result.detail}`);
  }
  console.log(
    checker.formatBudgetVerdict(file, result, { surface: "overflow" })
  );
  return 1;
}

/**
 * Check the one document named on the command line.
 * @param checker - The loaded budget checker
 * @param argument - Caller-supplied learnings path
 * @returns How many documents were judged
 */
async function checkExplicitSurface(
  checker: BudgetChecker,
  argument: string
): Promise<number> {
  await check(checker, path.resolve(process.cwd(), argument));
  return 1;
}

/**
 * Check the two default surfaces: the shipped template and this repository's
 * own ledger.
 * @param checker - The loaded budget checker
 * @returns How many documents were judged
 */
async function checkDefaultSurfaces(checker: BudgetChecker): Promise<number> {
  await check(checker, TEMPLATE_LEARNINGS_FILE);
  const ledger = await resolveLedger();
  if (existsSync(ledger)) {
    await check(checker, ledger);
    return 2;
  }
  // In a source checkout the ledger is a committed file, so its absence means
  // the resolver drifted off it — and "no learnings file" is a verdict the CI
  // marker grep accepts as green, which turns that drift into a gate on the
  // template alone. Fail instead. From the published package the same absence
  // is the ordinary case (no tarball carries a ledger) and stays a quiet pass,
  // exactly as it does for host projects on the CLI subcommand.
  if (isSourceCheckout()) {
    fail(
      `${checker.formatDiagnosticPath(ledger)}: resolved ledger does not exist, and this is a source checkout where the ledger is committed — the configured \`learnings.file\` no longer resolves to a document, so this run would have gated the shipped template alone`
    );
  }
  console.log(`${checker.formatDiagnosticPath(ledger)}: no learnings file`);
  return 1;
}

/**
 * Check one file and report, failing the process on any violation.
 *
 * Every document this script reaches must exist — an explicit argument names
 * one, and both defaults are committed here — so a missing file is as much a
 * failure as any other violation. Host projects use the
 * `lisa check-learnings-budget` CLI subcommand instead, which treats a missing
 * file as an expected pass.
 * @param checker - The loaded budget checker
 * @param file - Absolute path to the document to check
 */
async function check(checker: BudgetChecker, file: string): Promise<void> {
  const result = await checker.checkLearningsBudget(file);
  if (result.kind === "ok") {
    // Prints `learnings budget saturated` for a full-but-valid ledger and exits
    // 0 all the same; the reasoning lives on describeLearningsSaturation.
    console.log(checker.formatBudgetVerdict(file, result));
    return;
  }
  fail(`${checker.formatDiagnosticPath(file)}: ${result.detail}`);
}

/**
 * Load the reusable budget checker from current source in a checkout or
 * compiled output in an npm package. The `.js` source specifier keeps Bun
 * development runs aligned with TypeScript's NodeNext resolution while
 * publishing no runtime dependency on the excluded `src` tree.
 * @returns Canonical budget-checker functions
 */
async function loadBudgetChecker(): Promise<BudgetChecker> {
  const packageRoot = path.resolve(import.meta.dir, "..");
  const sourceTypescript = path.join(
    packageRoot,
    "src",
    "core",
    "learnings-budget-check.ts"
  );
  const runtimeRoot = path.join(
    packageRoot,
    existsSync(sourceTypescript) ? "src" : "dist",
    "core"
  );
  const module_ = await import(
    pathToFileURL(path.join(runtimeRoot, "learnings-budget-check.js")).href
  );
  return {
    checkLearningsBudget: module_.checkLearningsBudget,
    formatBudgetVerdict: module_.formatBudgetVerdict,
    formatDiagnosticPath: module_.formatDiagnosticPath,
  } as BudgetChecker;
}

/** Load the pure overflow filename resolver from source or compiled package. */
async function loadOverflowResolver(): Promise<
  typeof OverflowPathModule.resolveLearningsOverflowFile
> {
  const packageRoot = path.resolve(import.meta.dir, "..");
  const sourceTypescript = path.join(
    packageRoot,
    "src",
    "core",
    "learnings-overflow-path.ts"
  );
  const runtimeRoot = path.join(
    packageRoot,
    existsSync(sourceTypescript) ? "src" : "dist",
    "core"
  );
  const module_ = (await import(
    pathToFileURL(path.join(runtimeRoot, "learnings-overflow-path.js")).href
  )) as typeof OverflowPathModule;
  return module_.resolveLearningsOverflowFile;
}

/** Load the dependency-free configured learnings-path resolver. */
async function loadConfiguredLearningsResolver(): Promise<
  typeof ConfiguredPathModule.resolveLearningsFileFromRawConfig
> {
  const packageRoot = path.resolve(import.meta.dir, "..");
  const sourceTypescript = path.join(
    packageRoot,
    "src",
    "core",
    "configured-learnings-path.ts"
  );
  const runtimeRoot = path.join(
    packageRoot,
    existsSync(sourceTypescript) ? "src" : "dist",
    "core"
  );
  const module_ = (await import(
    pathToFileURL(path.join(runtimeRoot, "configured-learnings-path.js")).href
  )) as typeof ConfiguredPathModule;
  return module_.resolveLearningsFileFromRawConfig;
}

/** Print one deterministic failure diagnostic and exit non-zero. */
function fail(message: string): never {
  console.error(`check:learnings-budget: ${message}`);
  process.exit(1);
}

await main();
