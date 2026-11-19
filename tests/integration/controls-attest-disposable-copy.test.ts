/**
 * `lisa controls attest` with no `--workspace`, run as the built command in
 * a repository that has work in progress (CodySwannGT/lisa#4996).
 *
 * The promise under test: an operator can run the command in a repository
 * with uncommitted work and a stash, and the proofs change nothing there.
 * Afterwards the index, the refs, the stash, the checkout's own settings and
 * every path of the working tree are exactly as they were, and nothing is
 * left in the temporary folder.
 *
 * A run that finishes then writes its results, to three files and no
 * others: the evidence, the control register and the verdict, under
 * `.lisa/controls/` (CodySwannGT/lisa#4998). So after such a run everything
 * is identical except those three paths, which are named one by one. A run
 * stopped by a signal part-way through a proof writes none of them, and the
 * repository is identical with no exception.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProofRun } from "../../src/controls/proof-types.js";
import {
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  FAILURE_TEXT,
  proofFiles,
  proofPatches,
  provedGates,
  VIOLATION_MARK,
} from "../helpers/control-proofs.js";
import type { GatesBlock } from "../helpers/control-register.js";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { operatorEnv } from "../support/carrier-install.js";
import {
  ATTEST_RESULT_FILES,
  pathStandings,
  repositoryState,
  withUncommittedWork,
  type RepositoryState,
} from "../support/repository-state.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const NODE = process.execPath;
const PATCHES = proofPatches("F-none", F_NONE_SOURCE);
const FILES = { ...proofFiles(PATCHES), ...proofFiles(PATCHES, "tests") };

/** The start of the name of every run's temporary folder. */
const RUN_FOLDER = "lisa-attest-";

/** How long the slow check holds a proof open, in milliseconds. */
const SLOW_CHECK_MS = 2500;

/** How long a run may take before the case gives up on it. */
const RUN_BUDGET_MS = ioLatencyBudgetMs(30_000);

const AT_COMMIT_AND_PUSH: GatesBlock = {
  ...provedGates([{ command: checks(F_NONE_SOURCE) }]),
  ...provedGates(
    [{ command: checks(F_NONE_SOURCE), name: "tests" }],
    "test-correctness",
    ["push"]
  ),
};

const cleanups: (() => void)[] = [];

/** A repository with work in progress, and an empty temporary folder. */
interface Setting {
  readonly repoPath: string;
  /** The temporary folder the command is given, empty to begin with. */
  readonly tmp: string;
  /** A folder outside the repository a check can leave a mark in. */
  readonly outside: string;
  /** The environment the built command is run in. */
  readonly env: NodeJS.ProcessEnv;
  /** The repository's state before the command ran. */
  readonly before: RepositoryState;
}

/**
 * Make a new, empty folder that is removed when the case is over.
 * @param name - What the folder is for
 * @returns Its real path
 */
function emptyFolder(name: string): string {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), name)));
  cleanups.push(() =>
    rmSync(folder, { force: true, maxRetries: 10, recursive: true })
  );
  return folder;
}

/**
 * Build F-none with checks declared, then give it uncommitted work and a
 * stash entry.
 * @param gatesFor - The gates block, given a folder outside the repository
 * @returns The setting
 */
function setting(gatesFor: (outside: string) => GatesBlock): Setting {
  const outside = emptyFolder("lisa-attest-copy-outside-");
  const tmp = emptyFolder("lisa-attest-copy-tmp-");
  const built = buildProofFixture(gatesFor(outside), FILES);
  cleanups.push(built.cleanup);
  withUncommittedWork(built.repoPath, F_NONE_SOURCE);
  return {
    repoPath: built.repoPath,
    tmp,
    outside,
    env: { ...operatorEnv(), LISA_SKIP_UPDATE_CHECK: "1", TMPDIR: tmp },
    before: repositoryState(built.repoPath),
  };
}

/**
 * The run folders left in the temporary folder.
 * @param where - The setting
 * @returns Their names
 */
function runFolders(where: Setting): readonly string[] {
  return readdirSync(where.tmp).filter(name => name.startsWith(RUN_FOLDER));
}

/**
 * A check that says it has started, holds the proof open, and then judges
 * the file like any other check.
 * @param started - The file it creates when it starts
 * @returns The check, as an argument list
 */
