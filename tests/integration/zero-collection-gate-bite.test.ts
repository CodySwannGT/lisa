/**
 * Bite test: a consumer's gate that collects zero tests must not report PASSED.
 *
 * Proved from a fixture CONSUMER rather than from this repository, because this
 * repository is the safe case by construction: `--passWithNoTests` was removed
 * from its unit lane under #2603 and its own integration script never carried
 * it, so a check verified from here would measure a shape the defect cannot
 * take. The flag still ships in the integration scripts of the stack templates,
 * and that is the shape a consumer runs (CodySwannGT/lisa#3715).
 *
 * Everything here is real: a real `vitest` invoked with the flag, through a
 * real `package.json` script, driven by the real runner as a real child
 * process. A stubbed executor cannot prove this, because the fact under test is
 * what the tool PRINTS on the success path — and that is exactly what the
 * runner used to throw away on `code === 0`.
 *
 * ## Why vitest only, when the table also carries a jest row
 *
 * The jest cases lived here and were REMOVED after measuring them: a second
 * framework starting up in a real subprocess exceeded the bounded-child budget
 * twice at ~10.3s and ~12.9s when this file ran alongside one other, and CI's
 * integration lane runs many. The bound is doing its job; the case was simply
 * too expensive to keep honest. jest's row is proved at the unit boundary
 * instead, against a transcript captured from a real `jest --passWithNoTests`
 * run — measured, not composed. Anyone restoring a live jest case here should
 * re-measure it under concurrency first, because passing once alone is what
 * this note exists to stop being mistaken for evidence.
 * @module tests/integration/zero-collection-gate-bite
 */

import type { SpawnSyncReturns } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SCRIPT = path.join(
  HERE,
  "../../all/copy-overwrite/scripts/lisa-run-gates.mjs"
);

/** Real tools for the fixture consumer, borrowed rather than reinstalled. */
const NODE_MODULES = path.join(HERE, "../../node_modules");

/** The gate the stack templates ship `--passWithNoTests` on. */
const INTEGRATION = "test-integration";

/** The runner's headline for a required gate nothing measured. */
const NOT_PROVED = `required gate NOT PROVED: ${INTEGRATION}`;

/** The runner's headline for a required gate it measured and found wanting. */
const GATE_FAILED = "required gate FAILED";

/**
 * A push moment where one gate runs the consumer's integration script.
 *
 * The other floor properties are declared `off` rather than omitted: silence
 * hands the moment back to the built-in hook steps, which would prove nothing
 * about the report under test.
 */
const CONFIG = JSON.stringify({
  gates: {
    "coverage-adequacy": { push: "off" },
    "dependency-vulnerability": { push: "off" },
    runner: "npm run",
    "test-correctness": { push: "off" },
    [INTEGRATION]: { push: { level: "required", run: "test:integration" } },
    traceability: { push: "off" },
    "type-correctness": { push: "off" },
  },
});

/** One real integration test, for the control run. */
const REAL_TEST =
  'import { expect, it } from "vitest";\n' +
  'it("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n';

/**
 * The consumer's `test:integration` script — the shipped shape, flag and all.
 *
 * The stack templates declare both a vitest integration script and a jest one,
 * and `--passWithNoTests` is on each; this is the vitest form. See the module
 * note above for why the jest form is exercised at the unit boundary instead.
 */
const SCRIPT_UNDER_TEST =
  "./node_modules/.bin/vitest run tests/integration --passWithNoTests";

/**
 * Run the real gate runner in a throwaway consumer project.
 * @param tests Test files to place, keyed by path relative to the root. Empty
 *   for the bite case — that absence IS the condition under test.
 * @returns The finished child process.
 */
function runConsumer(
  tests: Record<string, string> = {}
): SpawnSyncReturns<string> {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-zero-collection-"));
  try {
    writeFileSync(path.join(root, ".lisa.config.json"), CONFIG);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "consumer",
        private: true,
        scripts: { "test:integration": SCRIPT_UNDER_TEST },
        type: "module",
      })
    );
    symlinkSync(NODE_MODULES, path.join(root, "node_modules"), "dir");
    mkdirSync(path.join(root, "tests/integration"), { recursive: true });
    for (const [relative, contents] of Object.entries(tests)) {
      writeFileSync(path.join(root, relative), contents);
    }
    // `baseMs` is left at the default deliberately: each child measured
    // 0.9-2.1s here, so raising it would buy nothing and would push the child's
    // worst case past the per-case budget that is supposed to outlive it —
    // which the test-budget conformance guard refuses, correctly.
    return boundedSpawnSync({
      args: [SCRIPT, "--moment=push"],
      command: process.execPath,
      cwd: root,
      label: "lisa-run-gates.mjs --moment=push",
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe("bite: a consumer gate that collects nothing does not pass", () => {
  it("records NOT PROVED when vitest exits 0 having found no test files", () => {
    // The defect. Before the fix this printed a pass and the push proceeded,
    // with the transcript's own `No test files found` sitting in the operator's
    // scrollback as though it were information rather than a failure.
    const child = runConsumer();

    expect(child.stdout).toContain(NOT_PROVED);
    expect(child.stdout).toContain("ZERO test");
    expect(child.status).not.toBe(0);
  });

  it("passes the same gate when the suite is actually there", () => {
    // The negative control, and the one that keeps the fix from being "always
    // fail". Same fixture, same flag, same command — one file different.
    const child = runConsumer({
      "tests/integration/real.test.ts": REAL_TEST,
    });

    expect(child.stdout).not.toContain(NOT_PROVED);
    expect(child.stdout).not.toContain(GATE_FAILED);
    expect(child.status).toBe(0);
  });

  it("names the tree the empty run used, so a wrong root is visible", () => {
    // Direction 3 of the issue. Asserted here rather than only at the unit
    // boundary because the first version of this read the tool's header alone,
    // and CI is where that turned out to be absent — the unit fixture carried a
    // header, so only a real run could disprove it.
    expect(runConsumer().stdout).toContain("the run's root was");
  });
});

describe("the fixture is the shape a consumer really runs", () => {
  it("keeps `--passWithNoTests` in the shipped integration scripts", () => {
    // Read from the template rather than asserted from memory. If the flag is
    // ever removed upstream, this says so — and the cases above stop being a
    // consumer's shape, which is a fact the next reader needs.
    const template = readFileSync(
      path.join(HERE, "../../typescript/package-lisa/package.lisa.json"),
      "utf-8"
    );

    expect(template).toContain("--passWithNoTests");
  });
});
