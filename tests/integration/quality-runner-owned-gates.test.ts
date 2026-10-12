/**
 * Five pull-request gates moved from hand-written `quality.yml` jobs to the
 * generic gate runner's matrix legs (CodySwannGT/lisa#3052).
 *
 * Each job ran `$runner $task` for a declared gate, and so does a
 * `declared_gates` leg: same task, same runner, same dependency install, same
 * optional/required semantics, same context string. The difference was where
 * the context came from, so the job was redundant once every in-scope caller
 * declared the gate. This suite pins what "moved" has to mean, so that a later
 * edit cannot undo half of it:
 *
 * - the job is gone, and nothing else in the workflow is named the gate's
 *   label — two posters for one context lets branch protection match
 *   whichever reported last;
 * - the gate is no longer job-backed, so `momentLegs` emits a leg for it;
 * - the leg posts the same context the job posted, so no ruleset changes;
 * - its `skip_jobs` token is retired with a reason, not silently dropped;
 * - `seedGates` STILL declares it at `pull-request`. The quality-workflow
 *   inventory entry used to be what seeded it. Deleting that entry without a
 *   replacement would stop declaring the gate for every project seeded from
 *   then on, and an undeclared gate has no leg, so the check would vanish
 *   with nothing reporting the loss.
 *
 * Three candidates the same audit considered stay as jobs. Each does more than
 * `$runner $task`, so a leg is not equivalent. Their rows are pinned here so
 * that deleting them reads as a decision, not as tidying up.
 * @module tests/integration/quality-runner-owned-gates
 */
import { describe, expect, it } from "vitest";

import {
  HARDCODED_INVOCATIONS,
  QUALITY_JOB_GATES,
  REGISTRY,
  RETIRED_SKIP_JOB_TOKENS,
  SKIP_JOB_TOKENS,
  momentLegs,
  seedGates,
} from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { QUALITY_YML, workflowIn } from "./quality-gate-facade-fixture.js";

/** The moment these jobs and legs serve. */
const PULL_REQUEST = "pull-request";

/** One job that moved onto the runner, and the context it posted. */
interface Moved {
  readonly job: string;
  readonly gate: string;
  readonly context: string;
  readonly task: string;
}

/**
 * The five that moved. `context` is the job's former `name:`, written out
 * rather than read from the registry: the claim under test is that the leg
 * posts the string the deleted job used to post, and deriving both sides from
 * one field would make that a tautology.
 */
const MOVED: readonly Moved[] = [
  {
    job: "lint_slow",
    gate: "code-style-slow",
    context: "🐢 Slow Lint Rules",
    task: "lint:slow",
  },
  {
    job: "typecheck",
    gate: "type-correctness",
    context: "🔍 Type Check",
    task: "typecheck",
  },
  {
    job: "format",
    gate: "format-conformance",
    context: "📐 Check Formatting",
    task: "format:check",
  },
  {
    job: "build",
    gate: "build-integrity",
    context: "🏗️ Build",
    task: "build",
  },
  {
    job: "dead_code",
    gate: "dead-code",
    context: "🗑️ Dead Code Detection",
    task: "knip:check",
  },
];

/**
 * The three that stay as jobs, and what each job does that a leg cannot.
 */
const KEPT: readonly { job: string; gate: string; why: string }[] = [
  {
    job: "lint",
    gate: "code-style",
    why: "its time budget is the caller's lint_timeout_minutes input (default 30), and a leg gets 15",
  },
  {
    job: "test_unit",
    gate: "test-correctness",
    why: "it uploads the coverage artifact the static-analysis job consumes",
  },
  {
    job: "work_item_traceability",
    gate: "traceability",
    why: "its prover reads the pull request with a token a leg is not given",
  },
];

/** A package.json scripts block carrying every task the five resolve to. */
const SCRIPTS = Object.freeze({
  "lint:slow": "eslint . --quiet",
  typecheck: "tsc --noEmit",
  "format:check": "prettier --check .",
  build: "tsc",
  "knip:check": "knip",
});

const jobs = (): Record<string, { name?: unknown }> =>
  workflowIn(QUALITY_YML).jobs as Record<string, { name?: unknown }>;

describe.each(MOVED)("$job moved onto the gate runner", moved => {
  it("is no longer a job in quality.yml", () => {
    expect(Object.keys(jobs())).not.toContain(moved.job);
  });

  it("leaves no other job posting its context", () => {
    const named = Object.entries(jobs())
      .filter(([, job]) => job.name === moved.context)
      .map(([id]) => id);
    expect(named).toEqual([]);
  });

  it("has no QUALITY_JOB_GATES row, so the runner owns the gate", () => {
    expect(Object.hasOwn(QUALITY_JOB_GATES, moved.job)).toBe(false);
    expect(Object.values(QUALITY_JOB_GATES)).not.toContain(moved.gate);
  });

  it("retires its skip_jobs token with a reason", () => {
    expect(Object.hasOwn(SKIP_JOB_TOKENS, moved.job)).toBe(false);
    const retired = (
      RETIRED_SKIP_JOB_TOKENS as Record<
        string,
        { retiredIn: string; reason: string }
      >
    )[moved.job];
    expect(retired?.retiredIn).toBe("#3052");
    expect(retired?.reason).toContain(moved.gate);
  });

  it("has no quality-workflow invocation left", () => {
    const left = (
      HARDCODED_INVOCATIONS as readonly {
        gate: string;
        moment: string;
        surface: string;
      }[]
    ).filter(
      entry =>
        entry.gate === moved.gate &&
        entry.moment === PULL_REQUEST &&
        entry.surface === "quality-workflow"
    );
    expect(left).toEqual([]);
  });

  it("gets a leg posting the context the job posted, running the same command", () => {
    const legs = momentLegs({
      gates: { [moved.gate]: { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
      runner: "bun run",
      scripts: SCRIPTS,
    });
    expect(legs).toEqual([
      expect.objectContaining({
        gate: moved.gate,
        label: moved.context,
        level: "required",
        action: "run",
        runner: "bun run",
        task: moved.task,
        install: true,
      }),
    ]);
  });

  it("is still seeded at pull-request, so a newly applied project keeps the check", () => {
    const { seeded } = seedGates({ gates: {}, scripts: SCRIPTS });
    expect(seeded).toContainEqual(
      expect.objectContaining({ gate: moved.gate, moment: PULL_REQUEST })
    );
  });
});

describe.each(KEPT)("$job stays a job", kept => {
  it("still carries its gate in a hand-written job", () => {
    expect(Object.keys(jobs())).toContain(kept.job);
    expect(QUALITY_JOB_GATES[kept.job as keyof typeof QUALITY_JOB_GATES]).toBe(
      kept.gate
    );
    expect(REGISTRY[kept.gate as keyof typeof REGISTRY]).toBeDefined();
  });
});
