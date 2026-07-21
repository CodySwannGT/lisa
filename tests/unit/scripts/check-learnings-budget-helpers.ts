import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

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
      timeout: 10_000,
    }
  );
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
      timeout: 10_000,
    }
  );
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
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 }
  );
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
    throw new Error(`Expected Bun's package runner, received: ${executable}`);
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
