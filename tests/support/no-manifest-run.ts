/**
 * Running Lisa's two shipped gate scripts in a repository that has no
 * `package.json` (CodySwannGT/lisa#4987).
 *
 * The repository is F-none: a small Python package, nothing from Node in it.
 * Every suite that asks "what do the gate registry and the gate runner do
 * there" starts the same two files the same way, so the way is written once.
 * @module tests/support/no-manifest-run
 */
import { type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sweepAlreadyRanEnv } from "../helpers/cleanup-sweep-skip.js";
import {
  buildFNone,
  type ControlAuditFixture,
  controlAuditGitEnv,
} from "../helpers/control-audit-fixtures.js";
import { configFile, type GatesBlock } from "../helpers/control-register.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const SCRIPTS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../all/copy-overwrite/scripts"
);

/** The gate registry, as it is shipped. */
export const GATES_SCRIPT = path.join(SCRIPTS, "lisa-gates.mjs");

/** The gate runner, as it is shipped. */
export const RUNNER_SCRIPT = path.join(SCRIPTS, "lisa-run-gates.mjs");

/** The program every declared command in these suites starts. */
export const NODE = process.execPath;

/** How a caller with no checks of its own says so to the runner. */
export const NO_BUILTINS = "--builtins=none";

/** F-none, and a folder outside it for whatever a run writes. */
export interface NoManifestRepository {
  /** The repository. It holds no `package.json`. */
  readonly fixture: ControlAuditFixture;
  /** A folder outside the repository, removed with it. */
  readonly scratch: string;
  /** Remove both. */
  readonly cleanup: () => void;
}

/**
 * Build F-none with `.lisa.config.json` holding exactly the given text.
 * @param config - The file's content, or `null` to commit no such file
 * @returns The repository and a folder outside it
 */
export function fNoneWithConfig(config: string | null): NoManifestRepository {
  const fixture = buildFNone(
    config === null ? {} : { extraFiles: { ".lisa.config.json": config } }
  );
  const scratch = mkdtempSync(path.join(tmpdir(), "lisa-no-manifest-"));
  return {
    cleanup: () => {
      fixture.cleanup();
      rmSync(scratch, { force: true, recursive: true });
    },
    fixture,
    scratch,
  };
}

/**
 * Build F-none with the given gates declared in it.
 * @param gates - The `gates` block of `.lisa.config.json`
 * @returns The repository and a folder outside it
 */
export function declaredFNone(gates: GatesBlock): NoManifestRepository {
  return fNoneWithConfig(configFile(gates));
}

/**
 * Start one of the shipped scripts from the root of a repository.
 *
 * The environment is the fixture's: none of the `GIT_*` variables a hook
 * exports, so a suite run from a hook still asks about the fixture. A task
 * runner that does get started keeps its cache and logs in the folder outside
 * the repository rather than in the home directory of whoever runs the suite,
 * and a run at push leaves the machine's temporary folder alone.
 * @param repository - The repository to run in
 * @param script - `GATES_SCRIPT` or `RUNNER_SCRIPT`
 * @param args - Arguments after the script
 * @returns The finished child
 */
export function runShipped(
  repository: NoManifestRepository,
  script: string,
  args: readonly string[]
): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    label: `${path.basename(script)} ${args.join(" ")} with no package.json`,
    command: NODE,
    args: [script, ...args],
    cwd: repository.fixture.repoPath,
    env: sweepAlreadyRanEnv({
      ...controlAuditGitEnv(),
      npm_config_cache: path.join(repository.scratch, "npm-cache"),
      npm_config_update_notifier: "false",
    }),
  });
}

/**
 * The lines of a transcript that are frames of a JavaScript stack trace.
 *
 * An operator standing at the gate is told what is wrong in a sentence. A
 * frame — `    at readFileSync (node:fs:441:20)` — is the program reporting
 * that it did not expect to be here.
 * @param transcript - What a command printed
 * @returns The frame lines; empty when there are none
 */
export function stackFrames(transcript: string): string[] {
  return transcript
    .split("\n")
    .filter(line => /^\s+at .+:\d+:\d+\)?$/.test(line));
}

/**
 * One part covering the whole repository.
 * @param command - The argument list that checks it
 * @param failureShape - What the command prints when it measured a failure
 * @returns The part, as a project declares it
 */
export function wholeRepositoryPart(
  command: readonly string[],
  failureShape?: readonly string[]
): Record<string, unknown> {
  return {
    scope: ".",
    command,
    ...(failureShape === undefined
      ? {}
      : { proof: { failure_shape: failureShape } }),
  };
}
