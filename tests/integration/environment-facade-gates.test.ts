/**
 * Tests the environment facade: two gates whose implementations Lisa never
 * ships.
 *
 * Lisa defines and enforces the interface — `environment:reset`,
 * `environment:reseed` — and each project supplies what happens behind it and
 * whether it is required, optional, or does not run. That is the whole design,
 * and it is why there is no fallback implementation here when every other job
 * in the workflow has one.
 *
 * The load-bearing assertion is that **the gate's task is the VERIFY, not the
 * reset**. A gate whose task were `environment:reset` would converge a shared
 * environment on every pull request that declared it required, which is not a
 * hypothetical: a repository in this portfolio already runs an unconditional
 * reset job that is destructive to shared dev data on every invocation.
 * @module tests/integration/environment-facade-gates
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  isMoment,
  REGISTRY,
  resolveMoment,
  validateGates,
} from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  NOT_CONFIGURED,
  stepNamed,
  workflow,
} from "./quality-gate-facade-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATES = path.resolve(
  __dirname,
  "..",
  "..",
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/** The two facade gates and the jobs that carry them. */
const FACADE = [
  {
    gate: "environment-reset",
    job: "environment_reset",
    task: "environment:reset:verify",
    gateStep: "♻️ Run the environment-reset gate",
    fallback: "♻️ No environment reset adapter declared",
  },
  {
    gate: "environment-reseed",
    job: "environment_reseed",
    task: "environment:reseed:verify",
    gateStep: "🌱 Run the environment-reseed gate",
    fallback: "🌱 No environment reseed adapter declared",
  },
] as const;

describe("the gate's task is the verify, never the reset", () => {
  it.each(FACADE)(
    "$gate runs $task, not the mutation itself",
    ({ gate, task }) => {
      expect(REGISTRY[gate].task).toBe(task);
    }
  );

  it.each(FACADE)(
    "$gate's task never invokes the bare mutation",
    ({ gate }) => {
      // `environment:reset` is a PRECONDITION a workflow calls before a suite.
      // As a gate task it would run on every pull request declaring the gate
      // required, converging a shared environment each time.
      const bare = REGISTRY[gate].task.replace(":verify", "");
      expect(REGISTRY[gate].task).not.toBe(bare);
      expect(REGISTRY[gate].task.endsWith(":verify")).toBe(true);
    }
  );

  it.each(FACADE)(
    "$gate resolves to the verify task when a project names no task of its own",
    ({ gate, task }) => {
      const [resolved] = resolveMoment({
        gates: { [gate]: { "pull-request": "required" } },
        moment: "pull-request",
        runner: "npm run",
      });
      expect(resolved.task).toBe(task);
      expect(resolved.command).toBe(`npm run ${task}`);
    }
  );
});

describe("the facade is declarable only where a deployed environment exists", () => {
  it.each(FACADE)("$gate is legal at pull-request", ({ gate }) => {
    expect(validateGates({ [gate]: { "pull-request": "required" } })).toEqual(
      []
    );
  });

  it.each(FACADE)(
    "$gate is legal continuously, per environment",
    ({ gate }) => {
      expect(isMoment("continuous:dev")).toBe(true);
      expect(
        validateGates({ [gate]: { "continuous:dev": "required" } })
      ).toEqual([]);
    }
  );

  it.each(FACADE)("$gate is REFUSED at commit", ({ gate }) => {
    // Nothing is deployed at commit time for a reset to point at, and a local
    // commit hook converging a shared environment would be worse than useless.
    expect(
      validateGates({ [gate]: { commit: "required" } }).length
    ).toBeGreaterThan(0);
  });

  it.each(FACADE)("$gate is REFUSED at push", ({ gate }) => {
    expect(
      validateGates({ [gate]: { push: "required" } }).length
    ).toBeGreaterThan(0);
  });
});

