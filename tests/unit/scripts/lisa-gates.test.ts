/**
 * Tests for the gate registry, policy schema, and config-key audit.
 *
 * The assertions that carry weight are the ones about failure modes this design
 * exists to prevent: a misspelled gate id must not read as an enabled
 * guarantee, an awaited check that can never fire must be refused, an unbounded
 * wait must be refused, and a gate that is `off` must never produce a
 * branch-protection context — because a skipped required check counts as
 * satisfied on GitHub.
 * @module tests/unit/scripts/lisa-gates
 */

import { describe, expect, it } from "vitest";

import {
  auditConfigKeys,
  isMoment,
  REGISTRY,
  validateGates,
  validatePolicy,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  LOCAL_REVIEW,
  NATIVE_E2E_TASK,
  PRE_DEPLOY_PROD,
  PULL_REQUEST,
  REVIEW_BOT,
} from "./lisa-gates-fixtures.js";

/**
 * Registry lookup that keeps TypeScript out of the way in assertions.
 * @param id - Gate id to look up
 * @returns The registry definition for that gate
 */
/** The moments a gate needing a running target is confined to. */
const DEPLOY_MOMENTS = ["pre-deploy", "post-deploy", "continuous"] as const;

const definition = (id: string) =>
  (REGISTRY as Record<string, { moments: string[] }>)[id];

describe("REGISTRY", () => {
  it("gives every gate a label, summary, task and legal moments", () => {
    for (const [id, gate] of Object.entries(REGISTRY)) {
      expect(gate.label, id).toBeTruthy();
      expect(gate.summary, id).toBeTruthy();
      expect(gate.task, id).toBeTruthy();
      expect(gate.moments.length, id).toBeGreaterThan(0);
    }
  });

  it("confines deploy-only gates to deploy moments", () => {
    // Nothing is deployed at commit time for a DAST scan to point at.
    //
    // `performance-budget` LEFT this family deliberately, and the distinction
    // is whether the gate can produce its own target. A DAST scan and a load
    // test need a service someone else is running; there is nothing to point
    // at before a deploy. A performance budget builds the bundle it measures —
    // `export:web` then `lhci autorun` against the local build — so the
    // premise that put it here does not hold for it.
    //
    // This is not theoretical. Every consumer already measures at pull-request
    // time and has for as long as `lighthouse.yml` has existed; the gate being
    // deploy-only is what kept the registry from describing what was actually
    // happening, and therefore from letting a project decline it.
    for (const id of [
      "runtime-web-vulnerability",
      "load-capacity",
      "accessibility",
    ]) {
      // `continuous` joined this family deliberately: these need something
      // running to point at, and a schedule provides that as readily as a
      // deploy does. What stays excluded is every change-triggered moment.
      expect(definition(id).moments, id).toEqual(DEPLOY_MOMENTS);
    }
  });

  it("lets the performance budget run where the change is, and at deploy", () => {
    // Widened from the deploy-only family above. `push` is present so a
    // project CAN opt in, not so it runs by default: there is deliberately no
    // built-in for this gate in lisa-run-gates.mjs, so an undeclared gate runs
    // nothing at push. See tests/unit/config/performance-budget-gate.test.ts.
    expect(definition("performance-budget").moments).toEqual([
      "push",
      "pull-request",
      ...DEPLOY_MOMENTS,
    ]);
  });

  it("keeps type-aware lint out of commit", () => {
    expect(definition("code-style-slow").moments).not.toContain("commit");
  });
});

describe("isMoment", () => {
  it("accepts fixed moments and environment-suffixed families", () => {
    expect(isMoment("commit")).toBe(true);
    expect(isMoment(PRE_DEPLOY_PROD)).toBe(true);
    expect(isMoment("post-deploy:staging")).toBe(true);
  });

  it("rejects a family with no environment", () => {
    expect(isMoment("pre-deploy")).toBe(false);
  });

  it("rejects an invented moment", () => {
    expect(isMoment("on-save")).toBe(false);
  });
});