function slowCheck(started: string): readonly string[] {
  return [
    NODE,
    "-e",
    [
      "const fs = require('node:fs');",
      "fs.writeFileSync(process.argv[1], 'started');",
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${SLOW_CHECK_MS});`,
      `if (fs.readFileSync(${JSON.stringify(F_NONE_SOURCE)}, 'utf8').includes('${VIOLATION_MARK}')) { console.log('${FAILURE_TEXT}'); process.exit(1); }`,
      "console.log('All checks passed');",
    ].join(" "),
    started,
  ];
}

/** How an interrupted run ended. */
interface Interrupted {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  /** The run folders that existed when the signal was sent. */
  readonly foldersAtSignal: readonly string[];
}

/**
 * Start the built command, wait until a proof's check is running, send the
 * command one signal, and wait for it to end.
 * @param where - The setting
 * @param started - The file the slow check creates when it starts
 * @param signal - The signal to send
 * @returns How the run ended
 */
function interrupt(
  where: Setting,
  started: string,
  signal: NodeJS.Signals
): Promise<Interrupted> {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [DIST_CLI, "controls", "attest"], {
      cwd: where.repoPath,
      env: where.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const said: Buffer[] = [];
    const sent = { folders: [] as readonly string[], done: false };
    child.stderr.on("data", (chunk: Buffer) => said.push(chunk));
    const giveUp = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`the run was still going after ${RUN_BUDGET_MS} ms`));
    }, RUN_BUDGET_MS);
    const watch = setInterval(() => {
      if (sent.done || !existsSync(started)) return;
      sent.done = true;
      sent.folders = runFolders(where);
      child.kill(signal);
    }, 25);
    child.on("error", reject);
    child.on("exit", (code, endedBy) => {
      clearTimeout(giveUp);
      clearInterval(watch);
      resolve({
        code,
        signal: endedBy,
        stderr: Buffer.concat(said).toString("utf8"),
        foldersAtSignal: sent.folders,
      });
    });
  });
}

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => {
    cleanup();
  });
});

describe("built lisa controls attest with no --workspace", () => {
  it("proves through a real commit and a real push and changes nothing in the repository but the three files of results", () => {
    const where = setting(() => AT_COMMIT_AND_PUSH);

    const child = boundedSpawnSync({
      label: "lisa controls attest --json (built CLI, its own copy)",
      command: NODE,
      args: [DIST_CLI, "controls", "attest", "--json"],
      baseMs: 30_000,
      cwd: where.repoPath,
      env: where.env,
    });

    const run = JSON.parse(child.stdout) as ProofRun;
    expect(child.status).toBe(0);
    expect(
      run.entries.map(entry => [
        entry.entry_id,
        entry.moment,
        entry.outcome,
        entry.halves.map(half => half.command?.slice(0, 2).join(" ")),
      ])
    ).toEqual([
      ["code-style@.", "commit", "passed", ["git commit", "git commit"]],
      ["test-correctness@.", "push", "passed", ["git push", "git push"]],
    ]);
    expect(child.stderr).toContain(
      "attest: note. This repository has changes that are not committed. The proofs do not use them"
    );
    // Index, refs, stash, settings and every path but the three named ones
    // are as they were. `before` was taken with nothing left out, so this
    // also says none of the three was there to begin with.
    expect(
      repositoryState(where.repoPath, { except: ATTEST_RESULT_FILES })
    ).toEqual(where.before);
    expect(pathStandings(where.repoPath, ATTEST_RESULT_FILES)).toEqual({
      ".lisa/controls/evidence.json": "untracked",
      ".lisa/controls/register.json": "untracked",
      ".lisa/controls/verdict.json": "untracked",
    });
    expect(readdirSync(where.tmp)).toEqual([]);
  });

  it.each(["SIGTERM", "SIGINT"] as const)(
    "stopped by %s part-way through a proof, removes its temporary folder and leaves the repository exactly as it was",
    async signal => {
      const started = { file: "" };
      const where = setting(outside => {
        started.file = path.join(outside, "check-started");
        return provedGates([{ command: slowCheck(started.file) }]);
      });

      const ended = await interrupt(where, started.file, signal);

      // The copy was there, with the planted change in it, when the signal
      // was sent: this is an interruption of a proof, not of start-up.
      expect(ended.foldersAtSignal).toHaveLength(1);
      expect(ended.signal).toBe(signal);
      expect(ended.code).toBeNull();
      expect(ended.stderr).toContain(
        "attest: interrupted. The temporary copy the proofs ran in was removed. Your repository was not changed."
      );
      expect(readdirSync(where.tmp)).toEqual([]);
      // No exception here: a run that is stopped before its proofs are over
      // has no results, so it writes none of the three files either.
      expect(repositoryState(where.repoPath)).toEqual(where.before);
      expect(
        Object.values(pathStandings(where.repoPath, ATTEST_RESULT_FILES))
      ).toEqual(["missing", "missing", "missing"]);
    }
  );
});
