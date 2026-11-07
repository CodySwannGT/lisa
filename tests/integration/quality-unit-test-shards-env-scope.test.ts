/**
 * The unit-test shard variables reach the test command and nothing else
 * (CodySwannGT/lisa#4479).
 *
 * `lisa-test-run` turns into a shard leg or the merge whenever it sees these
 * variables. Lisa's own suite runs further `lisa-test-run` steps after the gate
 * (the Node 24, Rails hook installation, nightly discovery, required-check registration, host-name
 * target-scope and completion authorization regression cases). A variable visible there could make those
 * steps replay shard reports and pass without running their tests. A `$GITHUB_ENV` write is visible to every later step in the job, so
 * the arm steps must hand their values over as step outputs, and only the
 * steps listed here may bind them.
 * Split from `quality-unit-test-shards.test.ts` for the file-length cap.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { jobIn, stepsIn } from "./quality-gate-facade-fixture.js";
import { executeStep } from "./quality-unit-test-shards-fixture.js";
import type { WorkflowJob } from "../helpers/workflow-test-utils.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const SHARD_VARIABLES = [
  "LISA_TEST_SHARD",
  "LISA_TEST_SHARD_OUTPUT",
  "LISA_TEST_SHARD_MERGE",
  "LISA_TEST_SHARD_TOTAL",
] as const;

/** Each step that may see the variables, and the ones it sees. */
const READERS: Readonly<Record<string, readonly string[]>> = {
  gate_run: SHARD_VARIABLES,
  test_coverage: SHARD_VARIABLES,
  "🧾 Prove this shard ran only its slice": ["LISA_TEST_SHARD_OUTPUT"],
};

const OUTPUT_OF: Readonly<Record<string, string>> = {
  LISA_TEST_SHARD: "shard",
  LISA_TEST_SHARD_OUTPUT: "output",
  LISA_TEST_SHARD_MERGE: "merge",
  LISA_TEST_SHARD_TOTAL: "total",
};

