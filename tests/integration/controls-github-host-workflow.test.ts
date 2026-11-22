/** Run a standalone GitHub workflow's gate commands in a repository with no stack. @module */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildGateReport } from "../../src/cli/gate-report.js";
import { generateControlRegister } from "../../src/controls/register.js";
import { buildControlAuditFixture } from "../helpers/control-audit-fixtures.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { installCarriers, operatorEnv } from "../support/carrier-install.js";

const WORKFLOW = ".github/workflows/lisa-declared-controls.yml";
const MOMENT = "pull-request";
const GATE = "code-style";
const COSTLY_GATE = "test-correctness";
const REGISTRY = "scripts/lisa-gates.mjs";
const RUNNER = "scripts/lisa-run-gates.mjs";
const THRESHOLD = "scripts/check-threshold-ratchet.mjs";
const PART_PROGRAM = "part-check.mjs";
const STANDALONE = "--builtins=none";
const ALL_PARTS = "--parts=all";
const API_MARKER = "api part ran";
const WEB_MARKER = "web part ran";
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Install the real carrier files and declare API and web checks in a repository without a stack.
 * @param webExit - Exit code for the web check
 * @param apiExit - Exit code for the API check
 * @param gate - The gate that owns both parts
 * @returns The new repository root
 */
async function repository(
  webExit = 0,
  apiExit = 0,
  gate = GATE
): Promise<string> {
  const built = buildControlAuditFixture("F-none", {
    extraFiles: {
      ".lisa.config.json": JSON.stringify({
        gates: {
          [gate]: {
            [MOMENT]: {
              level: "required",
              caller_chain: ["Declared Controls"],
              executor: { platform: "github", path: WORKFLOW },
            },
            parts: ["api", "web"].map(scope => ({
              scope,
              command: [process.execPath, PART_PROGRAM],
              evidence: {
                locators: [{ path: `${scope}/${PART_PROGRAM}`, line: 1 }],
              },
            })),
          },
          "threshold-monotonicity": {
            push: "required",
            parts: [
              {
                scope: ".",
                command: [process.execPath, THRESHOLD, "--staged"],
                evidence: {
                  locators: [{ path: "api/part-check.mjs", line: 1 }],
                },
              },
            ],
          },
        },
      }),
      "api/part-check.mjs": `console.log(${JSON.stringify(API_MARKER)}); process.exit(${apiExit});\n`,
      "web/part-check.mjs": `console.log(${JSON.stringify(WEB_MARKER)}); process.exit(${webExit});\n`,
    },
  });
  const run = await installCarriers(built.repoPath);
  cleanups.push(built.cleanup);
  expect(run.code, run.said.join("\n")).toBe(0);
  return built.repoPath;
}

/**
 * Run the same installed script and argv that a CI job uses.
 * @param cwd - The owned checkout
 * @param args - Script and arguments
 * @returns The child process result
 */
function run(cwd: string, args: readonly string[]) {
  return boundedSpawnSync({
    command: process.execPath,
    args,
    cwd,
    env: operatorEnv(),
    label: "host GitHub workflow gate",
    baseMs: 30_000,
  });
}

describe("GitHub pull-request gates in a repository with no project type", () => {
  it.each([0, 1])(
    "runs both scoped parts and returns %i when the web part does",
    async status => {
      const root = await repository(status);
      const planned = run(root, [
        REGISTRY,
        "legs",
        `--moment=${MOMENT}`,
        `--host-workflow=${WORKFLOW}`,
        "--json",
      ]);
      const required = run(root, [REGISTRY, "contexts", `--moment=${MOMENT}`]);
      const checked = run(root, [
        RUNNER,
        `--moment=${MOMENT}`,
        STANDALONE,
        ALL_PARTS,
        `--gate=${GATE}`,
      ]);

      expect(planned.status, planned.stderr).toBe(0);
      expect(required.status, required.stderr).toBe(0);
      const legs = JSON.parse(planned.stdout) as Array<{ context: string }>;
      expect(legs).toEqual([
        expect.objectContaining({ gate: GATE, action: "run" }),
      ]);
      expect(JSON.parse(required.stdout)).toEqual(legs.map(leg => leg.context));
      expect(checked.status, checked.stderr + checked.stdout).toBe(status);
      expect(checked.stdout).toContain(API_MARKER);
      expect(checked.stdout).toContain(WEB_MARKER);
    }
  );

  it("runs the second costly part even when the first part fails", async () => {
    const root = await repository(0, 1, COSTLY_GATE);
    const checked = run(root, [
      RUNNER,
      `--moment=${MOMENT}`,
      STANDALONE,
      ALL_PARTS,
      `--gate=${COSTLY_GATE}`,
    ]);

    expect(checked.status).toBe(1);
    expect(checked.stdout).toContain(API_MARKER);
    expect(checked.stdout).toContain(WEB_MARKER);
  });

  it("marks both entries unproved and reports both scopes", async () => {
    const root = await repository();
    const generated = await generateControlRegister(root);
    const report = await buildGateReport({ projectRoot: root, offline: true });
    const cell = report.gates
      .find(row => row.id === GATE)
      ?.moments.find(row => row.moment === MOMENT);

    expect(generated.problems).toBeNull();
    expect(
      generated.problems === null &&
        generated.register.entries.filter(row => row.gate === GATE)
    ).toEqual([
      expect.objectContaining({ scope: "api", status: "unproved" }),
      expect.objectContaining({ scope: "web", status: "unproved" }),
    ]);
    expect(cell?.parts).toEqual([
      { scope: "api", argv: [process.execPath, PART_PROGRAM] },
      { scope: "web", argv: [process.execPath, PART_PROGRAM] },
    ]);
  });

  it("ships the threshold command and both required helpers on a never-applied host", async () => {
    const root = await repository();
    const checked = run(root, [RUNNER, "--moment=push", STANDALONE, ALL_PARTS]);

    expect(existsSync(path.join(root, THRESHOLD))).toBe(true);
    expect(
      existsSync(path.join(root, "scripts/threshold-ratchet-compare.mjs"))
    ).toBe(true);
    expect(
      existsSync(path.join(root, "scripts/threshold-ratchet-families.mjs"))
    ).toBe(true);
    expect(checked.status, checked.stderr + checked.stdout).toBe(0);
    expect(checked.stdout).toContain("threshold-monotonicity");
    expect(checked.stdout).toContain("PASSED");
  });

  it("refuses a selected gate without a runnable pull-request declaration", async () => {
    const root = await repository();
    const checked = run(root, [
      RUNNER,
      `--moment=${MOMENT}`,
      STANDALONE,
      "--gate=threshold-monotonicity",
    ]);

    expect(checked.status).not.toBe(0);
    expect(checked.stderr).toContain("has no runnable declaration");
    expect(checked.stdout).not.toContain(API_MARKER);
  });
});
