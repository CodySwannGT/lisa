/**
 * Tests for gate resolution, needs derivation, and branch-protection contexts.
 *
 * The load-bearing assertion here is that an `off` gate produces no context.
 * GitHub counts a SKIPPED required check as satisfied, so a gate that does not
 * run must never appear in the required list — and because one declaration
 * drives both the job condition and the context list, it cannot.
 * @module tests/unit/scripts/lisa-gates-resolution
 */

import { describe, expect, it } from "vitest";

import {
  contextsFor,
  EVIDENCE_DEFAULTS,
  needsAt,
  resolveMoment,
  retiredContexts,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  LINT_LABEL,
  LINT_TASK,
  LOCAL_REVIEW,
  NATIVE_E2E_TASK,
  PRE_DEPLOY_PROD,
  PULL_REQUEST,
  QUALITY,
  RETIRED_LABEL,
  RETIRED_REPLACEMENT_LABEL,
  REVIEW_BOT,
} from "./lisa-gates-fixtures.js";

describe("resolveMoment", () => {
  const gates = {
    "code-style": {
      run: LINT_TASK,
      commit: "required",
      [PULL_REQUEST]: "required",
    },
    "test-meaningfulness": { [PULL_REQUEST]: "optional" },
    "dead-code": { push: "off" },
    "verification-bypass": { "pre-tool": "required" },
    "code-review": {
      push: { level: "optional", run: LOCAL_REVIEW },
      [PULL_REQUEST]: { level: "required", await: REVIEW_BOT },
    },
  };

  it("returns only gates enabled at the moment, with their command", () => {
    expect(
      resolveMoment({ gates, moment: "commit", runner: "bun run" })
    ).toEqual([
      {
        id: "code-style",
        level: "required",
        mode: "run",
        awaits: null,
        // Null for a gate Lisa runs: the applier pins those to GitHub Actions,
        // and a second pin would name an app that never posts the context.
        postedBy: null,
        // The project's own `run:`, reported separately from the resolved
        // `task` because the two can be spelled identically and a consumer
        // asking "did Lisa write this command" cannot tell them apart from the
        // spelling alone (CodySwannGT/lisa#3078). This fixture declares one.
        declared: LINT_TASK,
        task: LINT_TASK,
        command: "bun run lint",
        label: "🧹 Lint",
        work: null,
        // Non-null only when the registry's `shippedAs` alias stood in for a
        // default that resolves to no script here. This gate names its own
        // task, and a project's own `run:` is never second-guessed.
        alias: null,
        evidence: null,
        // Null unless this declaration named the chain of jobs its prover is
        // reached through. Only a gate proved outside the quality facade does;
        // everything else takes the caller-wide chain, unchanged.
        callerChain: null,
        // Lint rewrites the tree when pointed at a `--fix` task, so it sorts
        // ahead of every gate that verifies the tree. See lisa-gates-order.
        mayRewrite: true,
        // Lint finishes in seconds, so it still runs after a blocking failure
        // rather than having its answer thrown away. See `costly`.
        costly: false,
      },
    ]);
  });

  it("uses the registry default when a gate names no task", () => {
    const resolved = resolveMoment({
      gates: { "test-meaningfulness": { [PULL_REQUEST]: "optional" } },
      moment: PULL_REQUEST,
      runner: "bun run",
    });
    expect(resolved[0]?.command).toBe("bun run test:mutation");
  });

  it("marks a whole-suite gate costly, so a blocked run does not pay for it", () => {
    // Hardcoded rather than read back off the registry: a test that asserts a
    // flag by reading the same flag proves only that it equals itself.
    const [mutation] = resolveMoment({
      gates: { "test-meaningfulness": { [PULL_REQUEST]: "optional" } },
      moment: PULL_REQUEST,
      runner: "bun run",
    });
    expect(mutation?.costly).toBe(true);
  });

  it("treats an explicit off exactly like an absent moment", () => {
    expect(
      resolveMoment({ gates, moment: "push" }).map(gate => gate.id)
    ).toEqual(["code-review"]);
  });

  it("marks an interceptor as intercepted rather than runnable", () => {
    const [gate] = resolveMoment({ gates, moment: "pre-tool" });
    expect(gate?.mode).toBe("intercept");
    expect(gate?.command).toBeNull();
  });

  it("extends evidence defaults rather than replacing them", () => {
    const [gate] = resolveMoment({
      gates: {
        "code-review": {
          [PULL_REQUEST]: {
            level: "required",
            await: "Greptile",
            evidence: { no_work: ["seat limit exceeded"] },
          },
        },
      },
      moment: PULL_REQUEST,
    });
    expect(gate?.evidence.no_work).toContain("seat limit exceeded");
    // Removing a default would narrow detection with no signal it was narrowed.
    for (const phrase of EVIDENCE_DEFAULTS.no_work) {
      expect(gate?.evidence.no_work).toContain(phrase);
    }
  });

  it("defaults an awaited gate to reporting rather than blocking", () => {
    const [gate] = resolveMoment({
      gates: {
        "code-review": {
          [PULL_REQUEST]: { level: "required", await: REVIEW_BOT },
        },
      },
      moment: PULL_REQUEST,
    });
    expect(gate?.evidence.on_hollow).toBe("report");
  });
});