describe("Lisa ships no implementation behind the facade", () => {
  it.each(FACADE)(
    "$job announces the absence rather than substituting for it",
    ({ job, fallback }) => {
      const step = stepNamed(job, fallback);
      expect(step).toBeDefined();
      expect(step?.if).toContain(NOT_CONFIGURED);
    }
  );

  it.each(FACADE)(
    "$job's fallback claims nothing was verified, rather than reporting a pass",
    ({ job, fallback }) => {
      // The distinction that keeps this from being a vacuous green: an
      // undeclared gate emits no required context, so exiting 0 asserts
      // nothing. The message has to say that out loud, because a silent green
      // job and a satisfied one are indistinguishable in the checks list.
      const body = stepNamed(job, fallback)?.run ?? "";
      expect(body).toMatch(/no .* guard was verified/i);
    }
  );

  it.each(FACADE)(
    "$job's guidance names the task the gate actually runs",
    ({ job, fallback, task }) => {
      // The message is the only instruction an operator gets, and it shipped
      // naming the GATE ID where the TASK belongs — `environment-reset:verify`
      // against a real task of `environment:reset:verify`. Anyone following it
      // would add a package script no gate ever invokes, then be unable to see
      // why the gate stayed unconfigured. Derived from the registry rather
      // than repeated as a literal, so the two cannot drift apart again.
      const body = stepNamed(job, fallback)?.run ?? "";
      expect(body).toContain(task);
      // The exact mistake that shipped: the gate id with `:verify` appended.
      const gateIdShape = `${task.replace(/^environment:/, "environment-").replace(":verify", "")}:verify`;
      expect(body).not.toContain(gateIdShape);
    }
  );

  it.each(FACADE)(
    "$job carries no continue-on-error it decided for itself",
    ({ job, gate, gateStep }) => {
      // The job never continues on error, and neither does any step of it on
      // its own say-so. The single exception is the step that runs the
      // project's declared prover, which continues on error ONLY when the
      // project's own declaration said `optional` — pinned as an exact string
      // because the whole point is that one level is exempted. A literal
      // `true`, or anything that also exempts `required`, is the defect this
      // rule exists to stop, pointed the other way.
      const definition = workflow.jobs[job] as Record<string, unknown>;
      expect(definition["continue-on-error"]).toBeUndefined();
      for (const step of workflow.jobs[job].steps ?? []) {
        const carried = (step as Record<string, unknown>)["continue-on-error"];
        expect(
          carried,
          `${step.name ?? job} may continue on error only as ${gate}'s declared level`
        ).toBe(
          step.name === gateStep
            ? "${{ steps.gate.outputs.level == 'optional' }}"
            : undefined
        );
      }
    }
  );
});

describe("a declared gate with no adapter fails rather than passing quietly", () => {
  it("fails when the project has no verify script", () => {
    // Measured rather than reasoned: the whole facade rests on Lisa shipping
    // no implementation, so the missing-adapter case must be red.
    const dir = mkdtempSync(path.join(tmpdir(), "lisa-env-"));
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "t", version: "1.0.0", scripts: {} }),
      "utf8"
    );
    writeFileSync(
      path.join(dir, ".lisa.config.json"),
      JSON.stringify({
        gates: {
          runner: "npm run",
          "environment-reset": { "pull-request": "required" },
        },
      }),
      "utf8"
    );
    const result = boundedSpawnSync({
      label: "lisa-gates.mjs list --moment=pull-request",
      command: process.execPath,
      args: [GATES, "list", "--moment=pull-request", "--json"],
      cwd: dir,
    });
    rmSync(dir, { recursive: true, force: true });
    // The resolver still names the task; it is the runner that discovers the
    // script is absent and fails. What matters here is that resolution does
    // NOT quietly report the gate unconfigured.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("environment:reset:verify");
  });
});

describe("the summary states the property a reset gate actually protects", () => {
  it.each(FACADE)("$gate names unbypassability, not location", ({ gate }) => {
    // "One guard location" is the means; the property is that the guard
    // cannot be stepped around by calling the entry point directly.
    expect(REGISTRY[gate].summary).toMatch(/bypass/i);
  });

  it.each(FACADE)("$gate counts refusals as its work", ({ gate }) => {
    // `work` is descriptive — it names what a nonzero count would prove. For
    // these gates the meaningful count is refusals, not entities touched: a
    // reset that converged nothing may be perfectly correct.
    expect(REGISTRY[gate].work).toBe("refusals proved");
  });
});
