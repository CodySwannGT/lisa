/**
 * Installing carriers in a fixture repository and then using git in it, the
 * way an operator would (CodySwannGT/lisa#4989).
 *
 * Every suite about `lisa controls install-carriers` does the same three
 * things: declare a check in F-none, run the command, and then commit or push
 * with real git so the installed hook runs. They are written once here.
 *
 * The declared check is a Node one-liner standing in for a linter: it records
 * that it ran in a file outside the repository, and fails, the way a linter
 * reports it, when one source file holds a planted marker. F-none's own
 * linter is not used because it is not installed where the suite runs.
 * @module tests/support/carrier-install
 */
import { type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type InstallCarriersOptions,
  runInstallCarriers,
} from "../../src/controls/commands/install-carriers.js";
import type { CarrierResult } from "../../src/controls/carrier-types.js";
import { sweepAlreadyRanEnv } from "../helpers/cleanup-sweep-skip.js";
import { controlAuditGitEnv } from "../helpers/control-audit-fixtures.js";
import type { GatesBlock } from "../helpers/control-register.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { GIT_BIN } from "./git-executable.js";
import {
  declaredFNone,
  NODE,
  type NoManifestRepository,
  wholeRepositoryPart,
} from "./no-manifest-run.js";
import { createSymlink } from "./borrowed-node-modules.mjs";

/** The file of F-none the declared check reads. */
export const CHECKED_FILE = "src/fixture_none/greeting.py";

/** What a planted violation is: a line holding this word. */
export const PLANTED = "PLANTED_VIOLATION";

/** What the declared check prints when it measured a failure. */
export const LINT_SHAPE = "Found 1 error";

/** Records that it ran, then fails when the checked file holds the marker. */
const CHECK = [
  'const fs = require("node:fs");',
  'fs.appendFileSync(process.argv[1], "ran\\n");',
  `if (fs.readFileSync("${CHECKED_FILE}", "utf8").includes("${PLANTED}")) {`,
  `  console.log("${LINT_SHAPE}.");`,
  "  process.exit(1);",
  "}",
].join("\n");

/** Records that it ran, and finds nothing wrong. */
const RECORD = 'require("node:fs").appendFileSync(process.argv[1], "ran\\n");';

/** F-none with a check declared at commit and one at push. */
export interface CarrierRepository {
  /** The repository and a folder outside it. */
  readonly repository: NoManifestRepository;
  /** The repository's root. */
  readonly root: string;
  /** The file the commit check appends a line to each time it runs. */
  readonly commitRan: string;
  /** The file the push check appends a line to each time it runs. */
  readonly pushRan: string;
}

/**
 * The gates a carrier suite declares.
 * @param commitRan - The file the commit check records in
 * @param pushRan - The file the push check records in
 * @returns The `gates` block
 */
function carrierGates(commitRan: string, pushRan: string): GatesBlock {
  return {
    "code-style": {
      commit: "required",
      parts: [
        wholeRepositoryPart([NODE, "-e", CHECK, commitRan], [LINT_SHAPE]),
      ],
    },
    "test-correctness": {
      push: "required",
      parts: [wholeRepositoryPart([NODE, "-e", RECORD, pushRan])],
    },
  };
}

/**
 * Build F-none with the carrier suite's gates declared in it.
 * @returns The repository and where its checks record that they ran
 */
export function carrierRepository(): CarrierRepository {
  const outside = mkdtempSync(path.join(tmpdir(), "lisa-carrier-ran-"));
  const commitRan = path.join(outside, "commit-ran.txt");
  const pushRan = path.join(outside, "push-ran.txt");
  const repository = declaredFNone(carrierGates(commitRan, pushRan));
  return {
    commitRan,
    pushRan,
    repository: {
      ...repository,
      cleanup: () => {
        repository.cleanup();
        rmSync(outside, { force: true, recursive: true });
      },
    },
    root: repository.fixture.repoPath,
  };
}

/**
 * How many times a check recorded that it ran.
 * @param file - The file the check appends to
 * @returns The number of runs
 */
export function runs(file: string): number {
  return existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter(Boolean).length
    : 0;
}

/**
 * The environment an operator's git runs in: the fixture's, with Node on
 * `PATH` and the machine's temporary folder left alone.
 * @returns A complete environment for a child process
 */
export function operatorEnv(): NodeJS.ProcessEnv {
  const base = controlAuditGitEnv();
  return {
    ...sweepAlreadyRanEnv(base),
    PATH: [path.dirname(NODE), base.PATH ?? ""].join(path.delimiter),
  };
}