describe("needsAt", () => {
  const gates = {
    "e2e-native": {
      run: NATIVE_E2E_TASK,
      needs: { tools: ["maestro"], secrets: ["MAESTRO_API_KEY"] },
      [PULL_REQUEST]: "optional",
      [PRE_DEPLOY_PROD]: "required",
    },
    "code-style": { run: LINT_TASK, commit: "required" },
  };

  it("unions what the gates at that moment need", () => {
    const needs = needsAt({ gates, moment: PULL_REQUEST });
    expect(needs.tools).toEqual(["maestro"]);
    expect(needs.secrets).toEqual(["MAESTRO_API_KEY"]);
  });

  it("needs nothing where no gate requiring it runs", () => {
    // The requirement follows the work, not the surface.
    expect(needsAt({ gates, moment: "commit" })).toEqual({
      tools: [],
      secrets: [],
      reasons: {},
    });
  });

  it("names the gate that caused each requirement", () => {
    const needs = needsAt({ gates, moment: PRE_DEPLOY_PROD });
    expect(needs.reasons.maestro).toContain("e2e-native");
  });
});

describe("contextsFor", () => {
  const gates = {
    "code-style": { run: LINT_TASK, [PULL_REQUEST]: "required" },
    "test-meaningfulness": { [PULL_REQUEST]: "optional" },
    "load-capacity": { [PRE_DEPLOY_PROD]: "required" },
    "code-review": { [PULL_REQUEST]: { level: "required", await: REVIEW_BOT } },
  };

  it("derives required contexts, so the list stops being transcribed", () => {
    expect(contextsFor(gates, { workflowName: QUALITY })).toEqual([
      LINT_LABEL,
      REVIEW_BOT,
    ]);
  });

  it("uses the signal's own name for an awaited gate", () => {
    // A bot posts under its own context, not the calling workflow's.
    expect(contextsFor(gates, { workflowName: QUALITY })).toContain(REVIEW_BOT);
  });

  it("omits optional gates, which are not merge blockers", () => {
    expect(contextsFor(gates, { workflowName: QUALITY })).not.toContain(
      `${QUALITY} / 🧬 Mutation Testing Gate`
    );
  });

  it("omits an off gate entirely, which is what makes off safe", () => {
    // GitHub counts a SKIPPED required check as satisfied, so a gate that does
    // not run must never appear here. One declaration drives both.
    expect(
      contextsFor(
        { "code-style": { run: LINT_TASK, [PULL_REQUEST]: "off" } },
        { workflowName: QUALITY }
      )
    ).toEqual([]);
  });

  it("scopes contexts to one moment", () => {
    expect(contextsFor(gates, { workflowName: QUALITY })).not.toContain(
      `${QUALITY} / 📈 Load Capacity`
    );
    expect(
      contextsFor(gates, {
        workflowName: QUALITY,
        moment: PRE_DEPLOY_PROD,
      })
    ).toEqual([`${QUALITY} / 📈 Load Capacity`]);
  });

  it("keeps a retired label alive during a rename", () => {
    const contexts = contextsFor(gates, {
      workflowName: QUALITY,
      previousLabels: ["🧹 Lint (legacy)"],
    });
    expect(contexts).toContain(LINT_LABEL);
    expect(contexts).toContain(`${QUALITY} / 🧹 Lint (legacy)`);
  });
});

describe("retiredContexts", () => {
  // The machine-readable retirement list #3067 asked for. A required context
  // that never reports does not fail a pull request — GitHub waits on it
  // forever — so the only cheap way to find one is to hold a ruleset's
  // required list against the names a job can still post. This is the
  // "can still post" half, and it is what separates a provably dead name from
  // a status some third-party app posts, which is not a defect at all.
  it("names every label the registry records as renamed away", () => {
    const retired = retiredContexts({ workflowName: QUALITY });

    expect(retired.map(entry => entry.label)).toContain(RETIRED_LABEL);
    expect(retired.find(entry => entry.label === RETIRED_LABEL)).toMatchObject({
      context: `${QUALITY} / ${RETIRED_LABEL}`,
      gate: "structural-rules",
      replacement: `${QUALITY} / ${RETIRED_REPLACEMENT_LABEL}`,
    });
  });

  it("carries the retired and replacement labels bare, for leaf matching", () => {
    // A consumer holding a LIVE ruleset cannot assume the default chain — the
    // same gate posts one depth on the pull-request path and another on the
    // release path — so it matches the retired label as the final context
    // segment and rebuilds the replacement against the chain it found. Both
    // halves of that need the bare labels, not the `/`-joined renderings.
    const entry = retiredContexts({ workflowName: QUALITY }).find(
      candidate => candidate.label === RETIRED_LABEL
    );

    expect(entry?.replacementLabel).toBe(RETIRED_REPLACEMENT_LABEL);
  });

  it("answers about the registry, not about what this project declares", () => {
    // The repository is red-walled whether or not it declares the gate that
    // used to post the name — filtering on the declaration would hide exactly
    // the projects that have already turned the gate off.
    expect(retiredContexts({ workflowName: QUALITY }).length).toBeGreaterThan(
      0
    );
  });

  it("prefixes with the caller chain the ruleset actually pins", () => {
    const [first] = retiredContexts({ workflowName: `Release / ${QUALITY}` });

    expect(first?.context.startsWith(`Release / ${QUALITY} / `)).toBe(true);
  });

  it("never lists a label that is some gate's current label", () => {
    const live = new Set(
      contextsFor(
        { "code-style": { run: LINT_TASK, [PULL_REQUEST]: "required" } },
        { workflowName: QUALITY }
      )
    );

    for (const entry of retiredContexts({ workflowName: QUALITY })) {
      expect(live.has(entry.context)).toBe(false);
    }
  });
});
