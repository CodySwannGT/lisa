import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import {
  assertChildCompleted,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// Quiet-box budgets, scaled per worker by the measured spawn slowdown.
//
// They used to be the literals 10_000 and 30_000, and that is the defect
// CodySwannGT/lisa#2822 is named for, at child-process scale. Two 12-way
// concurrency arms, node spawn latency 70.5ms and 109.1ms against a quiet 18ms:
// 12 of 12 processes failed in each, every one of them inside this one suite,
// and not one said the word timeout. `spawnSync` kills the child and returns
// empty streams, so the arms reported "expected '' to contain 'learnings budget
// passed'" and "expected '' to be truthy" — messages about content, for
// failures entirely about time. Every child here is now paired with
// assertChildCompleted so a kill can never masquerade as a content defect.
const CHECKER_BUDGET_MS = 10_000;
const COMPILER_BUDGET_MS = 30_000;

/** Observable process result used by the CLI assertions. */
export interface CommandResult {
  readonly output: string;
  readonly status: number | null;
}

/**
 * Run the real package command and combine both diagnostic streams.
 * @param bunExecutable - Validated absolute Bun executable path
 * @param filePaths - Optional explicit learnings-file arguments
 * @returns Exit status and combined command output
 */
export function runCheckWithBun(
  bunExecutable: string,
  ...filePaths: readonly string[]
): CommandResult {
  const result = spawnSync(
    bunExecutable,
    [
      "run",
      "check:learnings-budget",
      ...(filePaths.length === 0 ? [] : ["--", ...filePaths]),
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: ioLatencyBudgetMs(CHECKER_BUDGET_MS),
    }
  );
  assertChildCompleted(result, "bun run check:learnings-budget");
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

/**
 * Run the checker without the package runner's command-echo diagnostics.
 * @param bunExecutable - Validated absolute Bun executable path
 * @param filePaths - Optional explicit learnings-file arguments
 * @returns Exit status and checker-owned output only
 */
export function runCheckerDirectWithBun(
  bunExecutable: string,
  ...filePaths: readonly string[]
): CommandResult {
  const result = spawnSync(
    bunExecutable,
    [
      path.join(REPO_ROOT, "scripts", "check-learnings-budget.ts"),
      ...filePaths,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: ioLatencyBudgetMs(CHECKER_BUDGET_MS),
    }
  );
  assertChildCompleted(result, "check-learnings-budget.ts");
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

/**
 * Stage the real publish inputs and compile source into an isolated dist tree.
 * @param stagingRoot - Unique temporary package root
 * @param bunExecutable - Validated absolute Bun executable path
 * @returns Compiler exit status and combined output
 */
export function stagePackageWithFreshDist(
  stagingRoot: string,
  bunExecutable: string
): CommandResult {
  const publishInputs = [
    "package.json",
    "scripts/check-learnings-budget.ts",
    "all/create-only/.lisa/PROJECT_LEARNINGS.md",
  ] as const;
  for (const relativePath of publishInputs) {
    const target = path.join(stagingRoot, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(REPO_ROOT, relativePath), target);
  }
  const compiler = realpathSync(
    path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc")
  );
  const compilerConfig = path.join(
    stagingRoot,
    "tsconfig.check-learnings-budget.json"
  );
  writeFileSync(
    compilerConfig,
    `${JSON.stringify(
      {
        extends: path.join(REPO_ROOT, "tsconfig.json"),
        compilerOptions: {
          declaration: false,
          declarationMap: false,
          outDir: path.join(stagingRoot, "dist"),
          rootDir: path.join(REPO_ROOT, "src"),
          sourceMap: false,
          typeRoots: [path.join(REPO_ROOT, "node_modules", "@types")],
          types: ["node"],
        },
        files: [
          path.join(REPO_ROOT, "src", "core", "learnings-budget-check.ts"),
          path.join(REPO_ROOT, "src", "core", "configured-learnings-path.ts"),
          path.join(REPO_ROOT, "src", "core", "learnings-overflow-path.ts"),
          path.join(REPO_ROOT, "src", "core", "learnings-location.ts"),
          path.join(REPO_ROOT, "src", "core", "safe-relative-markdown-path.ts"),
        ],
        include: [],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return runCompiler(bunExecutable, compiler, compilerConfig);
}

/**
 * Compile the staged checker's static dependency closure.
 * @param bunExecutable - Validated absolute Bun executable path
 * @param compiler - Real repository TypeScript compiler path
 * @param compilerConfig - Temporary closure-only TypeScript configuration
 * @returns Compiler exit status and combined output
 */
function runCompiler(
  bunExecutable: string,
  compiler: string,
  compilerConfig: string
): CommandResult {
  const result = spawnSync(
    bunExecutable,
    [compiler, "--project", compilerConfig],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: ioLatencyBudgetMs(COMPILER_BUDGET_MS),
    }
  );
  assertChildCompleted(result, "tsc --project (staged closure)");
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

/**
 * Validate Bun's package-runner or native-runner executable before child use.
 * @param executable - Absolute executable reported by the active test runner
 * @returns Validated absolute Bun executable path
 */
export function resolveBunExecutable(executable: string | undefined): string {
  if (executable === undefined || !path.isAbsolute(executable)) {
    throw new Error(
      `Expected an absolute Bun executable, received: ${executable}`
    );
  }
  const packageRunner = path.basename(executable);
  if (!/^bunx?(?:\.exe)?$/u.test(packageRunner)) {
    // Name the remedy, not just the symptom. This suite shells out to Bun and
    // resolves it from the runner that launched vitest, so `npx vitest` fails
    // here with nothing wrong in the repository. Without the second sentence
    // that reads as a broken suite — it misled me into reporting it as a
    // pre-existing failure on main, in two pull request descriptions, when
    // `bun run test:unit` passes all 14.
    throw new Error(
      `Expected Bun's package runner, received: ${executable}. ` +
        `Run this suite with Bun — 'bun run test:unit' — rather than npx.`
    );
  }
  const bunName = packageRunner.replace(/^bunx/u, "bun");
  const bunExecutable = realpathSync(
    path.join(path.dirname(executable), bunName)
  );
  if (!/^bun(?:\.exe)?$/u.test(path.basename(bunExecutable))) {
    throw new Error(`Resolved an invalid Bun executable: ${bunExecutable}`);
  }
  return bunExecutable;
}
