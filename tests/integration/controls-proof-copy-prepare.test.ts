/** Preparation runs in the disposable copy before its proof halves. */
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildControlAuditFixture } from "../helpers/control-audit-fixtures.js";
import { FAKE_CREDENTIALS } from "../helpers/fake-credentials.js";
import {
  FAILURE_TEXT,
  F_NONE_SOURCE,
  VIOLATION_MARK,
  proofFiles,
  proofPatches,
  provedGates,
} from "../helpers/control-proofs.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { operatorEnv } from "../support/carrier-install.js";
import {
  ATTEST_RESULT_FILES,
  repositoryState,
  withUncommittedWork,
} from "../support/repository-state.js";

useIoLatencyBudget();

const CLI = path.resolve("dist/index.js");
const CASE_DEPENDENCY = "fixture-proof-dependency";
const PROOF_CHECK = "proof-check";
const PREPARE = [process.execPath, "tools/prepare-proof.mjs"];
const HUSKY = [
  process.execPath,
  path.resolve("node_modules/husky/lib/bin.js"),
  "install",
];
const CONTROL = [process.execPath, "tools/check-proof.cjs"];
const PATCHES = proofFiles(proofPatches("F-none", F_NONE_SOURCE));
const ALL_RESULTS = [...ATTEST_RESULT_FILES];
const cleanups: Array<() => void> = [];

afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

/**
 * Build an owned fixture with a local package installed only by preparation.
 * @param prepare - The declaration for the proof-copy preparation
 * @param extraFiles - Additional committed host files
 * @returns The fixture repository root
 */
function repository(
  prepare?: unknown,
  extraFiles: Readonly<Record<string, string>> = {}
): string {
  const fixture = buildControlAuditFixture("F-none", {
    extraFiles: {
      ".lisa.config.json": JSON.stringify({
        gates: provedGates([{ command: CONTROL }]),
        ...(prepare === undefined
          ? {}
          : { controls: { proof_copy: { prepare } } }),
      }),
      "tools/check-proof.cjs": [
        "const { readFileSync, writeFileSync, existsSync } = require('node:fs');",
        `const covered = require('${CASE_DEPENDENCY}');`,
        "if (existsSync('proof-half-left-behind')) process.exit(17);",
        "writeFileSync('proof-half-left-behind', 'this proof wrote a generated file');",
        `if (covered && readFileSync('${F_NONE_SOURCE}', 'utf8').includes('${VIOLATION_MARK}')) { console.log('${FAILURE_TEXT}'); process.exit(1); }`,
        "console.log('Clean fixture passed');",
      ].join("\n"),
      "tools/prepare-proof.mjs": [
        "import { chmodSync, cpSync, existsSync, mkdirSync } from 'node:fs';",
        "if (existsSync('proof-preparation-ran')) process.exit(19);",
        "mkdirSync('proof-preparation-ran');",
        "if (existsSync('.husky/pre-commit')) chmodSync('.husky/pre-commit', 0o755);",
        `mkdirSync('node_modules', { recursive: true });`,
        `cpSync('vendor/${CASE_DEPENDENCY}', 'node_modules/${CASE_DEPENDENCY}', { recursive: true });`,
      ].join("\n"),
      [`vendor/${CASE_DEPENDENCY}/package.json`]: JSON.stringify({
        name: CASE_DEPENDENCY,
        version: "1.0.0",
        main: "index.cjs",
      }),
      [`vendor/${CASE_DEPENDENCY}/index.cjs`]: "module.exports = true;\n",
      ...PATCHES,
      ...extraFiles,
    },
  });
  cleanups.push(fixture.cleanup);
  return fixture.repoPath;
}

/**
 * Use the built binary in the real fixture repository.
 * @param root - The owned fixture checkout
 * @param command - Controls subcommand and arguments
 * @returns The actual command result
 */
function run(root: string, ...command: readonly string[]) {
  return boundedSpawnSync({
    label: `proof preparation ${command.join(" ")}`,
    command: process.execPath,
    args: [CLI, "--no-update-check", "controls", ...command],
    cwd: root,
    env: operatorEnv(),
    baseMs: 30_000,
  });
}

