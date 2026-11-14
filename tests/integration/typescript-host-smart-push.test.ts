/**
 * The smart push gate in a TypeScript host built from this branch's
 * templates (CodySwannGT/lisa#4611).
 *
 * The host (see `typescript-host-fixture.ts`) declares its push gates the way
 * `lisa apply` seeds them and says nothing about `pushGate`, so every
 * behaviour here comes from the TypeScript stack defaults. Only the opt-out
 * case writes a `pushGate` block.
 *
 * Each push runs `scripts/lisa-run-gates.mjs --moment=push --coverage=<file>`,
 * the exact command the host's `.husky/pre-push` hands its gates to. The
 * hook's other built-in steps (lint, typecheck, audit, work-item validation)
 * are unchanged by this leaf, and a fixture host has no tools for them.
 *
 * The access map is recorded locally the way CI records it: one full unit run
 * with `LISA_ACCESS_MAP=1`, placed where the push gate's download would put
 * it. That is the only stand-in for CI.
 * @module tests/integration/typescript-host-smart-push
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";
import {
  RECORDED_MAP,
  REPO_ROOT,
  commit,
  edited,
  push,
  removeHosts,
  testFileSummaries,
  typescriptHost,
  unitSuite,
} from "./typescript-host-fixture.js";

const CASE_BUDGET_MS = ioLatencyBudgetMs(240_000);
const ALPHA = "src/alpha.ts";
const ONE_FILE = /^Test Files\s+1 passed \(1\)/u;
const BOTH_FILES = /^Test Files\s+2 passed \(2\)/u;
const SELECTOR = "🎯 affected tests";
const CACHED = "CACHED PASS";

beforeAll(() => {
  expect(
    fs.existsSync(path.join(REPO_ROOT, "dist", "cli", "lisa-test-run.js")),
    "this suite needs the built CLI (bun run build)"
  ).toBe(true);
});

afterAll(removeHosts);

describe("a TypeScript host's smart push gate", () => {
  it(
    "records a map in CI shape, then runs only the tests a one-module change reaches",
    async () => {
      const cwd = await typescriptHost();
      const map = JSON.parse(
        fs.readFileSync(
          path.join(cwd, ".lisa/test-access-map/map.json"),
          "utf8"
        )
      ) as Record<string, string[]>;
      expect(map["tests/alpha.test.ts"]).toContain(ALPHA);
      expect(map["tests/alpha.test.ts"]).not.toContain("src/beta.ts");

      commit(cwd, { [ALPHA]: edited("alpha", 1) });
      const result = push(cwd);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain(
        `${SELECTOR}: running 1 test file(s) the change can reach`
      );
      expect(result.output).toContain(`tests/alpha.test.ts  (map: ${ALPHA})`);
      expect(result.output).not.toContain("tests/beta.test.ts  (map:");
      expect(result.output).toContain(
        "each changed source file must meet vitest.thresholds.json on its own"
      );
      expect(result.output).toContain(
        "✅ affected tests: 1 changed source file(s) meet the coverage floor"
      );
      expect(testFileSummaries(result.output)).toEqual([
        expect.stringMatching(ONE_FILE),
      ]);
    },
    CASE_BUDGET_MS
  );

  it(
    "re-pushes an unchanged tree from the pass cache",
    async () => {
      // Only a full run is remembered: a narrowed run proves the selection,
      // not the tree (#4594, #4600). A host with no map yet runs in full.
      const cwd = await typescriptHost({ map: false });
      commit(cwd, { "src/beta.ts": edited("beta", 2) });
      const first = push(cwd);
      expect(first.status, first.output).toBe(0);
      expect(first.output).not.toContain(CACHED);

      const again = push(cwd);
      expect(again.status, again.output).toBe(0);
      const lines = again.output.split("\n");
      for (const gate of ["coverage-adequacy", "test-correctness"]) {
        expect(
          lines.find(line => line.includes(`required ${gate} `)),
          again.output
        ).toContain(CACHED);
      }
      expect(again.output).not.toContain(SELECTOR);
      expect(testFileSummaries(again.output)).toEqual([]);
    },
    CASE_BUDGET_MS
  );

  it.each([
    ["vitest.config.ts", "the Vitest configuration changed (vitest.config.ts)"],
    [
      "package.json",
      "package.json changed (dependencies or scripts) (package.json)",
    ],
  ])(
    "runs the full suite and names the trigger when %s changes",
    async (file, reason) => {
      const cwd = await typescriptHost();
      const body = fs.readFileSync(path.join(cwd, file), "utf8");
      const changed =
        file === "package.json"
          ? `${JSON.stringify({ ...JSON.parse(body), description: "changed" }, null, 2)}\n`
          : `${body}// changed\n`;
      commit(cwd, { [file]: changed });
      const result = push(cwd);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain(
        `${SELECTOR}: Running the full suite: ${reason}`
      );
      expect(testFileSummaries(result.output)).toEqual([
        expect.stringMatching(BOTH_FILES),
      ]);
    },
    CASE_BUDGET_MS
  );

  it(
    "pushes with the full suite and a plain reason when there is no map yet",
    async () => {
      const cwd = await typescriptHost({ map: false });
      commit(cwd, { [ALPHA]: edited("alpha", 1) });
      const result = push(cwd);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain(
        `${SELECTOR}: Running the full suite: missing map: no test access map is available for this branch's base`
      );
      expect(testFileSummaries(result.output)).toEqual([
        expect.stringMatching(BOTH_FILES),
      ]);
    },
    CASE_BUDGET_MS
  );

  it(
    "holds its heavy test run for headroom instead of starting it",
    async () => {
      const cwd = await typescriptHost();
      commit(cwd, { [ALPHA]: edited("alpha", 1) });
      const result = push(cwd, {
        LISA_ADMISSION_FAKE_MACHINE: JSON.stringify({
          cores: 4,
          load1: 64,
          freeMemoryMb: 8192,
        }),
        LISA_ADMISSION_PUSH_MAX_WAIT: "2s",
      });
      expect(result.output).toContain("lisa admission: waiting for headroom");
      // Refused once the wait ran out, so the suite never started and the
      // push is blocked rather than passed unproved.
      expect(testFileSummaries(result.output)).toEqual([]);
      expect(result.status).toBe(1);
    },
    CASE_BUDGET_MS
  );

  it(
    "never narrows in CI, so CI still runs every test",
    async () => {
      const cwd = await typescriptHost();
      commit(cwd, { [ALPHA]: edited("alpha", 1) });
      const result = push(cwd, { CI: "true" });
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain(
        `${SELECTOR}: Running the full suite: this is a CI run, and CI always runs every test`
      );
      expect(testFileSummaries(result.output)).toEqual([
        expect.stringMatching(BOTH_FILES),
      ]);
    },
    CASE_BUDGET_MS
  );

  it(
    "runs the full suite, silently, for a host that sets affectedTests to false",
    async () => {
      const cwd = await typescriptHost({
        pushGate: { affectedTests: false },
        map: false,
      });
      // Its CI would record nothing either: the recorder follows the switch.
      const recording = unitSuite(cwd, { LISA_ACCESS_MAP: "1" });
      expect(recording.status, recording.output).toBe(0);
      expect(fs.existsSync(path.join(cwd, path.dirname(RECORDED_MAP)))).toBe(
        false
      );

      commit(cwd, { [ALPHA]: edited("alpha", 1) });
      const result = push(cwd);
      expect(result.status, result.output).toBe(0);
      expect(result.output).not.toContain(SELECTOR);
      expect(testFileSummaries(result.output)).toEqual([
        expect.stringMatching(BOTH_FILES),
      ]);
    },
    CASE_BUDGET_MS
  );
});