const ARMS = {
  test_unit: {
    name: "🧩 Arm the unit-test shard merge",
    env: { TOTAL: "4" },
    output: (temp: string) => `merge=${temp}/lisa-unit-test-shards\ntotal=4\n`,
  },
  test_unit_shard: {
    name: "🧩 Arm this unit-test shard",
    env: { SHARD: "3", TOTAL: "4" },
    output: (temp: string) =>
      `shard=3/4\noutput=${temp}/lisa-unit-test-shard\n`,
  },
} as const;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe.each(Object.keys(ARMS) as (keyof typeof ARMS)[])(
  "%s shard variable scope",
  job => {
    const arm = ARMS[job];
    const steps = stepsIn(job);

    it("hands the values over as step outputs, never through GITHUB_ENV", () => {
      const step = steps.find(s => s.name === arm.name);
      expect(step?.id).toBe("shard_arm");
      const armed = executeStep(step?.run, arm.env, root => roots.push(root));
      expect(armed.status, armed.stdout).toBe(0);
      expect(armed.env).toBe("");
      expect(armed.output).toBe(arm.output(armed.runnerTemp));
    });

    it("sets none of them at job level", () => {
      const { env } = jobIn(job) as WorkflowJob & {
        env?: Record<string, unknown>;
      };
      expect(Object.keys(env ?? {})).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^LISA_TEST_SHARD/u)])
      );
    });

    it("binds them only on the test command and the shard proof", () => {
      for (const step of steps) {
        const key = step.id ?? step.name ?? "";
        const bound = Object.keys(step.env ?? {}).filter(name =>
          name.startsWith("LISA_TEST_SHARD")
        );
        const allowed = READERS[key] ?? READERS[step.name ?? ""] ?? [];
        expect(bound, key).toEqual(
          allowed.filter(name => bound.includes(name))
        );
        for (const name of bound)
          expect(step.env?.[name], `${key} ${name}`).toBe(
            `\${{ steps.shard_arm.outputs.${OUTPUT_OF[name]} }}`
          );
      }
      for (const id of ["gate_run", "test_coverage"]) {
        const step = steps.find(s => s.id === id);
        expect(Object.keys(step?.env ?? {}), id).toEqual(
          expect.arrayContaining([...SHARD_VARIABLES])
        );
      }
    });

    it("keeps them away from Lisa's own regression specs", () => {
      const regression = steps.filter(s =>
        (s.name ?? "").startsWith("Execute and name")
      );
      if (job === "test_unit")
        expect(regression.map(step => step.name)).toEqual([
          "Execute and name Node 24 regression specs",
          "Execute and name Rails hook installation regression specs",
          "Execute and name nightly discovery regression specs",
          "Execute and name required-check registration regression specs",
          "Execute and name host-name target-scope regression cases",
          "Execute and name completion authorization regression specs",
          AUDIT_STEP,
        ]);
      for (const step of regression)
        expect(JSON.stringify(step), step.name).not.toContain(
          "LISA_TEST_SHARD"
        );
    });

    it("names only spec files that exist, so no step can pass having run none", () => {
      // vitest fails when NONE of the listed files is found, but runs the rest
      // and passes when only SOME are missing. A rename would then silently
      // drop a spec from the hosted log, so every listed path must exist.
      const regression = steps.filter(s =>
        (s.name ?? "").startsWith("Execute and name")
      );
      for (const step of regression) {
        const specs = (step.run ?? "").match(/tests\/\S+\.test\.ts/gu) ?? [];
        expect(specs.length, step.name).toBeGreaterThan(0);
        for (const spec of specs)
          expect(fs.existsSync(spec), `${step.name}: ${spec}`).toBe(true);
      }
    });

    it("names every dependency-audit scope spec in the hosted log (#4521)", () => {
      const step = steps.find(s => s.name === AUDIT_STEP);
      if (job !== "test_unit") {
        expect(step).toBeUndefined();
        return;
      }
      expect(step?.run).toContain("--reporter=verbose");
      // Pinned exactly: dropping a spec from the hosted log is a decision, not
      // a side effect of editing the list.
      expect(step?.run?.match(/tests\/\S+\.test\.ts/gu)).toEqual(AUDIT_SPECS);
    });

    it("fails the audit spec step on any skip except the bun-only fail-closed cases (#4521)", () => {
      const step = steps.find(s => s.name === AUDIT_STEP);
      if (job !== "test_unit") return;
      // The step's own guard, run against controlled verbose transcripts.
      const guard = /if grep[\s\S]*?\n {0,2}fi/u.exec(step?.run ?? "")?.[0];
      const verdict = (transcript: string) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-audit-skip-"));
        const log = path.join(dir, "specs.log");
        roots.push(dir);
        fs.writeFileSync(log, transcript);
        return boundedSpawnSync({
          label: "dependency-audit skip guard",
          command: "bash",
          args: ["-c", `AUDIT_SPEC_LOG="${log}"\n${guard ?? "exit 98"}`],
        }).status;
      };
      const pass =
        " ✓ |lisa| tests/integration/audit-consumer-parity.test.ts > covered\n";
      const allowed =
        " ↓ |lisa| tests/integration/quality-audit-fail-closed.test.ts > the npm built-in audit fails closed > fails when bun prints a registry error body as JSON\n";
      const skipped =
        " ↓ |lisa| tests/integration/audit-consumer-parity.test.ts > covered\n";
      expect(guard).toBeDefined();
      expect(verdict(pass + allowed)).toBe(0);
      expect(verdict(pass + skipped)).toBe(1);
    });
  }
);

/** The hosted step that names the dependency-audit scope specs. */
const AUDIT_STEP = "Execute and name dependency-audit scope regression specs";

/** Every spec the hosted dependency-audit step must name, in order. */
const AUDIT_SPECS = [
  "tests/unit/core/audit-scopes.test.ts",
  "tests/unit/core/audit-scope-hardening.test.ts",
  "tests/unit/core/audit-lockfile-sources.test.ts",
  "tests/unit/core/audit-lockfile-formats.test.ts",
  "tests/unit/core/audit-report-completeness.test.ts",
  "tests/unit/config/zod-security-floor.test.ts",
  "tests/unit/config/audit-ignore-package-names.test.ts",
  "tests/unit/cli/doctor-readiness-supply-chain-exceptions.test.ts",
  "tests/unit/cli/doctor-audit-scope.test.ts",
  "tests/unit/hooks/pre-push-audit-transport-parity.test.ts",
  "tests/unit/strategies/security-audit-handling-scope.test.ts",
  "tests/unit/strategies/package-lisa-audit-script-governance.test.ts",
  "tests/integration/audit-consumer-parity.test.ts",
  "tests/integration/audit-workflow-action.test.ts",
  "tests/integration/quality-audit-fail-closed.test.ts",
];