/** `PATH` with Node, and only Node, taken away. */
export interface NodeFreePath {
  /** The environment to run a child in. */
  readonly env: NodeJS.ProcessEnv;
  /** Remove the folders that were made for it. */
  readonly cleanup: () => void;
}

/**
 * Take Node, and nothing else, off `PATH`.
 *
 * A folder that holds `node` usually holds other programs too. Dropping the
 * folder would take those away as well, and a hook that then failed would
 * prove nothing about Node. So each such folder is replaced by one that links
 * to everything in it except `node`.
 * @param env - The environment to start from
 * @returns The environment without Node, and how to clean up
 */
export function withoutNode(env: NodeJS.ProcessEnv): NodeFreePath {
  const shadows = mkdtempSync(path.join(tmpdir(), "lisa-carrier-no-node-"));
  const folders = (env.PATH ?? "")
    .split(path.delimiter)
    .filter(folder => folder !== "")
    .map((folder, index) => {
      if (!existsSync(path.join(folder, "node"))) return folder;
      const shadow = path.join(shadows, String(index));
      mkdirSync(shadow);
      for (const name of readdirSync(folder)) {
        if (name !== "node") {
          createSymlink(path.join(folder, name), path.join(shadow, name));
        }
      }
      return shadow;
    });
  return {
    cleanup: () => rmSync(shadows, { force: true, recursive: true }),
    env: { ...env, PATH: folders.join(path.delimiter) },
  };
}

/**
 * Run git in a repository as an operator would, and hand back however it
 * ended. Unlike the fixture's own helper, a non-zero exit is an answer here:
 * a rejected commit is what several suites are looking for.
 * @param root - The repository
 * @param args - Arguments to git
 * @param env - The environment; an operator's by default
 * @returns The finished child
 */
export function operatorGit(
  root: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = operatorEnv()
): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    label: `git ${args.join(" ")} in a carrier fixture`,
    command: GIT_BIN,
    args,
    cwd: root,
    env,
  });
}

/**
 * Write a file of a repository and stage it.
 * @param root - The repository
 * @param relative - The file, from the repository root
 * @param content - What it holds
 */
export function stage(root: string, relative: string, content: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (operatorGit(root, ["add", "--", relative]).status !== 0) {
    throw new Error(`git add failed for ${relative}`);
  }
}

/**
 * Stage a change to the checked file and try to commit it.
 * @param root - The repository
 * @param line - The line the checked file gains
 * @param env - The environment; an operator's by default
 * @returns The finished `git commit`
 */
export function commitLine(
  root: string,
  line: string,
  env: NodeJS.ProcessEnv = operatorEnv()
): SpawnSyncReturns<string> {
  const before = readFileSync(path.join(root, CHECKED_FILE), "utf8");
  stage(root, CHECKED_FILE, `${before}${line}\n`);
  return operatorGit(root, ["commit", "-m", "chore: change the greeting"], env);
}

/**
 * The commit a repository is on.
 * @param root - The repository
 * @returns The commit's id
 */
export function head(root: string): string {
  return operatorGit(root, ["rev-parse", "HEAD"]).stdout.trim();
}

/**
 * What `git status` reports as changed or untracked.
 * @param root - The repository
 * @returns One line per path; empty when the tree is clean
 */
export function dirt(root: string): string {
  return operatorGit(root, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]).stdout.trimEnd();
}

/** One finished run of the command. */
export interface CarrierCommandRun {
  /** The exit code. */
  readonly code: number;
  /** The JSON document on stdout, or `null` when there was none. */
  readonly result: CarrierResult | null;
  /** Everything written for a person, one item per line. */
  readonly said: readonly string[];
}

/**
 * Run `lisa controls install-carriers` against a repository.
 * @param root - The repository
 * @param options - The command's options
 * @returns The exit code, the result document and what was said
 */
export async function installCarriers(
  root: string,
  options: InstallCarriersOptions = {}
): Promise<CarrierCommandRun> {
  const printed: string[] = [];
  const said: string[] = [];
  const code = await runInstallCarriers(root, options, {
    env: operatorEnv(),
    stderr: line => said.push(line),
    stdout: text => printed.push(text),
  });
  return {
    code,
    result:
      printed.length === 0
        ? null
        : (JSON.parse(printed.join("\n")) as CarrierResult),
    said,
  };
}

/**
 * Commit everything the command wrote, so the tree is clean again.
 * @param root - The repository
 */
export function commitInstalled(root: string): void {
  const added = operatorGit(root, ["add", "--all"]);
  const committed = operatorGit(root, [
    "commit",
    "-m",
    "chore: install the commit and push carriers",
  ]);
  if (added.status !== 0 || committed.status !== 0) {
    throw new Error(`${added.stderr}${committed.stdout}${committed.stderr}`);
  }
}
