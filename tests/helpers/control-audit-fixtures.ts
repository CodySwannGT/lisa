/**
 * Fixture repositories for the control audit.
 *
 * Every fit criterion of the audit, configure, enforce and attest work names
 * one of four throwaway repositories. They are defined once here so each later
 * suite proves its claim against the same host instead of one it invented:
 *
 * - **F-none** — no supported project type and no `package.json`: a small
 *   Python package with a linter configuration file and no hook.
 * - **F-mixed** — two parts in separate folders: `api/`, a Python package, and
 *   `web/`, a TypeScript package with `package.json` and `tsconfig.json`.
 * - **F-paved** — one supported project type, `typescript`.
 * - **F-empty** — source files only: no linter, test or hook configuration.
 *
 * Each is a real git repository on disk rather than a mocked filesystem,
 * because what the audit claims is that it reads what is actually there.
 *
 * The repositories are deterministic. The author, the committer, the date, the
 * branch name and the commit message are fixed, and git runs without the
 * machine's global or system configuration, so the seed commit of a fixture is
 * the same commit on every machine. Nothing here touches the network, and no
 * fixture has a remote.
 * @module tests/helpers/control-audit-fixtures
 */
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import path from "node:path";

import { GIT_BIN, cleanGitEnv } from "../support/git-executable.js";
import { boundedExecFileSync } from "./io-latency-budget.js";

/** The four fixtures, in the order the requirements introduce them. */
export const CONTROL_AUDIT_FIXTURE_NAMES = [
  "F-none",
  "F-mixed",
  "F-paved",
  "F-empty",
] as const;

/** The name of one fixture. */
export type ControlAuditFixtureName =
  (typeof CONTROL_AUDIT_FIXTURE_NAMES)[number];

/** The git facts every fixture is built with. */
export const CONTROL_AUDIT_FIXTURE_GIT = {
  /** Author and committer name of every commit made through this module. */
  authorName: "Lisa Fixture",
  /** Author and committer address of every commit made through this module. */
  authorEmail: "fixture@example.test",
  /** Author and committer date of every commit made through this module. */
  date: "2026-01-01T00:00:00+00:00",
  /** The only branch of a freshly built fixture. */
  defaultBranch: "main",
  /** Subject of the single commit a freshly built fixture holds. */
  commitMessage: "chore: seed control audit fixture",
} as const;

/** Files of a repository: repository-relative POSIX path to exact content. */
export type ControlAuditFixtureFiles = Readonly<Record<string, string>>;

/** How a fixture may differ from its definition. */
export interface ControlAuditFixtureOptions {
  /**
   * Files committed together with the fixture's own, in its single commit.
   *
   * For the variants the requirements call for — a fixture with a wiki, with a
   * gate declaration, with existing lint violations — without a second
   * definition of the fixture. A path the definition already holds is
   * replaced. Paths are repository-relative, use `/`, and must stay inside
   * the repository and outside `.git`.
   */
  readonly extraFiles?: ControlAuditFixtureFiles;
}

/** One built fixture repository. */
export interface ControlAuditFixture {
  /** Which fixture this is. */
  readonly name: ControlAuditFixtureName;
  /** Absolute, symlink-free path of the repository root. */
  readonly repoPath: string;
  /** Remove the repository. Safe to call more than once. */
  readonly cleanup: () => void;
}

/**
 * Join rows into a text file that ends with a newline.
 * @param rows - Lines of the file, without line endings
 * @returns The file content
 */
function text(rows: readonly string[]): string {
  return `${rows.join("\n")}\n`;
}

/**
 * Render a JSON file the way a formatter would leave it.
 * @param value - The document
 * @returns The file content
 */
function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Prefix every path of a file set with a folder.
 * @param folder - Repository-relative folder
 * @param files - Files to place inside it
 * @returns The same files, under the folder
 */
function within(
  folder: string,
  files: ControlAuditFixtureFiles
): ControlAuditFixtureFiles {
  return Object.fromEntries(
    Object.entries(files).map(([relative, content]) => [
      `${folder}/${relative}`,
      content,
    ])
  );
}

/**
 * A small Python package with a linter configuration file.
 *
 * `ruff.toml` is the linter configuration, deliberately a file of its own:
 * `pyproject.toml` carries package metadata only, so "a linter is configured"
 * is one file an audit can cite rather than a table inside another.
 * @param distribution - Distribution name, as `pyproject.toml` spells it
 * @param module - Importable module name
 * @returns The package's files
 */
