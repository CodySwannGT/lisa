/**
 * The workflow name `contextsFor` prefixes a run gate's context with.
 *
 * A literal, matching the default in the shipped registry. Reading it from
 * there would make the assertion agree with whatever the registry says,
 * including a value no ruleset was ever written against.
 */
const WORKFLOW_NAME = "🔍 Quality Checks";

/** The moment `quality.yml` runs at, and the one a ruleset is derived for. */
const PULL_REQUEST = "pull-request";

/**
 * What each façade job is CALLED, and what a ruleset therefore matches.
 *
 * Split from `quality-gate-facade.test.ts` when that file crossed the 300-line
 * cap, along the seam it already had: this file is about identity — the job
 * name, the gate label, the derived branch-protection context, and the rule
 * that exactly one job per gate wears the label. Its sibling is about
 * mechanics — how the resolve step behaves and what the fallback does.
 *
 * Identity is the half where a mistake is silent and expensive: a job name and
 * a gate label that disagree derive a required context nothing posts, and the
 * pull request waits forever on a check that will never report.
 * @module tests/integration/quality-gate-facade-names
 */
import { pathToFileURL } from "node:url";

import {
  CONVERTED,
  GATES_SCRIPT,
  jobIn,
  loadRegistry,
  workflowIn,
} from "./quality-gate-facade-fixture.js";
import type { GateDefinition } from "./quality-gate-facade-fixture.js";

const PRIMARY = CONVERTED.filter(entry => entry.secondaryProver !== true);

/** The provers that share a gate with a primary and must not be named it. */
const SECONDARY = CONVERTED.filter(entry => entry.secondaryProver === true);

let registry: Record<string, GateDefinition>;

beforeAll(async () => {
  registry = await loadRegistry();
});

describe("quality.yml gate façade names", () => {
  describe("job names are unchanged", () => {
    it.each(CONVERTED)(
      "$job still declares the exact context name $jobName",
      ({ job, jobName, file }) => {
        expect((jobIn(job, file) as { name?: string }).name).toBe(jobName);
      }
    );

    it.each(PRIMARY)(
      "$job's name matches REGISTRY.$gate.label, so the derived required-context list still names it",
      ({ jobName, gate }) => {
        expect(registry[gate]?.label).toBe(jobName);
      }
    );

    it.each(SECONDARY)(
      "$job proves $gate without wearing its label, so only one job posts that context",
      ({ jobName, gate }) => {
        expect(registry[gate]?.label).not.toBe(jobName);
        // And the label is not orphaned by the exemption: some primary still
        // wears it, or the derived context would name nothing.
        expect(
          PRIMARY.filter(entry => entry.gate === gate).map(
            entry => entry.jobName
          )
        ).toEqual([registry[gate]?.label]);
      }
    );

    it("gives every gate exactly one job that carries its label", () => {
      // The invariant the two cases above are halves of, asserted directly so
      // that a SECOND primary for one gate fails even if both spell the label
      // correctly. Two jobs posting one context is the failure; agreeing on
      // the string is what makes it invisible.
      const perGate = new Map<string, string[]>();
      for (const entry of PRIMARY) {
        perGate.set(entry.gate, [
          ...(perGate.get(entry.gate) ?? []),
          entry.job,
        ]);
      }
      expect([...perGate].filter(([, jobs]) => jobs.length > 1)).toEqual([]);
    });

    it.each(PRIMARY)(
      "declaring $gate required derives a context $job actually posts",
      async ({ job, jobName, gate, file }) => {
        // The label assertion above compares two strings. This one runs the
        // derivation a ruleset is built from and compares its OUTPUT to the
        // job name, because that is the failure this whole family caused: a
        // derived context nothing ever posts is not a wrong string, it is a
        // pull request that can never merge.
        const loaded = (await import(pathToFileURL(GATES_SCRIPT).href)) as {
          contextsFor: (
            gates: unknown,
            options?: { moment?: string }
          ) => string[];
          REGISTRY: Record<string, { moments: string[] }>;
        };
        const moments = loaded.REGISTRY[gate]?.moments ?? [];
        // Pull-request where the gate is legal there, because that is the
        // moment `quality.yml` runs at. The few deploy-only gates fall back to
        // their first legal moment rather than being skipped: a context that
        // is only derived at pre-deploy still has to be one a job posts.
        const moment = moments.includes(PULL_REQUEST)
          ? PULL_REQUEST
          : (moments[0] ?? PULL_REQUEST);
        const derived = loaded.contextsFor(
          { [gate]: { [moment]: "required" } },
          { moment }
        );
        expect(derived).toContain(
          `${WORKFLOW_NAME} / ${(jobIn(job, file) as { name?: string }).name}`
        );
        expect(derived).toContain(`${WORKFLOW_NAME} / ${jobName}`);
      }
    );

    it.each(CONVERTED)(
      "$job is not a matrix, which would rewrite its context name",
      ({ job, file }) => {
        expect(
          (jobIn(job, file) as { strategy?: unknown }).strategy
        ).toBeUndefined();
      }
    );

    it("leaves every converted job id in place", () => {
      for (const { job, file } of CONVERTED) {
        expect(Object.keys(workflowIn(file).jobs)).toContain(job);
      }
    });
  });
});
