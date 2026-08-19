/**
 * Pins the shipped `skip_jobs` → gate mapping to `quality.yml` itself.
 *
 * The mapping has to be STATIC data in `lisa-gates.mjs`, because the place it
 * gets read is a consumer checkout, and a consumer has no copy of `quality.yml`
 * at all — it calls the reusable workflow by ref. So the table cannot be
 * derived where it is used.
 *
 * That leaves exactly one way for it to stay true: derive it HERE, in the only
 * repository that holds the workflow, and fail when the two disagree. A job
 * added, converted, renamed, or given a different skip token breaks this file
 * rather than shipping a table that quietly answers a question about a
 * workflow that no longer looks like that.
 *
 * This is deliberately a derivation and not a second hand-written list. The
 * defect being fixed is a mapping that existed only in a test fixture — a
 * second transcription would recreate it with an extra copy.
 * @module tests/integration/quality-gate-skip-jobs-mapping
 */

import { describe, expect, it } from "vitest";

import {
  QUALITY_JOB_GATES,
  SKIP_JOB_TOKENS,
} from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { workflow, source } from "./quality-gate-facade-fixture.js";

/**
 * Every skip token a job's `if:` condition honours.
 *
 * Matched against the exact `,<token>,` form the workflow uses, because that
 * is what GitHub compares — a token spelled any other way matches nothing and
 * the job RUNS.
 * @param condition - The job's `if:` expression, if any
 * @returns The tokens that suppress the job
 */
function tokensIn(condition: string | undefined): string[] {
  return [
    ...new Set(
      [
        ...String(condition ?? "").matchAll(
          /inputs\.skip_jobs\), ',([^']+),'\)/g
        ),
      ].map(match => match[1] ?? "")
    ),
  ];
}

/**
 * The gate a job resolves through its façade, or null when it has none.
 * @param job - Job id in `quality.yml`
 * @returns The `GATE_ID` its resolve step declares, or null
 */
const gateOf = (job: string): string | null => {
  const resolve = (workflow.jobs[job]?.steps ?? []).find(
    step => step.id === "gate"
  );
  const id = resolve?.env?.["GATE_ID"];
  return typeof id === "string" ? id : null;
};

/** Every job in the workflow that resolves a gate, and the gate it resolves. */
const derivedJobGates: Record<string, string> = Object.fromEntries(
  Object.keys(workflow.jobs).flatMap(job => {
    const gate = gateOf(job);
    return gate === null ? [] : [[job, gate] as const];
  })
);

/** Every token the workflow honours, and the jobs it suppresses, in file order. */
const derivedTokenJobs: Record<string, string[]> = (() => {
  const table: Record<string, string[]> = {};
  for (const [job, definition] of Object.entries(workflow.jobs)) {
    for (const token of tokensIn(definition.if)) {
      const jobs = table[token] ?? [];
      jobs.push(job);
      table[token] = jobs;
    }
  }
  return table;
})();

/**
 * The tokens the `skip_jobs` input's own description advertises.
 *
 * Read from the description rather than restated: it is what a consumer copies
 * from, so a token listed there and honoured nowhere is still a token doctor
 * has to answer for.
 * @returns The advertised tokens
 */
function documentedTokens(): string[] {
  const description =
    workflow.on?.workflow_call?.inputs?.["skip_jobs"]?.description ?? "";
  const listed = /\(([^)]{0,4096})\)[ \t]{0,64}$/.exec(description)?.[1] ?? "";
  return listed.split(",").filter(Boolean);
}

describe("the shipped skip_jobs mapping matches quality.yml", () => {
  it("covers every job that resolves a gate", () => {
    expect(QUALITY_JOB_GATES).toEqual(derivedJobGates);
  });

  it("covers every token any job condition honours", () => {
    const honoured = Object.keys(derivedTokenJobs).sort((a, b) =>
      a.localeCompare(b)
    );
    const shipped = Object.keys(SKIP_JOB_TOKENS)
      .filter(token => (SKIP_JOB_TOKENS[token] ?? []).length > 0)
      .sort((a, b) => a.localeCompare(b));
    expect(shipped).toEqual(honoured);
  });

  it("lists the same jobs, in the same order, for every honoured token", () => {
    const shipped = Object.fromEntries(
      Object.entries(SKIP_JOB_TOKENS)
        .filter(([, jobs]) => jobs.length > 0)
        .map(([token, jobs]) => [token, [...jobs]])
    );
    expect(shipped).toEqual(derivedTokenJobs);
  });

  it("answers every token the input description advertises", () => {
    const unanswered = documentedTokens().filter(
      token => !Object.hasOwn(SKIP_JOB_TOKENS, token)
    );
    expect(unanswered).toEqual([]);
  });

  it("records an advertised token that no job honours as suppressing nothing", () => {
    const honoured = new Set(Object.keys(derivedTokenJobs));
    const inert = documentedTokens().filter(token => !honoured.has(token));
    for (const token of inert) {
      expect(SKIP_JOB_TOKENS[token]).toEqual([]);
    }
    // Not asserted as "none exist": one does today (`github_issue`), and the
    // point of the case is that doctor can say so rather than invent a gate.
    expect(inert.length).toBeGreaterThan(0);
  });

  it("keeps the input a live escape rather than a removed one", () => {
    // The migration is a consumer-side edit. Retiring the input before every
    // consumer has made it would break them, so this file must never become
    // the reason someone deletes it.
    expect(source).toContain("skip_jobs:");
  });
});
