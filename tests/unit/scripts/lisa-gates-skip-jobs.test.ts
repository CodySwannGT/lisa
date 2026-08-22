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
  // These two read as derivable and are not. The registry had no word for
  // either property until these ids were invented for them, and neither id
  // shares a substring with its token — a transform would answer `null` for
  // one and a wrong guess for the other. `state_classification` is the third
  // of the same batch and IS the underscore-to-hyphen transform of its token,
  // so it is covered by the integration suite rather than pinned here.
  ["e2e_coverage", "journey-coverage"],
  ["floor_collisions", "security-floor-integrity"],
];

/**
 * Tokens whose job the registry still has no word for.
 *
 * Every one of these is recorded in `UNGATED_QUALITY_JOBS` with a reason and
 * the issue that decides it, which is what separates a gap from an oversight.
 * `tests/integration/quality-ungated-jobs.test.ts` holds that table against
 * this list, so a token cannot leave this array without either acquiring a
 * gate or acquiring a written exemption — and cannot stay in it once a gate
 * exists.
 */
const UNMAPPABLE = [
  "maestro_e2e",
  "bdd_coverage",
  "learnings_budget",
  "threshold_ratchet",
  "skipped_required_checks",
  "zap_baseline",
  "sonarcloud",
  "snyk",
  "secret_scanning",
  "license_compliance",
];

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
    it.each(UNMAPPABLE)("reports %s as unmappable with a null gate", token => {
      const resolved = gateForSkipJob(token);
      expect(resolved.status).toBe("unmappable");
      expect(resolved.gate).toBeNull();
      expect(resolved.gates).toEqual([]);
      expect(resolved.jobs.length).toBeGreaterThan(0);
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
