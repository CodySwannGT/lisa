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
 * repository's agents actually read. A missing template is a failure — it is
 * committed here and always exists. A missing ledger is a pass, because a
 * project that has never recorded a learning has no file.
 * @module scripts/check-learnings-budget
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type * as BudgetCheckModule from "../src/core/learnings-budget-check.js";

type BudgetChecker = Pick<
  typeof BudgetCheckModule,
  "checkLearningsBudget" | "formatDiagnosticPath"
>;

const REPO_ROOT = path.resolve(import.meta.dir, "..");

const TEMPLATE_LEARNINGS_FILE = path.resolve(
  REPO_ROOT,
  "all",
  "create-only",
  ".lisa",
  "PROJECT_LEARNINGS.md"
);

/** Where the contract puts a project's ledger when nothing overrides it. */
const DEFAULT_LEDGER_RELATIVE = path.join(".lisa", "PROJECT_LEARNINGS.md");

/**
 * This repository's own ledger, resolved the way the contract resolves it.
 *
 * Reads `learnings.file` from `.lisa.config.json` and falls back to the
 * documented default. Resolving it here rather than writing the path into a
 * workflow is what stops the two drifting: an override would otherwise move the
 * ledger and leave every caller checking a file that no longer exists.
 * @returns Absolute path to the ledger, whether or not it exists
 */
function resolveLedger(): string {
  const configPath = path.join(REPO_ROOT, ".lisa.config.json");
  const override = existsSync(configPath)
    ? (
        JSON.parse(readFileSync(configPath, "utf8")) as {
          learnings?: { file?: unknown };
        }
      ).learnings?.file
    : undefined;
  const relative =
    typeof override === "string" && override.trim() !== ""
      ? override
      : DEFAULT_LEDGER_RELATIVE;
  return path.resolve(REPO_ROOT, relative);
}

/** Run the package-facing checker with zero or one explicit file path. */
async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) {
    fail("Usage: bun run check:learnings-budget -- [PROJECT_LEARNINGS.md]");
  }

  const checker = await loadBudgetChecker();
  if (arguments_.length === 1) {
    await check(checker, path.resolve(process.cwd(), arguments_[0] as string), {
      absenceIsFailure: true,
    });
    return;
  }

  await check(checker, TEMPLATE_LEARNINGS_FILE, { absenceIsFailure: true });
  const ledger = resolveLedger();
  if (!existsSync(ledger)) {
    console.log(`${checker.formatDiagnosticPath(ledger)}: no learnings file`);
    return;
  }
  await check(checker, ledger, { absenceIsFailure: true });
}

/**
 * Check one file and report, failing the process on any violation.
 * @param checker - The loaded budget checker
 * @param file - Absolute path to the document to check
 * @param options - Whether a missing file is a violation
 * @param options.absenceIsFailure - True when the file must exist
 */
async function check(
  checker: BudgetChecker,
  file: string,
  options: { absenceIsFailure: boolean }
): Promise<void> {
  const result = await checker.checkLearningsBudget(file);
  if (result.kind === "ok") {
    console.log(
      `${checker.formatDiagnosticPath(file)}: learnings budget passed (${result.entryCount}/${result.maxEntries} entries, ${result.measuredTokens}/${result.maxTokens} maxTokens)`
    );
    return;
  }
  // Both files this script checks are committed here, so a missing one is as
  // much a failure as any other violation. Host projects use the
  // `lisa check-learnings-budget` CLI subcommand instead, which treats a
  // missing file as an expected pass.
  if (options.absenceIsFailure) {
    fail(`${checker.formatDiagnosticPath(file)}: ${result.detail}`);
  }
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
    formatDiagnosticPath: module_.formatDiagnosticPath,
  } as BudgetChecker;
}

/** Print one deterministic failure diagnostic and exit non-zero. */
function fail(message: string): never {
  console.error(`check:learnings-budget: ${message}`);
  process.exit(1);
}

await main();