describe("controls proof-copy preparation", () => {
  it("makes a dependency-backed check ready and keeps work and generated files isolated", () => {
    const unprepared = run(repository(), PROOF_CHECK);
    expect(unprepared.status).not.toBe(0);

    const root = repository([PREPARE]);
    withUncommittedWork(root, F_NONE_SOURCE);
    const before = repositoryState(root);
    const checked = run(root, PROOF_CHECK);
    expect(checked.status, checked.stderr + checked.stdout).toBe(0);
    expect(JSON.parse(checked.stdout).parts).toEqual([
      expect.objectContaining({ result: "ready" }),
    ]);
    expect(repositoryState(root)).toEqual(before);
    const attest = run(root, "attest", "--json");
    expect(attest.status, attest.stderr + attest.stdout).toBe(0);
    expect(JSON.parse(attest.stdout).entries).toEqual([
      expect.objectContaining({ outcome: "passed" }),
    ]);
    expect(repositoryState(root, { except: ALL_RESULTS })).toEqual(before);
    expect(ALL_RESULTS.every(file => existsSync(path.join(root, file)))).toBe(
      true
    );
  });

  it("honors a hook manager installed by preparation in both attest modes", () => {
    const root = repository([PREPARE, HUSKY], {
      ".husky/pre-commit": "#!/bin/sh\n:\n",
    });
    const before = repositoryState(root);
    const observation = run(root, "attest", "--before-enforce", "--json");
    expect(observation.status, observation.stderr + observation.stdout).toBe(0);
    expect(JSON.parse(observation.stdout)).toMatchObject({
      copy: { carriers_installed: false, hooks_path: ".husky" },
      entries: [
        expect.objectContaining({
          moment: "commit",
          result: "not-enforced",
          tool: expect.objectContaining({
            exit_status: 1,
            outcome: "rejected",
          }),
        }),
      ],
    });
    expect(repositoryState(root)).toEqual(before);

    const attest = run(root, "attest", "--json");
    expect(attest.status, attest.stderr + attest.stdout).toBe(0);
    expect(JSON.parse(attest.stdout).entries).toEqual([
      expect.objectContaining({ outcome: "passed" }),
    ]);
    expect(repositoryState(root, { except: ALL_RESULTS })).toEqual(before);
  });

  it("can patch a tracked file after preparation changes its mode", () => {
    const root = repository([
      PREPARE,
      [
        process.execPath,
        "-e",
        `require("node:fs").chmodSync(${JSON.stringify(F_NONE_SOURCE)}, 0o755)`,
      ],
    ]);
    const before = repositoryState(root);
    const checked = run(root, PROOF_CHECK);

    expect(checked.status, checked.stderr + checked.stdout).toBe(0);
    expect(JSON.parse(checked.stdout).parts).toEqual([
      expect.objectContaining({ result: "ready" }),
    ]);
    expect(repositoryState(root)).toEqual(before);
  });

  it("reports failed preparation and writes no evidence", () => {
    const fixture = FAKE_CREDENTIALS.find(
      value => value.label === "a GitHub personal token"
    );
    if (fixture === undefined)
      throw new Error("Missing synthetic credential fixture");
    const secret = fixture.make();
    const fragments = JSON.stringify([secret.slice(0, 2), secret.slice(2)]);
    const root = repository([
      [
        process.execPath,
        "-e",
        `console.error("fixture preparation failed", ${fragments}.join("")); process.exit(23)`,
      ],
    ]);
    const before = repositoryState(root);
    const result = run(root, "attest", "--json");
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("fixture preparation failed");
    expect(result.stderr).toContain("[REDACTED:");
    expect(result.stderr).not.toContain(secret);
    expect(repositoryState(root)).toEqual(before);
    expect(ALL_RESULTS.some(file => existsSync(path.join(root, file)))).toBe(
      false
    );
  });

  it("refuses a preparation configured as a shell string", () => {
    const result = run(repository("node tools/prepare-proof.mjs"), "register");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("controls.proof_copy.prepare");
  });
});