function pythonPackage(
  distribution: string,
  module: string
): ControlAuditFixtureFiles {
  return {
    "pyproject.toml": text([
      "[project]",
      `name = "${distribution}"`,
      'version = "0.1.0"',
      'description = "A small Python package used as a fixture."',
      'requires-python = ">=3.11"',
    ]),
    "ruff.toml": text([
      "line-length = 88",
      'target-version = "py311"',
      "",
      "[lint]",
      'select = ["E", "F"]',
    ]),
    [`src/${module}/__init__.py`]: text([
      '"""A small package used as a fixture."""',
      "",
      "from .greeting import greet",
      "",
      '__all__ = ["greet"]',
    ]),
    [`src/${module}/greeting.py`]: text([
      '"""Greeting helpers."""',
      "",
      "",
      "def greet(name: str) -> str:",
      '    """Return a greeting for a name."""',
      '    return f"Hello, {name}!"',
    ]),
  };
}

/**
 * A minimal TypeScript package that is detected as `typescript` and nothing
 * else.
 *
 * `private: true` keeps the `npm-package` detector off it, and it carries no
 * scripts, linter, test or hook configuration: the fixture is a host on a
 * supported project type, not a host Lisa has already been applied to.
 * @param name - Package name
 * @returns The package's files
 */
function typescriptPackage(name: string): ControlAuditFixtureFiles {
  return {
    "package.json": json({
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      devDependencies: { typescript: "^5.9.3" },
    }),
    "tsconfig.json": json({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
      },
      include: ["src"],
    }),
    "src/index.ts": text([
      "/**",
      " * Return a greeting for a name.",
      " * @param name - Who to greet",
      " * @returns The greeting",
      " */",
      "export const greet = (name: string): string => `Hello, ${name}!`;",
    ]),
  };
}

/**
 * The exact files each fixture is committed with.
 *
 * Exported so a suite can name a fixture's files — the linter configuration of
 * F-none, the two parts of F-mixed — from the definition instead of from a
 * second copy of it.
 */
export const CONTROL_AUDIT_FIXTURE_FILES: Readonly<
  Record<ControlAuditFixtureName, ControlAuditFixtureFiles>
> = {
  "F-none": pythonPackage("fixture-none", "fixture_none"),
  "F-mixed": {
    ...within("api", pythonPackage("api", "api")),
    ...within("web", typescriptPackage("web")),
  },
  "F-paved": typescriptPackage("fixture-paved"),
  "F-empty": {
    "src/greeting.py": text([
      "def greet(name):",
      '    return f"Hello, {name}!"',
    ]),
    "src/main.py": text([
      "from greeting import greet",
      "",
      'print(greet("world"))',
    ]),
  },
};

/**
 * The environment git runs in for a fixture.
 *
 * Three things are kept out. The `GIT_*` variables a hook exports, which
 * would point a command in a temporary directory back at the repository the
 * suite is running inside. The machine's global and system configuration,
 * which can rename the default branch, sign commits, ignore files or run
 * hooks of its own. And the clock and the identity, which are fixed instead.
 *
 * Exported for a suite that starts its own child against a fixture — a hook,
 * the gate runner, the command under test — and needs that child's commits to
 * be as deterministic as the fixture's.
 * @returns A complete environment for a child process
 */
export function controlAuditGitEnv(): NodeJS.ProcessEnv {
  const { authorEmail, authorName, date } = CONTROL_AUDIT_FIXTURE_GIT;
  return {
    ...cleanGitEnv(),
    GIT_AUTHOR_DATE: date,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_AUTHOR_NAME: authorName,
    GIT_COMMITTER_DATE: date,
    GIT_COMMITTER_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    TZ: "UTC",
  };
}

/**
 * Run git in a fixture repository, in the fixture environment.
 * @param repoPath - Repository root, or a folder inside it
 * @param args - Arguments to git, excluding the executable
 * @returns What git wrote to stdout, without trailing whitespace
 * @throws {ChildFailure} When git exits non-zero, carrying its exit code and
 *   streams
 */
export function runControlAuditGit(
  repoPath: string,
  args: readonly string[]
): string {
  return boundedExecFileSync({
    label: "control audit fixture git",
    command: GIT_BIN,
    args,
    cwd: repoPath,
    env: controlAuditGitEnv(),
  }).trimEnd();
}

/**
 * Resolve a fixture file's path, refusing one that leaves the committed tree.
 *
 * A fixture that wrote outside its own temporary directory would damage
 * whatever was there, and one that wrote into `.git` would have installed
 * something the seed commit does not record.
 * @param repoPath - Repository root
 * @param relative - Repository-relative path of the file
 * @returns The absolute path to write
 */
