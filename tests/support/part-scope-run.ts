/**
 * Starting the shipped gate runner in F-mixed, the two-folder repository
 * (CodySwannGT/lisa#4988).
 *
 * Every suite that asks "which parts did the runner start for this change"
 * needs the same repository, the same way of starting the runner, and the
 * same proof that a part's command did or did not run: a file the command
 * leaves behind in its own folder.
 * @module tests/support/part-scope-run
 */
import { type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sweepAlreadyRanEnv } from "../helpers/cleanup-sweep-skip.js";
import {
  buildFMixed,
  type ControlAuditFixture,
  type ControlAuditFixtureFiles,
  controlAuditGitEnv,
} from "../helpers/control-audit-fixtures.js";
import { configFile, type GatesBlock } from "../helpers/control-register.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { GIT_BIN } from "./git-executable.js";
import { NODE, RUNNER_SCRIPT } from "./no-manifest-run.js";

/** The file a part's command leaves in its folder to say it ran. */
export const RAN = "ran.txt";

/** A command that records that it ran, in the folder it was started in. */
const RECORD: readonly string[] = [
  NODE,
  "-e",
  `require('node:fs').writeFileSync('${RAN}', 'ran')`,
];

/**
 * One gate, required at one moment, with a recording part per folder.
 * @param gate - The gate id
 * @param moment - The moment it is required at
 * @param scopes - The folders it has a part for
 * @returns The `gates` block declaring it
 */
export function partsAt(
  gate: string,
  moment: string,
  scopes: readonly string[]
): GatesBlock {
  return {
    [gate]: {
      [moment]: "required",
      parts: scopes.map(scope => ({ scope, command: RECORD })),
    },
  };
}

/** F-mixed with a declaration, and a folder outside it for what a run writes. */
export interface ScopedRepository {
  /** The repository. */
  readonly fixture: ControlAuditFixture;
  /** A folder outside the repository, removed with it. */
  readonly scratch: string;
  /** Where a run is asked to write its evidence. */
  readonly evidence: string;
  /** Where a run is asked to write the gates it proved. */
  readonly coverage: string;
  /** Remove both. */
  readonly cleanup: () => void;
}

/** One evidence row, as the runner records it. */
export interface EvidenceRow {
  readonly gate: string;
  readonly status: string;
  readonly scope?: string;
  readonly applicable?: boolean;
}

/**
 * Build F-mixed with the given gates declared in it.
 * @param gates - The `gates` block of `.lisa.config.json`
 * @param extraFiles - More files for the seed commit
 * @returns The repository and a folder outside it
 */
export function declaredFMixed(
  gates: GatesBlock,
  extraFiles: ControlAuditFixtureFiles = {}
): ScopedRepository {
  const fixture = buildFMixed({
    extraFiles: { ".lisa.config.json": configFile(gates), ...extraFiles },
  });
  const scratch = mkdtempSync(path.join(tmpdir(), "lisa-part-scope-"));
  return {
    cleanup: () => {
      fixture.cleanup();
      rmSync(scratch, { force: true, recursive: true });
    },
    coverage: path.join(scratch, "coverage"),
    evidence: path.join(scratch, "evidence.json"),
    fixture,
    scratch,
  };
}

/**
 * The environment a run in the fixture gets: none of the variables a hook
 * exports, and no sweep of the machine's temporary folder at push.
 * @returns The environment
 */
function fixtureEnv(): NodeJS.ProcessEnv {
  return sweepAlreadyRanEnv(controlAuditGitEnv()) as NodeJS.ProcessEnv;
}

/**
 * Start the shipped gate runner from the root of the repository.
 * @param repository - The repository to run in
 * @param args - Arguments after the script
 * @param input - Text for the runner's standard input, when a case needs it
 * @returns The finished child
 */
export function runRunner(
  repository: ScopedRepository,
  args: readonly string[],
  input?: string
): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    args: [RUNNER_SCRIPT, ...args],
    command: NODE,
    cwd: repository.fixture.repoPath,
    env: fixtureEnv(),
    label: `lisa-run-gates.mjs ${args.join(" ")} in F-mixed`,
    ...(input === undefined ? {} : { input }),
  });
}

/**
 * Install a commit hook that starts the shipped runner the way a carrier for
 * a repository with no built-in checks does.
 * @param repository - The repository to install it in
 */
export function installCommitHook(repository: ScopedRepository): void {
  const hook = path.join(
    repository.fixture.repoPath,
    ".git",
    "hooks",
    "pre-commit"
  );
  writeFileSync(
    hook,
    `#!/bin/sh\nexec "${NODE}" "${RUNNER_SCRIPT}" --moment=commit --builtins=none\n`
  );
  chmodSync(hook, 0o755);
}

/**
 * Run `git commit` in the repository, hooks included.
 * @param repository - The repository
 * @param args - Arguments after `commit`
 * @returns The finished child; a hook's output is on its two streams
 */
export function gitCommit(
  repository: ScopedRepository,
  args: readonly string[]
): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    args: ["commit", ...args],
    command: GIT_BIN,
    cwd: repository.fixture.repoPath,
    env: fixtureEnv(),
    label: `git commit ${args.join(" ")} in F-mixed`,
  });
}

/**
 * Whether the command of the part covering a folder was started.
 * @param repository - The repository
 * @param scope - The part's folder
 * @returns True when the command left its file behind
 */
export function ran(repository: ScopedRepository, scope: string): boolean {
  return existsSync(path.join(repository.fixture.repoPath, scope, RAN));
}

/**
 * The evidence rows the last run recorded.
 * @param repository - The repository
 * @returns One row per gate or part
 */
export function evidenceRows(repository: ScopedRepository): EvidenceRow[] {
  const document = JSON.parse(readFileSync(repository.evidence, "utf8")) as {
    gates: EvidenceRow[];
  };
  return document.gates;
}

/**
 * The gates the last run told a stack hook it proved.
 * @param repository - The repository
 * @returns Gate ids; empty when the file was not written
 */
export function coveredGates(repository: ScopedRepository): string[] {
  return existsSync(repository.coverage)
    ? readFileSync(repository.coverage, "utf8").split("\n").filter(Boolean)
    : [];
}
