/**
 * `lisa controls attest`, run as the built command inside a repository Lisa
 * was never applied to (CodySwannGT/lisa#4995).
 *
 * The unit suites run the runner from source. This one runs the built
 * artifact with the fixture repository as its working directory, which is how
 * the attest step calls it. It covers what the command exists for: a control
 * whose check rejects everything or accepts everything is reported as
 * failing, and a control that works gets the same results on every run, with
 * no connection opened by anything the command starts.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProofRun } from "../../src/controls/proof-types.js";
import {
  controlAuditGitEnv,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import {
  ACCEPTS_EVERYTHING,
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  provedGates,
  REJECTS_EVERYTHING,
  withoutTimes,
  workspaceCopy,
} from "../helpers/control-proofs.js";
import type { GatesBlock } from "../helpers/control-register.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const NODE = process.execPath;

/** The flag that names the disposable copy. */
const WORKSPACE_FLAG = "--workspace";

/** The variable naming the file every refused connection is written to. */
const REFUSALS = "LISA_TEST_REFUSED_CONNECTIONS";

/**
 * Loaded into every Node process the command starts, and every one those
 * start. It refuses each way a Node program opens a connection, and writes
 * down that it was asked.
 */
const REFUSE_CONNECTIONS = [
  "const { appendFileSync } = require('node:fs');",
  `const refuse = what => { appendFileSync(process.env.${REFUSALS}, what + '\\n'); throw new Error('connection refused by the test: ' + what); };`,
  "require('node:net').Socket.prototype.connect = () => refuse('net.connect');",
  "require('node:dns').lookup = () => refuse('dns.lookup');",
  "globalThis.fetch = () => refuse('fetch');",
].join("\n");

/** A check that tries to open a connection before it does anything else. */
const OPENS_A_CONNECTION = [
  NODE,
  "-e",
  "require('node:net').connect(9, '127.0.0.1'); console.log('All checks passed');",
];

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);

const cleanups: (() => void)[] = [];

/** A repository, a disposable copy of it, and nowhere to connect to. */
interface Setting {
  readonly repoPath: string;
  readonly workspace: string;
  /** The file every refused connection is written to. */
  readonly refusals: string;
  /** The environment the built command is run in. */
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Build a repository with a gates declaration and its proof files, a
 * disposable copy of it, and an environment in which no Node process can
 * open a connection.
 * @param gates - The gates block
 * @returns The setting
 */
function setting(gates: GatesBlock): Setting {
  const built: ControlAuditFixture = buildProofFixture(gates);
  const copy = workspaceCopy(built.repoPath);
  const scratch = mkdtempSync(path.join(tmpdir(), "lisa-attest-offline-"));
  const preload = path.join(scratch, "refuse-connections.cjs");
  const refusals = path.join(scratch, "refused.log");
  writeFileSync(preload, REFUSE_CONNECTIONS);
  writeFileSync(refusals, "");
  cleanups.push(built.cleanup, copy.cleanup, () =>
    rmSync(scratch, { force: true, recursive: true })
  );
  return {
    repoPath: built.repoPath,
    workspace: copy.directory,
    refusals,
    env: {
      ...controlAuditGitEnv(),
      LISA_SKIP_UPDATE_CHECK: "1",
      NODE_OPTIONS: `--require=${preload}`,
      [REFUSALS]: refusals,
    },
  };
}

/**
 * Run the built command from inside a repository, with no path argument.
 * @param where - The setting
 * @param flags - Flags after `attest`
 * @returns Exit status and both streams
 */
function attest(
  where: Setting,
  flags: readonly string[] = [WORKSPACE_FLAG, where.workspace]
): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const child = boundedSpawnSync({
    label: "lisa controls attest (built CLI in a fixture)",
    command: NODE,
    args: [DIST_CLI, "controls", "attest", ...flags],
    cwd: where.repoPath,
    env: where.env,
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

beforeEach(() => {
  cleanups.splice(0);
});

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => {
    cleanup();
  });
});

describe("built lisa controls attest in a repository without Lisa", () => {
  it("reports a check that rejects everything and one that accepts everything as failing", () => {
    const where = setting({
      ...provedGates([{ command: ACCEPTS_EVERYTHING }]),
      ...provedGates([{ command: REJECTS_EVERYTHING }], "test-correctness", [
        "push",
      ]),
    });

    const run = attest(where);

    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(
      /^failed \(violation\) +code-style@\. +commit /mu
    );
    expect(run.stdout).toMatch(
      /^failed \(clean\) +test-correctness@\. +push /mu
    );
    expect(run.stderr).toContain(
      "attest: FAIL. 0 of 2 entries proved: 0 passed, 2 failed, 0 unproved, 0 unknown"
    );
  });

  it("gives a working control the same results twice, apart from their times, and opens no connection", () => {
    const where = setting(WORKING);
    const flags = [WORKSPACE_FLAG, where.workspace, "--json"];

    const first = attest(where, flags);
    const second = attest(where, flags);
    const documents = [first, second].map(
      run => JSON.parse(run.stdout) as ProofRun
    );

    expect([first.status, second.status]).toEqual([0, 0]);
    expect([first.stderr, second.stderr]).toEqual(["", ""]);
    expect(documents[0]?.entries.map(entry => entry.outcome)).toEqual([
      "passed",
    ]);
    expect(withoutTimes(documents[1] as ProofRun)).toBe(
      withoutTimes(documents[0] as ProofRun)
    );
    expect(readFileSync(where.refusals, "utf8")).toBe("");
  });

  it("really does run with every connection refused: a check that opens one is refused and never passes", () => {
    const where = setting(provedGates([{ command: OPENS_A_CONNECTION }]));

    const run = attest(where, [WORKSPACE_FLAG, where.workspace, "--json"]);
    const [entry] = (JSON.parse(run.stdout) as ProofRun).entries;

    expect(run.status).toBe(1);
    expect(entry?.outcome).toBe("unknown");
    expect(entry?.halves[0]?.output_excerpt).toContain(
      "connection refused by the test: net.connect"
    );
    expect(readFileSync(where.refusals, "utf8")).toBe(
      "net.connect\nnet.connect\n"
    );
  });

  it("refuses to run a proof in the repository it is standing in", () => {
    const where = setting(WORKING);

    // Naming the repository as its own copy. With no folder named the command
    // makes a copy of its own: see controls-attest-disposable-copy.test.ts.
    const run = attest(where, [WORKSPACE_FLAG, "."]);

    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("is the repository itself");
    expect(readFileSync(path.join(where.repoPath, F_NONE_SOURCE), "utf8")).toBe(
      readFileSync(path.join(where.workspace, F_NONE_SOURCE), "utf8")
    );
  });
});