describe("validateGates", () => {
  it("accepts a well-formed gate", () => {
    expect(
      validateGates({
        "credential-leakage": {
          run: "security:check-for-leaks",
          commit: "required",
          [PULL_REQUEST]: "required",
        },
      })
    ).toEqual([]);
  });

  it("rejects an unknown gate id and suggests the nearest", () => {
    const problems = validateGates({
      "credential-leakge": { commit: "required" },
    });
    expect(problems.join(" ")).toContain("not a gate Lisa knows");
    expect(problems.join(" ")).toContain('Did you mean "credential-leakage"?');
  });

  it("redirects a policy-enforced guarantee to the policy block", () => {
    // Nothing runs and nothing produces a verdict; the response to a violation
    // is to repair a setting, not to block a change.
    const problems = validateGates({
      "review-completion": { [PULL_REQUEST]: "required" },
    });
    expect(problems.join(" ")).toContain("repository policy, not a gate");
    expect(problems.join(" ")).toContain('Declare it under "policy"');
  });

  it("rejects an illegal moment for the gate", () => {
    const problems = validateGates({
      "code-style-slow": { run: "lint:slow", commit: "required" },
    });
    expect(problems.join(" ")).toContain('cannot run at "commit"');
    expect(problems.join(" ")).toContain("Legal moments: push");
  });

  it("rejects a deploy-only gate at pull-request", () => {
    const problems = validateGates({
      "load-capacity": { [PULL_REQUEST]: "required" },
    });
    expect(problems.join(" ")).toContain('cannot run at "pull-request"');
  });

  it("accepts a deploy gate at an environment-suffixed moment", () => {
    expect(
      validateGates({
        "load-capacity": { [PRE_DEPLOY_PROD]: "required" },
      })
    ).toEqual([]);
  });

  it("rejects awaiting a signal before a pull request exists", () => {
    // An awaited check that can never fire is a declared guarantee that never
    // runs — the silent hole in its purest form.
    const problems = validateGates({
      "code-review": { push: { level: "required", await: REVIEW_BOT } },
    });
    expect(problems.join(" ")).toContain("no pull request yet");
  });

  it("accepts a gate proved differently at different moments", () => {
    expect(
      validateGates({
        "code-review": {
          push: { level: "optional", run: LOCAL_REVIEW },
          [PULL_REQUEST]: { level: "required", await: REVIEW_BOT },
        },
      })
    ).toEqual([]);
  });

  it("rejects declaring both provers at one moment", () => {
    const problems = validateGates({
      "code-review": {
        [PULL_REQUEST]: {
          level: "required",
          await: REVIEW_BOT,
          run: LOCAL_REVIEW,
        },
      },
    });
    expect(problems.join(" ")).toContain("one prover");
  });

  it("rejects an unbounded wait", () => {
    // A pull request blocked with no signal, whose fastest fix is deleting the
    // requirement — which is how a gate ends up removed rather than satisfied.
    const problems = validateGates({
      "code-review": {
        [PULL_REQUEST]: {
          level: "required",
          await: REVIEW_BOT,
          evidence: { on_hollow: "wait" },
        },
      },
    });
    expect(problems.join(" ")).toContain("wait_minutes is not a positive");
  });

  it("accepts a bounded wait", () => {
    expect(
      validateGates({
        "code-review": {
          [PULL_REQUEST]: {
            level: "required",
            await: REVIEW_BOT,
            evidence: {
              on_hollow: "wait",
              wait_minutes: 30,
              on_timeout: "block",
            },
          },
        },
      })
    ).toEqual([]);
  });

  it("rejects an unknown hollow response", () => {
    const problems = validateGates({
      "code-review": {
        [PULL_REQUEST]: {
          level: "required",
          await: REVIEW_BOT,
          evidence: { on_hollow: "ignore" },
        },
      },
    });
    expect(problems.join(" ")).toContain("expected report, wait, block");
  });

  it("rejects a non-UPPER_SNAKE needed secret", () => {
    const problems = validateGates({
      "e2e-native": {
        run: NATIVE_E2E_TASK,
        needs: { secrets: ["maestro-key"] },
        [PULL_REQUEST]: "optional",
      },
    });
    expect(problems.join(" ")).toContain("UPPER_SNAKE_CASE");
  });

  it("rejects delegating an interceptor to a task", () => {
    const problems = validateGates({
      "verification-bypass": {
        run: "security:no-verify",
        "pre-tool": "required",
      },
    });
    expect(problems.join(" ")).toContain("cannot be delegated");
  });

  it("accepts an interceptor declaring only where it is enforced", () => {
    expect(
      validateGates({ "verification-bypass": { "pre-tool": "required" } })
    ).toEqual([]);
  });

  it("accepts a custom gate behind the x- prefix", () => {
    expect(
      validateGates({
        "x-vendor-policy": { run: "policy:check", [PULL_REQUEST]: "optional" },
      })
    ).toEqual([]);
  });

  it("rejects a custom gate with no prover, since Lisa has no default", () => {
    const problems = validateGates({
      "x-vendor-policy": { [PULL_REQUEST]: "optional" },
    });
    expect(problems.join(" ")).toContain("names no prover");
  });
});

describe("validatePolicy", () => {
  it("accepts a well-formed policy", () => {
    expect(
      validatePolicy({
        merge: {
          squash: true,
          merge_commit: false,
          delete_branch_on_merge: true,
        },
        protect: { force_push: false, up_to_date_before_merge: true },
        on_drift: "repair",
      })
    ).toEqual([]);
  });

  it("rejects an unknown section with a suggestion", () => {
    expect(validatePolicy({ merg: { squash: true } }).join(" ")).toContain(
      'Did you mean "merge"?'
    );
  });

  it("rejects an unknown setting", () => {
    expect(
      validatePolicy({ merge: { squash_merge: true } }).join(" ")
    ).toContain("not a setting Lisa manages");
  });

  it("rejects a wrongly typed setting", () => {
    expect(validatePolicy({ merge: { squash: "yes" } }).join(" ")).toContain(
      "must be a boolean, got string"
    );
  });

  it("rejects an unknown drift response", () => {
    expect(validatePolicy({ on_drift: "ignore" }).join(" ")).toContain(
      "expected repair, report, block"
    );
  });
});

describe("auditConfigKeys", () => {
  it("says nothing about keys Lisa reads", () => {
    expect(
      auditConfigKeys({ tracker: "github", gates: {}, policy: {} })
    ).toEqual([]);
  });

  it("catches a typo that would otherwise look like configuration", () => {
    // `"trackr": "github"` produced no error, no warning, and every skill
    // failing with "'tracker' is not set".
    const findings = auditConfigKeys({ trackr: "github" });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('Did you mean "tracker"?');
  });

  it("names a retired key and what replaced it", () => {
    const findings = auditConfigKeys({
      projectRulesFile: ".claude/rules/X.md",
    });
    expect(findings[0]?.message).toContain("retired");
    expect(findings[0]?.message).toContain(".agents/rules/");
  });

  it("ignores Lisa's metadata namespace and the project's own", () => {
    expect(auditConfigKeys({ _lisaSync: {}, "x-internal": {} })).toEqual([]);
  });
});
