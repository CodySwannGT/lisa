/** CI gate for the canonical project learnings document and its hard budgets. */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type * as BudgetCheckModule from "../src/core/learnings-budget-check.js";

type BudgetChecker = Pick<
  typeof BudgetCheckModule,
  "checkLearningsBudget" | "formatDiagnosticPath"
>;

const DEFAULT_LEARNINGS_FILE = path.resolve(
  import.meta.dir,
  "..",
  "all",
  "create-only",
  ".lisa",
  "PROJECT_LEARNINGS.md"
);

/** Run the package-facing checker with zero or one explicit file path. */
async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) {
    fail("Usage: bun run check:learnings-budget -- [PROJECT_LEARNINGS.md]");
  }

  const file =
    arguments_.length === 0
      ? DEFAULT_LEARNINGS_FILE
      : path.resolve(process.cwd(), arguments_[0] as string);

  const { checkLearningsBudget, formatDiagnosticPath } =
    await loadBudgetChecker();
  const result = await checkLearningsBudget(file);
  if (result.kind === "ok") {
    console.log(
      `${formatDiagnosticPath(file)}: learnings budget passed (${result.entryCount}/${result.maxEntries} entries, ${result.measuredTokens}/${result.maxTokens} maxTokens)`
    );
    return;
  }
  // This package script targets Lisa's own committed learnings template, which
  // always exists — so a missing file is as much a failure here as any other
  // violation. Host projects use the `lisa check-learnings-budget` CLI
  // subcommand instead, which treats a missing file as an expected pass.
  fail(`${formatDiagnosticPath(file)}: ${result.detail}`);
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