function fixtureFilePath(repoPath: string, relative: string): string {
  const absolute = path.resolve(repoPath, relative);
  const inside = path.relative(repoPath, absolute);
  const [first] = inside.split(path.sep);
  if (
    path.isAbsolute(relative) ||
    inside === "" ||
    first === ".." ||
    // Compared without case: on a case-insensitive filesystem `.GIT` is the
    // same directory.
    first?.toLowerCase() === ".git"
  ) {
    throw new Error(
      `Fixture file '${relative}' is outside the fixture repository's committed tree`
    );
  }
  return absolute;
}

/**
 * Record the fixture identity in the repository's own configuration.
 *
 * So a plain `git commit` inside the fixture — one made by the code under
 * test, with whatever environment it was given — has an author on a machine
 * that configures none, and is never signed on a machine that signs.
 *
 * Appended to the file rather than set key by key: three `git config` children
 * per build, across every suite that builds a fixture, buy nothing the file
 * format does not already promise.
 * @param repoPath - Repository root
 */
function writeLocalIdentity(repoPath: string): void {
  const { authorEmail, authorName } = CONTROL_AUDIT_FIXTURE_GIT;
  appendFileSync(
    path.join(repoPath, ".git", "config"),
    text([
      "[user]",
      `\tname = ${authorName}`,
      `\temail = ${authorEmail}`,
      "[commit]",
      "\tgpgsign = false",
    ])
  );
}

/**
 * Build one fixture as a fresh git repository in a new temporary directory.
 *
 * The repository holds a single commit on `main`, a clean working tree, no
 * remote and no hook. Call `cleanup` when the case is done; the directory is
 * not removed otherwise.
 * @param name - Which fixture to build
 * @param options - How it may differ from its definition
 * @returns The repository path and its cleanup function
 */
export function buildControlAuditFixture(
  name: ControlAuditFixtureName,
  options: ControlAuditFixtureOptions = {}
): ControlAuditFixture {
  const repoPath = realpathSync(
    mkdtempSync(
      path.join(tmpdir(), `lisa-control-audit-${name.toLowerCase()}-`)
    )
  );
  const cleanup = (): void =>
    rmSync(repoPath, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 100,
    });
  try {
    const files = {
      ...CONTROL_AUDIT_FIXTURE_FILES[name],
      ...options.extraFiles,
    };
    for (const [relative, content] of Object.entries(files)) {
      const absolute = fixtureFilePath(repoPath, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    runControlAuditGit(repoPath, [
      "init",
      "--quiet",
      `--initial-branch=${CONTROL_AUDIT_FIXTURE_GIT.defaultBranch}`,
    ]);
    writeLocalIdentity(repoPath);
    runControlAuditGit(repoPath, ["add", "--all"]);
    runControlAuditGit(repoPath, [
      "commit",
      "--quiet",
      "--message",
      CONTROL_AUDIT_FIXTURE_GIT.commitMessage,
    ]);
  } catch (error) {
    cleanup();
    throw error;
  }
  return { name, repoPath, cleanup };
}

/**
 * Build F-none: no supported project type and no `package.json`.
 * @param options - How it may differ from its definition
 * @returns The repository path and its cleanup function
 */
export function buildFNone(
  options?: ControlAuditFixtureOptions
): ControlAuditFixture {
  return buildControlAuditFixture("F-none", options);
}

/**
 * Build F-mixed: a Python package in `api/` and a TypeScript package in `web/`.
 * @param options - How it may differ from its definition
 * @returns The repository path and its cleanup function
 */
export function buildFMixed(
  options?: ControlAuditFixtureOptions
): ControlAuditFixture {
  return buildControlAuditFixture("F-mixed", options);
}

/**
 * Build F-paved: one supported project type, `typescript`.
 * @param options - How it may differ from its definition
 * @returns The repository path and its cleanup function
 */
export function buildFPaved(
  options?: ControlAuditFixtureOptions
): ControlAuditFixture {
  return buildControlAuditFixture("F-paved", options);
}

/**
 * Build F-empty: source files only, with no controls of any kind.
 * @param options - How it may differ from its definition
 * @returns The repository path and its cleanup function
 */
export function buildFEmpty(
  options?: ControlAuditFixtureOptions
): ControlAuditFixture {
  return buildControlAuditFixture("F-empty", options);
}
