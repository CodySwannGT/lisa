/**
 * Tests for the `skip_jobs` → gate mapping shipped in the gate registry.
 *
 * The assertions that carry weight are the ones about the WRONG answer, not
 * the missing one. A token resolved to the wrong gate declares a check `off`
 * while the config reads deliberate — the check silently stops running and
 * nothing reports it. So the table has to refuse rather than approximate:
 * an unconverted job yields `unmappable`, a token no job honours yields
 * `inert`, and a token nobody has ever heard of yields `unknown`. None of
 * those may produce a gate id.
 * @module tests/unit/scripts/lisa-gates-skip-jobs
 */

import { describe, expect, it } from "vitest";

import {
  gateForSkipJob,
  QUALITY_JOB_GATES,
  REGISTRY,
  RETIRED_SKIP_JOB_TOKENS,
  SKIP_JOB_TOKENS,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** Token → gate pairs an underscore-to-hyphen transform gets WRONG. */
const NOT_DERIVABLE_FROM_THE_NAME: readonly (readonly [string, string])[] = [
  ["lint", "code-style"],
  ["lint_slow", "code-style-slow"],
  ["typecheck", "type-correctness"],
  ["build", "build-integrity"],
  ["format", "format-conformance"],
  ["test:unit", "test-correctness"],
  ["test:mutation", "test-meaningfulness"],
  ["npm_security_scan", "dependency-vulnerability"],
  ["sg_scan", "structural-rules"],
  ["work_item_traceability", "traceability"],
  ["threshold_ratchet", "threshold-monotonicity"],
  // These two read as derivable and are not. The registry had no word for
  // either property until these ids were invented for them, and neither id
  // shares a substring with its token — a transform would answer `null` for
  // one and a wrong guess for the other. `state_classification` is the third
  // of the same batch and IS the underscore-to-hyphen transform of its token,
  // so it is covered by the integration suite rather than pinned here.
  ["e2e_coverage", "journey-coverage"],
  ["floor_collisions", "security-floor-integrity"],
  // Renamed onto their gates' labels in #2914. The token still spells the
  // vendor-era job id, so nothing about the pairing is derivable from it.
  ["secret_scanning", "credential-leakage"],
  ["license_compliance", "license-compliance"],
  ["maestro_e2e", "e2e-native"],
  ["sonarcloud", "static-security"],
  // The SECOND prover of a gate another job carries. The token names the
  // vendor, the gate names the property, and the two share nothing — which is
  // the point: `skip_jobs: snyk` now has a declaration to migrate onto, and
  // that declaration governs both provers rather than half of them.
  ["snyk", "dependency-vulnerability"],
  // The token spells the job; the gate names the property the job proves. It
  // became mappable when the job's private `bdd_mode` axis was retired — until
  // then the declaration was not the control, so mapping the token onto it
  // would have pointed an operator at a setting that could lose silently.
  ["bdd_coverage", "behavior-contract"],
];

/**
 * Tokens whose job the registry still has no word for.
 *
 * The list has shrunk three times and each departure is worth keeping
 * straight, because they left for different reasons: `threshold_ratchet` in
 * #2830 when its job was wired; `e2e_coverage`, `state_classification` and
 * `floor_collisions` in #2846 when their properties were finally named; and
 * `secret_scanning`, `license_compliance`, `maestro_e2e` and `sonarcloud` in
 * #2914, where the blocker was never the wiring — each job's `name:` differed
 * from its gate's registry `label`, so converting one would have derived a
 * required context no job ever posts. The ruling moved the job onto the label.
 *
 * `zap_baseline` left in #2938 by a sixth route, and the only one that removes
 * the JOB rather than the token's blocker: the pull-request ZAP job was deleted.
 * It ran only when `zap_target_url` was set, which no shipped template sets, so
 * it posted `skipped` on every run it ever had, and `fail_action: false` meant
 * even a run that found something could not fail. DAST is a property of a
 * RUNNING application, so it belongs at the deploy moments where
 * `runtime-web-vulnerability` is legal and where #2832 shipped a runner. The
 * token is now in `RETIRED_SKIP_JOB_TOKENS`.
 *
 * Nothing is left in this list, which is the whole point of #2938 — see the
 * invariant below, which holds the WHOLE table rather than one named token.
 *
 * `bdd_coverage` left in #3016 by a fifth route. Its blocker was not a missing
 * gate but a SECOND control: the job answered to a private `bdd_mode` input
 * whose three states duplicated the registry's three levels, one of them a
 * time-boxed grace period. The owner retired the state and the axis; the
 * declaration became the only control, and the token became mappable onto it.
 *
 * `learnings_budget` left in #2932. Its blocker was never wiring either: the
 * property was enforced in three workflows, the token reached two, and the
 * third ran the same command inside a REQUIRED context it could not reach — so
 * a gate governing only the two would have been the same defect one layer up.
 * The third enforcement point moved into the gated job, and the context the
 * gated job posts became required in the same change.
 *
 * `skipped_required_checks` left this list in #2933 by a fourth route, and the
 * only one that removes a token rather than resolving it: the owner ruled the
 * job NOT DECLARABLE, so the token was deleted outright. It is now recorded in
 * `NON_DECLARABLE_JOBS` — a gate whose job is to detect silencing cannot itself
 * be silenceable — and there is no token left to map.
 *
 * Every one of these is now recorded in `UNGATED_QUALITY_JOBS` with a reason
 * and the issue that decides it, which is what separates a gap from an
 * oversight. `tests/integration/quality-ungated-jobs.test.ts` holds that table
 * against this list, so a token cannot leave this array without either
 * acquiring a gate or acquiring a written exemption — and cannot stay in it
 * once a gate exists.
 */
const UNMAPPABLE: readonly string[] = [];

describe("skip_jobs → gate mapping", () => {
  describe("the mapping ships outside the test suite", () => {
    it("is exported from the shipped registry, not from a test fixture", () => {
      expect(Object.keys(SKIP_JOB_TOKENS).length).toBeGreaterThan(0);
      expect(Object.keys(QUALITY_JOB_GATES).length).toBeGreaterThan(0);
    });

    it("names a real registry gate for every façade job", () => {
      const unknown = Object.entries(QUALITY_JOB_GATES).filter(
        ([, gate]) => !Object.hasOwn(REGISTRY, gate)
      );
      expect(unknown).toEqual([]);
    });

    it("is frozen, so a consumer cannot mutate the authority it read", () => {
      // `Object.isFrozen(undefined)` is `true`, so the presence assertions come
      // first — without them this passes against a registry that exports
      // neither table, which is exactly the state being fixed.
      expect(SKIP_JOB_TOKENS).toBeTypeOf("object");
      expect(QUALITY_JOB_GATES).toBeTypeOf("object");
      expect(Object.isFrozen(SKIP_JOB_TOKENS)).toBe(true);
      expect(Object.isFrozen(QUALITY_JOB_GATES)).toBe(true);
    });
  });

  describe("tokens whose gate cannot be derived from the name", () => {
    it.each(NOT_DERIVABLE_FROM_THE_NAME)("resolves %s to %s", (token, gate) => {
      const resolved = gateForSkipJob(token);
      expect(resolved.status).toBe("replaceable");
      expect(resolved.gate).toBe(gate);
      expect(resolved.ungated).toEqual([]);
    });
  });

  describe("a token with no gate is NAMED, never guessed", () => {
    // #2938's actual acceptance criterion, and deliberately stated over the
    // WHOLE table rather than over a named token. The old form asserted that
    // `zap_baseline` was unmappable, which pinned one row and said nothing
    // about a new one appearing beside it. This fails the moment any token
    // suppresses a job no gate governs, whoever adds it.
    it("leaves no token unmappable: every one resolves, is inert, or is retired", () => {
      const unmappable = Object.keys(SKIP_JOB_TOKENS)
        .map(token => gateForSkipJob(token))
        .filter(resolved => resolved.status === "unmappable")
        .map(resolved => resolved.token);

      expect(unmappable).toEqual(UNMAPPABLE);
    });

    it("reports zap_baseline as retired, with the remedy, not as unmappable", () => {
      // The job was deleted rather than named. `retired` is what separates
      // "this token was deliberately removed" from "you typed it wrong" —
      // reporting it as `unknown` would send an operator hunting a typo in a
      // token they spelled correctly.
      const resolved = gateForSkipJob("zap_baseline");
      expect(resolved.status).toBe("retired");
      expect(resolved.gate).toBeNull();
      expect(resolved.jobs).toEqual([]);
      expect(RETIRED_SKIP_JOB_TOKENS.zap_baseline?.retiredIn).toBe("#2938");
    });

    it("reports a documented token no job honours as inert", () => {
      const resolved = gateForSkipJob("github_issue");
      expect(resolved.status).toBe("inert");
      expect(resolved.gate).toBeNull();
      expect(resolved.jobs).toEqual([]);
    });

    it("reports test:e2e as inert now that quality.yml has no e2e job", () => {
      // It was `unmappable`: a real job with no façade, so no declaration could
      // replace the token. CodySwannGT/lisa#2841 deleted that job — the browser
      // suite is `playwright-e2e.yml`, governed by `e2e-browser` — so the token
      // now suppresses nothing and `inert` is the whole truth about it.
      //
      // The KEY has to stay for this to be reachable at all, and that is the
      // property worth pinning: every project built from the Expo and NestJS
      // templates passes `test:e2e` in `skip_jobs`, and a token with no entry in
      // the table resolves `unknown` and is reported as `undeclared_skip_token`.
      // Deleting the key would turn those consumers' working configuration into a
      // violation as a side effect of removing a hollow gate.
      const resolved = gateForSkipJob("test:e2e");
      expect(resolved.status).toBe("inert");
      expect(resolved.gate).toBeNull();
      expect(resolved.jobs).toEqual([]);
      expect(resolved.ungated).toEqual([]);
    });

    it("reports a token the workflow has never had as unknown", () => {
      const resolved = gateForSkipJob("lint-slow");
      expect(resolved.status).toBe("unknown");
      expect(resolved.gate).toBeNull();
      expect(resolved.jobs).toEqual([]);
    });

    it("does not resolve a hyphenated guess at an underscore token", () => {
      // `lint_slow` is real; `lint-slow` is what a naive transform produces.
      // Answering the guess would be worse than answering nothing.
      expect(gateForSkipJob("lint-slow").gate).toBeNull();
      expect(gateForSkipJob("dead-code").gate).toBeNull();
      expect(gateForSkipJob("test_unit").gate).toBeNull();
    });
  });

  describe("a token spanning more than one job reports what still runs", () => {
    it("reports playwright_e2e as inert now that its jobs left quality.yml", () => {
      // This was the table's one `partial` case: the token named three jobs,
      // only the aggregator had a façade, and reporting a clean swap would
      // have left an operator watching the shards keep running. All three jobs
      // then moved to `playwright-e2e.yml`, which takes no `skip_jobs` — so
      // the token now suppresses nothing in the workflow it is passed to, and
      // `inert` is the whole truth about it rather than half of one.
      const resolved = gateForSkipJob("playwright_e2e");
      expect(resolved.status).toBe("inert");
      expect(resolved.jobs).toEqual([]);
      expect(resolved.gate).toBeNull();
      expect(resolved.ungated).toEqual([]);
    });

    it("has no multi-job token left for `partial` to describe", () => {
      // `partial` is what stops a many-job token being reported as a clean
      // swap, and nothing in the shipped table can reach it today. Asserted
      // rather than left implicit: the case above used to be the only witness,
      // so without this the verdict would quietly become untested, and the
      // next token that names two jobs would be the one to find out.
      const multiJob = Object.entries(SKIP_JOB_TOKENS).filter(
        ([, jobs]) => jobs.length > 1
      );
      expect(multiJob).toEqual([]);
      expect(
        Object.keys(SKIP_JOB_TOKENS).map(token => gateForSkipJob(token).status)
      ).not.toContain("partial");
    });
  });

  describe("every token the workflow documents is answerable", () => {
    it("resolves every entry to a non-unknown status", () => {
      const unanswered = Object.keys(SKIP_JOB_TOKENS).filter(
        token => gateForSkipJob(token).status === "unknown"
      );
      expect(unanswered).toEqual([]);
    });
  });
});
