/** Genuine configured tools in an owned Git fixture; no tool or task stubs. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const ROOT = path.resolve(__dirname, "../..");
const FIXTURE_IDENTITY = {
  name: "Lisa Owned Fixture",
  email: "lisa-fixture@example.invalid",
} as const;

/** The two actual pre-commit configuration surfaces. */
export type StagedConfiguration = "root" | "emitted";

/** Owned fixture and its real child-process boundary. */
export interface StagedModuleFixture {
  readonly directory: string;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Copy the genuine static configuration closure without source modification.
 * @param directory - Owned fixture root
 * @param configuration - Root or delivered TypeScript configuration
 */
function copyConfiguration(
  directory: string,
  configuration: StagedConfiguration
): void {
  const templates =
    configuration === "root" ? "" : "typescript/copy-overwrite/";
  const local = configuration === "root" ? "" : "typescript/create-only/";
  const inputs: readonly (readonly [string, string])[] = [
    [`${templates}.lintstagedrc.json`, ".lintstagedrc.json"],
    [`${templates}eslint.config.ts`, "eslint.config.ts"],
    [`${templates}eslint.ignore.config.json`, "eslint.ignore.config.json"],
    [`${local}eslint.config.local.ts`, "eslint.config.local.ts"],
    [`${local}eslint.thresholds.json`, "eslint.thresholds.json"],
    ...[
      ".prettierrc.json",
      ".prettierignore",
      "tsconfig.json",
      "tsconfig.eslint.json",
      "tsconfig.local.json",
      "tsconfig",
      ".oxlintrc.json",
      "oxlint",
      "sgconfig.yml",
      "ast-grep",
    ].map(file => [file, file] as const),
  ];
  for (const [from, to] of inputs) {
    fs.cpSync(path.join(ROOT, from), path.join(directory, to), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
}

/**
 * Link one real package namespace, leaving Lisa for the candidate link below.
 * @param source - Installed namespace directory
 * @param destination - Owned namespace directory
 * @param scope - Package scope
 */
function linkNamespace(
  source: string,
  destination: string,
  scope: string
): void {
  fs.mkdirSync(destination);
  for (const name of fs.readdirSync(source)) {
    if (scope === "@codyswann" && name === "lisa") continue;
    fs.symlinkSync(
      fs.realpathSync(path.join(source, name)),
      path.join(destination, name),
      "junction"
    );
  }
}

/**
 * Link real installed packages; resolve Lisa to this actual candidate build.
 * @param directory - Owned fixture root
 */
function linkDependencies(directory: string): void {
  const modules = path.join(directory, "node_modules");
  fs.mkdirSync(modules);
  for (const entry of fs.readdirSync(path.join(ROOT, "node_modules"))) {
    if (entry.startsWith(".") && entry !== ".bin") continue;
    const source = path.join(ROOT, "node_modules", entry);
    const destination = path.join(modules, entry);
    if (entry.startsWith("@")) {
      linkNamespace(source, destination, entry);
    } else {
      fs.symlinkSync(fs.realpathSync(source), destination, "junction");
    }
  }
  fs.mkdirSync(path.join(modules, "@codyswann"), { recursive: true });
  fs.symlinkSync(ROOT, path.join(modules, "@codyswann/lisa"), "junction");
}

/**
 * Execute a real bounded child with captured output and no hook/task overrides.
 * @param fixture - Owned fixture
 * @param command - Actual executable
 * @param args - Literal arguments
 * @returns Genuine child result
 */
export function runStagedTool(
  fixture: StagedModuleFixture,
  command: string,
  args: readonly string[]
): ReturnType<typeof boundedSpawnSync> {
  return boundedSpawnSync({
    label: `staged module ${path.basename(command)}`,
    command,
    args,
    cwd: fixture.directory,
    env: fixture.env,
    maxBuffer: 4 * 1024 * 1024,
  });
}

/**
 * Run a normal Git operation and surface any actual failure.
 * @param fixture - Owned fixture
 * @param args - Literal Git arguments
 * @returns Untrimmed actual stdout, preserving staged file bytes
 */
export function stagedGit(
  fixture: StagedModuleFixture,
  args: readonly string[]
): string {
  const result = runStagedTool(fixture, "git", args);
  if (result.status !== 0) {
    throw new Error(`Fixture Git failed: ${result.stdout}${result.stderr}`);
  }
  return result.stdout ?? "";
}

/**
 * Prepare real configs/tools and a clean synthetic-identity Git seed.
 * @param configuration - Actual root or delivered TypeScript configuration
 * @returns Owned fixture; the caller removes it in finally
 */
export function createStagedModuleFixture(
  configuration: StagedConfiguration
): StagedModuleFixture {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "lisa-staged-module-")
  );
  const childTemporaryDirectory = path.join(
    directory,
    "node_modules/.cache/tmp"
  );
  const fixture = {
    directory,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: FIXTURE_IDENTITY.name,
      GIT_AUTHOR_EMAIL: FIXTURE_IDENTITY.email,
      GIT_COMMITTER_NAME: FIXTURE_IDENTITY.name,
      GIT_COMMITTER_EMAIL: FIXTURE_IDENTITY.email,
      // Jiti's environment switch is boolean; its default cache follows TMPDIR.
      // Contain child caches without disabling them or changing the parent.
      TMPDIR: childTemporaryDirectory,
      TMP: childTemporaryDirectory,
      TEMP: childTemporaryDirectory,
      PATH: [
        path.join(directory, "node_modules/.bin"),
        path.dirname(process.execPath),
        process.env.PATH ?? "",
      ].join(path.delimiter),
    },
  };
  try {
    copyConfiguration(directory, configuration);
    linkDependencies(directory);
    fs.mkdirSync(childTemporaryDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      '{"name":"owned-staged-fixture","private":true,"type":"module"}\n'
    );
    fs.writeFileSync(
      path.join(directory, ".gitignore"),
      "node_modules/\n.eslintcache\n"
    );
    stagedGit(fixture, [
      "-c",
      `user.name=${FIXTURE_IDENTITY.name}`,
      "-c",
      `user.email=${FIXTURE_IDENTITY.email}`,
      "init",
      "--initial-branch=main",
    ]);
    stagedGit(fixture, [
      "config",
      "--local",
      "user.name",
      FIXTURE_IDENTITY.name,
    ]);
    stagedGit(fixture, [
      "config",
      "--local",
      "user.email",
      FIXTURE_IDENTITY.email,
    ]);
    stagedGit(fixture, ["add", "."]);
    stagedGit(fixture, [
      "commit",
      "-m",
      "Initialize owned staged-file fixture",
    ]);
    return fixture;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
