/**
 * The public `lisa-test-run` CLI applies a file-list shard plan (#4599).
 *
 * Black-box through the real entrypoint and the real Vitest, on a fixture with
 * two projects like Lisa's own: a bulk project and one whose global setup
 * stands in for the history-scanner download. The plan keeps that project's
 * files in one leg, so its global setup runs once across the legs; Vitest's
 * own `--shard`, the control, runs it in every leg.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { REPO_ROOT, TEST_RUN_ENTRY } from "../helpers/lisa-test-run-process.js";

// Each leg starts two Vitest processes (the list, then the run) of about 1.5s
// each on a quiet box; four legs plus the control fit a 3x margin at 40s.
useIoLatencyBudget(40_000);

const VITEST = path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * A Vitest project whose `scanner` project has a global setup that records
 * each time it runs, and whose test files record that they ran.
 * @returns Fixture root
 */
function project(): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-shard-files-cli-"));
  const ran = JSON.stringify(path.join(root, "ran"));
  directories.push(root);
  for (const name of ["a", "b", "c", "s1", "s2"])
    fs.writeFileSync(
      path.join(root, `${name}.test.mjs`),
      `import { appendFileSync } from "node:fs";\nappendFileSync(${ran}, "${name} ");\ntest("${name}", () => expect(1).toBe(1));\n`
    );
  fs.writeFileSync(
    path.join(root, "setup.mjs"),
    `import { appendFileSync } from "node:fs";\nexport default () => { appendFileSync(${JSON.stringify(path.join(root, "setups"))}, "x"); };\n`
  );
  fs.writeFileSync(
    path.join(root, "vitest.config.mjs"),
    `export default ${JSON.stringify({
      test: {
        globals: true,
        projects: [
          {
            test: {
              name: "bulk",
              globals: true,
              include: ["a.test.mjs", "b.test.mjs", "c.test.mjs"],
            },
          },
          {
            test: {
              name: "scanner",
              globals: true,
              include: ["s*.test.mjs"],
              globalSetup: ["./setup.mjs"],
            },
          },
        ],
      },
    })};\n`
  );
  return root;
}

/**
 * Run one leg through the public CLI from the project directory.
 * @param root - Fixture root
 * @param env - Shard variables
 * @returns Process outcome
 */
function leg(root: string, env: Record<string, string>) {
  const temp = path.join(root, "tmp");
  fs.mkdirSync(temp, { recursive: true });
  return boundedSpawnSync({
    label: "lisa-test-run file-list shard cli",
    command: process.execPath,
    args: [
      "--import",
      import.meta.resolve("tsx"),
      TEST_RUN_ENTRY,
      "--profile",
      "lisa",
      "--adapter",
      "direct",
      "--",
      process.execPath,
      VITEST,
      "run",
    ],
    baseMs: 12_000,
    cwd: root,
    env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp, ...env },
  });
}

/**
 * The files that ran, sorted.
 * @param root - Fixture root
 * @returns File names
 */
const ranFiles = (root: string): string[] =>
  fs
    .readFileSync(path.join(root, "ran"), "utf8")
    .trim()
    .split(/\s+/)
    .sort((left, right) => left.localeCompare(right));

/**
 * How many times the scanner project's global setup ran.
 * @param root - Fixture root
 * @returns Count
 */
const setups = (root: string): number =>
  fs.existsSync(path.join(root, "setups"))
    ? fs.readFileSync(path.join(root, "setups"), "utf8").length
    : 0;

describe("lisa-test-run under a file-list shard plan", () => {
  it("runs every selected file once and the grouped global setup once", () => {
    const root = project();
    const plan = path.join(root, "plan.json");
    fs.writeFileSync(
      plan,
      JSON.stringify({
        schema: "lisa.test-shard-plan/v1",
        total: 2,
        assignments: { "a.test.mjs": 1, "b.test.mjs": 2 },
        seconds: [10, 5],
        defaultSeconds: 1,
        groups: [{ files: ["s1.test.mjs", "s2.test.mjs"], shard: 2 }],
      })
    );

    const outputs = [1, 2].map(index => {
      const output = path.join(root, `out-${index}`);
      const result = leg(root, {
        LISA_TEST_SHARD: `${index}/2`,
        LISA_TEST_SHARD_OUTPUT: output,
        LISA_TEST_SHARD_PLAN: plan,
      });
      expect(result.status, result.stderr).toBe(0);
      return { output, stderr: result.stderr };
    });

    // c was never timed: it joins the least-loaded leg, 2 (5 s against 10 s).
    expect(outputs[0]?.stderr).toContain(
      "shard 1/2 runs 1 of 5 selected files by the timing plan"
    );
    expect(outputs[1]?.stderr).toContain(
      "shard 2/2 runs 4 of 5 selected files by the timing plan"
    );
    expect(ranFiles(root)).toEqual(["a", "b", "c", "s1", "s2"]);
    expect(setups(root)).toBe(1);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(outputs[0]?.output ?? "", "lisa-shard-receipt.json"),
          "utf8"
        )
      )
    ).toMatchObject({ mode: "files", files: { mine: 1, selected: 5 } });
  });

  it("control: Vitest's own --shard runs the grouped global setup in every leg", () => {
    const root = project();
    for (const index of [1, 2]) {
      const result = leg(root, {
        LISA_TEST_SHARD: `${index}/2`,
        LISA_TEST_SHARD_OUTPUT: path.join(root, `out-${index}`),
      });
      expect(result.status, result.stderr).toBe(0);
    }

    expect(ranFiles(root)).toEqual(["a", "b", "c", "s1", "s2"]);
    expect(setups(root)).toBe(2);
  });
});
