/**
 * The public `lisa-test-run` CLI applies the shard plan quality.yml sets (#4479).
 *
 * Black-box through the real entrypoint and the real Jest. The unit suite pins
 * the argv and receipt functions; this pins that the CLI actually calls them,
 * in order, and hides the plan from the payload it starts.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { stripVTControlCharacters } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { REPO_ROOT, TEST_RUN_ENTRY } from "../helpers/lisa-test-run-process.js";

const JEST_BIN = path.join(REPO_ROOT, "node_modules", "jest", "bin", "jest.js");
// Measured 2026-10-21 on a quiet box (`ps aux | grep -c '[v]itest'` = 0):
// the slowest case ran 8.1s with real Jest/Vitest children of at most
// ~4s each, so 25s keeps a 3x margin at base and the children's 8s base
// inside the 2.5x bound.
useIoLatencyBudget(25_000);

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * Build a Jest project whose two tests each cover one of three files, and
 * which records the shard variables each test process could see.
 * @returns Fixture root
 */
function project(): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-shard-cli-"));
  directories.push(root);
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"commonjs"}\n');
  for (const name of ["a", "b", "c"])
    fs.writeFileSync(
      path.join(root, "src", `${name}.js`),
      `exports.${name} = x => (x > 0 ? 1 : 2);\n`
    );
  for (const name of ["a", "b"])
    fs.writeFileSync(
      path.join(root, "test", `${name}.test.js`),
      [
        `const fs = require("node:fs");`,
        `fs.writeFileSync(${JSON.stringify(path.join(root, `seen-${name}`))}, String(process.env.LISA_TEST_SHARD ?? "unset"));`,
        `test("${name}", () => expect(require("../src/${name}.js").${name}(1)).toBe(1));`,
      ].join("\n")
    );
  fs.writeFileSync(
    path.join(root, "jest.config.js"),
    `module.exports = ${JSON.stringify({
      rootDir: root,
      collectCoverageFrom: ["src/**/*.js"],
      coverageReporters: ["json-summary"],
      coverageThreshold: { global: { lines: 60 } },
    })};\n`
  );
  return root;
}

/**
 * Run the public CLI from the project directory, as a gate task does.
 *
 * From the project, not from Lisa: Jest's instrumenter skips every file
 * outside the working directory, so a run from anywhere else measures nothing.
 * The temp root is the fixture's own, so the tsx cache stays inside it.
 * @param root - Fixture root
 * @param payload - Payload argv after `--`
 * @param env - Shard variables
 * @returns Process outcome
 */
function cli(
  root: string,
  payload: readonly string[],
  env: Record<string, string>
) {
  const temp = path.join(root, "tmp");
  fs.mkdirSync(temp, { recursive: true });
  return boundedSpawnSync({
    label: "lisa-test-run shard cli",
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
      ...payload,
    ],
    baseMs: 8_000,
    cwd: root,
    env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp, ...env },
  });
}

/**
 * The gate task's own Jest command for the fixture.
 * @param root - Fixture root
 * @returns Payload argv
 */
const jest = (root: string): string[] => [
  process.execPath,
  JEST_BIN,
  "--config",
  path.join(root, "jest.config.js"),
  `--cacheDirectory=${path.join(root, ".jest-cache")}`,
  "--coverage",
];

describe("lisa-test-run under a shard plan", () => {
  it("refuses to shard a command it does not know, before running it", () => {
    const root = project();
    const output = path.join(root, "out");
    const marker = path.join(root, "ran");

    const result = cli(
      root,
      [
        process.execPath,
        "-e",
        `require("fs").writeFileSync(${JSON.stringify(marker)}, "")`,
      ],
      { LISA_TEST_SHARD: "1/2", LISA_TEST_SHARD_OUTPUT: output }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot shard");
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(output)).toBe(false);
  });

  it("runs each Jest shard on its slice, then merges and holds the floor", () => {
    const root = project();
    const merge = path.join(root, "downloaded");
    for (const index of [1, 2]) {
      const output = path.join(merge, `unit-test-shard-n-${index}`);
      const result = cli(root, jest(root), {
        LISA_TEST_SHARD: `${index}/2`,
        LISA_TEST_SHARD_OUTPUT: output,
      });
      // Each shard alone covers 1 of 3 files: under the project floor of 60%,
      // which it must not be held to.
      expect(result.status, result.stderr).toBe(0);
      expect(fs.existsSync(path.join(output, "lisa-shard-receipt.json"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(output, "coverage", "coverage-final.json"))
      ).toBe(true);
    }
    // Two shards over two test files: each file ran exactly once, and no test
    // process could see the plan that would make a nested run shard itself.
    expect(fs.readFileSync(path.join(root, "seen-a"), "utf8")).toBe("unset");
    expect(fs.readFileSync(path.join(root, "seen-b"), "utf8")).toBe("unset");

    const merged = cli(root, jest(root), {
      LISA_TEST_SHARD_MERGE: merge,
      LISA_TEST_SHARD_TOTAL: "2",
    });

    // Merged, 2 of 3 files are covered (66.66%), which holds the 60% floor
    // that each shard alone (33.33%) would have failed.
    expect(merged.status, merged.stderr).toBe(0);
    expect(merged.stderr).not.toContain("coverage threshold");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(root, "coverage", "coverage-summary.json"),
          "utf8"
        )
      ).total.lines.pct
    ).toBe(66.66);
  });

  it("runs each Vitest shard as a blob, then merges the blobs without re-running", () => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-shard-vitest-"));
    directories.push(root);
    for (const name of ["a", "b"])
      fs.writeFileSync(
        path.join(root, `${name}.test.mjs`),
        `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(path.join(root, "ran"))}, "${name}");\ntest("${name}", () => expect(1).toBe(1));\n`
      );
    const vitest = [
      process.execPath,
      path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "--globals",
      "--root",
      root,
    ];
    const merge = path.join(root, "downloaded");
    for (const index of [1, 2]) {
      const result = cli(root, vitest, {
        LISA_TEST_SHARD: `${index}/2`,
        LISA_TEST_SHARD_OUTPUT: path.join(merge, `unit-test-shard-n-${index}`),
      });
      expect(result.status, result.stderr).toBe(0);
    }
    expect(
      [...fs.readFileSync(path.join(root, "ran"), "utf8")]
        .sort((left, right) => left.localeCompare(right))
        .join("")
    ).toBe("ab");

    const merged = cli(root, vitest, {
      LISA_TEST_SHARD_MERGE: merge,
      LISA_TEST_SHARD_TOTAL: "2",
    });

    expect(merged.status, merged.stderr).toBe(0);
    // CI forces colour, so read the summary without its escape codes.
    expect(stripVTControlCharacters(merged.stdout)).toMatch(/Tests\s+2 passed/);
    // Merging reads the blobs; it does not run either test file again.
    expect(fs.readFileSync(path.join(root, "ran"), "utf8")).toHaveLength(2);
  });

  it("refuses a merge that is missing a shard", () => {
    const root = project();
    const merge = path.join(root, "downloaded");
    const output = path.join(merge, "unit-test-shard-n-1");
    expect(
      cli(root, jest(root), {
        LISA_TEST_SHARD: "1/2",
        LISA_TEST_SHARD_OUTPUT: output,
      }).status
    ).toBe(0);

    const merged = cli(root, jest(root), {
      LISA_TEST_SHARD_MERGE: merge,
      LISA_TEST_SHARD_TOTAL: "2",
    });

    expect(merged.status).toBe(1);
    expect(merged.stderr).toContain("missing shard 2");
  });
});
