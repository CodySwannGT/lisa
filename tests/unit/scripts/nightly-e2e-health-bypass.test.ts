/**
 * The nightly e2e gate's truth table, rows 21-25: the TIME-BOXED bootstrap
 * window and the audited bypass, plus verdict assembly and settings resolution.
 *
 * Sibling of `nightly-e2e-health.test.ts` (rows 1-16) and
 * `nightly-e2e-health-api.test.ts` (rows 17-20). Specification:
 * `docs/nightly-e2e-gate.md` §2 (table), §4 (bootstrap), §6 (bypass contract).
 *
 * Two rulings are enforced here because they are the ones a well-meaning
 * refactor erodes first: **bootstrap forgives absence of evidence, never
 * evidence of failure**, and — since the 2026-08-19 amendment — **the bypass is
 * self-service, so the `Nightly-E2E-Bypass:` trailer is the only thing between
 * a bare label and a waiver**.
 */
import fs from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  BRANCH,
  type BypassDecision,
  GUARD_REL,
  type GateModule,
  GREEN_FINDING,
  MISSING_FINDING,
  NOW,
  RED_FINDING,
  loadGateModule,
} from "../../helpers/nightly-e2e-gate-harness";

/** Absolute path of the guard, for the source-level deletion assertion. */
const GUARD_PATH = path.resolve(__dirname, "..", "..", "..", GUARD_REL);

/** A bootstrap window still open at `NOW`. */
const WINDOW_OPEN = "2026-08-20T00:00:00Z";
/** A window that has already lapsed at `NOW`. */
const WINDOW_CLOSED = "2026-08-01T00:00:00Z";
/** The label string the report is rendered with. */
const LABEL = "nightly-e2e-bypass";
/** When the bypass label was applied, in the baseline (3h before `NOW`). */
const APPLIED_AT = "2026-08-12T09:00:00Z";

describe("nightly e2e gate — truth table rows 21-25", () => {
  let mod: GateModule;
  /** No bootstrap window: the gate is fully armed. */
  let armed: ReturnType<GateModule["resolveBootstrap"]>;

  beforeAll(async () => {
    mod = await loadGateModule();
    armed = mod.resolveBootstrap("", 30, NOW);
  });

  describe("rows 23-25 — the bootstrap window is TIME-BOXED", () => {
    it("row 25: an active window renders unknown as non-blocking, with its expiry", () => {
      const bootstrap = mod.resolveBootstrap(WINDOW_OPEN, 30, NOW);
      expect(bootstrap.active).toBe(true);

      const verdict = mod.decide([MISSING_FINDING], { bootstrap });
      expect(verdict.verdict).toBe("bootstrap");
      expect(verdict.blocked).toBe(false);

      const report = mod.formatReport(verdict, {
        branch: BRANCH,
        bypassLabel: LABEL,
      });
      // The expiry is always on screen. There is no quiet bootstrap.
      expect(report).toContain("2026-08-20T00:00:00.000Z");
      expect(report).toContain("Bootstrap window active");
    });

    it("bootstrap forgives ABSENCE of evidence, never EVIDENCE OF FAILURE", () => {
      const bootstrap = mod.resolveBootstrap(WINDOW_OPEN, 30, NOW);
      expect(mod.decide([RED_FINDING], { bootstrap }).blocked).toBe(true);
    });

    it("row 23: an EXPIRED window blocks with no further action", () => {
      const bootstrap = mod.resolveBootstrap(WINDOW_CLOSED, 30, NOW);
      expect(bootstrap.active).toBe(false);

      const verdict = mod.decide([MISSING_FINDING], { bootstrap });
      expect(verdict.verdict).toBe("fail");
      expect(verdict.blocked).toBe(true);
    });

    it("row 24: a window beyond the cap is INVALID CONFIG and fails — never clamped", () => {
      // Clamping would let the window be extended forever by editing one
      // string. That is acmeorga's forever-bootstrap: a suite that never runs
      // passes indefinitely.
      expect(() =>
        mod.resolveBootstrap("2027-01-01T00:00:00Z", 30, NOW)
      ).toThrow(/beyond `bootstrap_max_days`/);
    });

    it("rejects an unparseable bootstrap timestamp", () => {
      expect(() => mod.resolveBootstrap("soon", 30, NOW)).toThrow(/ISO-8601/);
    });

    it("no window at all means the gate is armed immediately", () => {
      expect(armed.active).toBe(false);
      expect(mod.decide([MISSING_FINDING], { bootstrap: armed }).blocked).toBe(
        true
      );
    });
  });

  describe("rows 21-22 — the bypass contract", () => {
    let base: Record<string, unknown>;

    beforeAll(() => {
      base = {
        labelEvent: { actor: "maintainer", createdAt: APPLIED_AT },
        prAuthor: "author",
        prBody:
          "Fixes the red nightly.\nNightly-E2E-Bypass: SE-6899 harness outage\n",
        actorPermission: "maintain",
        maxHours: 24,
        extraReasonPattern: "",
        now: NOW,
      };
    });

    /**
     * Evaluates a bypass with overrides applied to the valid baseline.
     *
     * @param overrides - Fields to change
     * @returns The decision
     */
    const bypassWith = (
      overrides: Record<string, unknown> = {}
    ): BypassDecision => mod.evaluateBypass({ ...base, ...overrides });

    it("row 21: a maintainer-applied, ticketed, unexpired bypass is VALID", () => {
      const decision = bypassWith();
      expect(decision.valid).toBe(true);
      expect(decision.ticket).toBe("SE-6899");
      expect(decision.detail).toBe("harness outage");
      expect(decision.expiresAt).toBe("2026-08-13T09:00:00.000Z");
    });

    it("emits the audit record key-for-key as the contract documents it", () => {
      // §8 makes `audit_json` part of the output schema, so adopters may parse
      // it. A documented shape the code does not emit is worse than none.
      const decision = bypassWith({ prNumber: 123, label: LABEL });
      expect(
        Object.keys(decision)
          .slice()
          .sort((a, b) => a.localeCompare(b))
      ).toEqual([
        "actor",
        "actorPermission",
        "appliedAt",
        "detail",
        "expiresAt",
        "label",
        "prAuthor",
        "prNumber",
        "reason",
        "ticket",
        "valid",
      ]);
      expect(decision.label).toBe(LABEL);
      expect(decision.prNumber).toBe(123);
      expect(decision.actorPermission).toBe("maintain");
      expect(decision.prAuthor).toBe("author");
    });

    it("a REJECTED bypass carries the same keys, so the audit is uniform", () => {
      const decision = bypassWith({
        prNumber: 123,
        label: LABEL,
        actorPermission: "write",
      });
      expect(decision.valid).toBe(false);
      expect(decision.reason).toBe("actor_not_maintainer");
      expect(decision.label).toBe(LABEL);
      expect(decision.prNumber).toBe(123);
    });

    it("row 21: it produces a DISTINCT `bypassed` verdict, not a plain pass", () => {
      const verdict = mod.decide([RED_FINDING], {
        bootstrap: armed,
        bypass: bypassWith(),
      });
      expect(verdict.verdict).toBe("bypassed");
      expect(verdict.blocked).toBe(false);
      expect(verdict.bypass?.waived).toHaveLength(1);

      const report = mod.formatReport(verdict, {
        branch: BRANCH,
        bypassLabel: LABEL,
      });
      expect(report).toContain("Gate bypassed — audited");
      expect(report).toContain("SE-6899");
      expect(report).toContain("maintainer");
    });

    // Owner ruling 2026-08-19: the second-party requirement is REMOVED. It used
    // to reject `self_bypass` whenever the labelling actor matched the PR
    // author, which — across one portfolio repo — rejected 92 of 93 attempts,
    // because on a small team (and on any repo where an agent opens the PR) the
    // author and the only available labeller are the same party. The merges
    // happened regardless, via an admin bypass that records nothing. See §6.
    it("row 21: the PR AUTHOR may waive their OWN PR — the bypass is self-service", () => {
      const decision = bypassWith({
        labelEvent: { actor: "author", createdAt: APPLIED_AT },
      });
      expect(decision.valid).toBe(true);
      expect(decision.reason).toBe("valid");
      // The applier is still RECORDED. Self-service removed the second party,
      // not the audit trail.
      expect(decision.actor).toBe("author");
      expect(decision.prAuthor).toBe("author");
      expect(decision.ticket).toBe("SE-6899");
      expect(decision.expiresAt).toBe("2026-08-13T09:00:00.000Z");
    });

    it("row 21: a self-applied waiver still produces the `bypassed` verdict", () => {
      const verdict = mod.decide([RED_FINDING], {
        bootstrap: armed,
        bypass: bypassWith({
          labelEvent: { actor: "author", createdAt: APPLIED_AT },
        }),
      });
      expect(verdict.verdict).toBe("bypassed");
      expect(verdict.blocked).toBe(false);
      expect(
        mod.formatReport(verdict, { branch: BRANCH, bypassLabel: LABEL })
      ).toContain("Gate bypassed — audited");
    });

    it("`self_bypass` is gone entirely, not merely unreachable", () => {
      // A condition that can never fire is indistinguishable from one nobody
      // has noticed is broken, so the branch was deleted rather than disabled.
      const source = fs.readFileSync(GUARD_PATH, "utf8");
      expect(source).not.toContain('reject("self_bypass")');
    });

    it("row 22: a non-maintainer may not bypass", () => {
      for (const permission of ["write", "read", "triage", null]) {
        const decision = bypassWith({ actorPermission: permission });
        expect(decision.valid).toBe(false);
        expect(decision.reason).toBe("actor_not_maintainer");
      }
      expect(bypassWith({ actorPermission: "admin" }).valid).toBe(true);
    });

    // With the author check gone, this trailer is the ONLY thing between a bare
    // label and a waiver. It carries weight it did not carry before, so every
    // malformed shape is pinned rather than just the empty one.
    it("row 22: a MALFORMED bypass trailer is rejected — the last line of defence", () => {
      for (const prBody of [
        "just let me merge",
        // Label with no trailer at all.
        "",
        // Ticket but no reason.
        "Nightly-E2E-Bypass: SE-6899",
        "Nightly-E2E-Bypass: SE-6899   ",
        // Reason but no ticket.
        "Nightly-E2E-Bypass: harness outage",
        // Lowercase / malformed ticket key.
        "Nightly-E2E-Bypass: se-6899 harness outage",
        "Nightly-E2E-Bypass: 6899 harness outage",
        // Trailer name misspelled.
        "Nightly-E2E-Waiver: SE-6899 harness outage",
      ]) {
        const decision = bypassWith({ prBody });
        expect(decision.valid).toBe(false);
        expect(decision.reason).toBe("no_reason_or_ticket");
      }
    });

    it("row 21: a `#NNN` issue reference is a valid ticket, with a reason", () => {
      const decision = bypassWith({
        prBody: "Nightly-E2E-Bypass: #123 harness outage\n",
      });
      expect(decision.valid).toBe(true);
      expect(decision.ticket).toBe("#123");
    });

    it("row 22: a bypass past `bypass_max_hours` is EXPIRED", () => {
      expect(
        bypassWith({
          labelEvent: {
            actor: "maintainer",
            createdAt: "2026-08-10T09:00:00Z",
          },
        }).reason
      ).toBe("bypass_expired");
    });

    it("row 22: the max lifetime is hard-capped whatever the caller asks", () => {
      const decision = bypassWith({
        maxHours: 24 * 365,
        labelEvent: { actor: "maintainer", createdAt: "2026-08-05T09:00:00Z" },
      });
      expect(decision.reason).toBe("bypass_expired");
      expect(mod.BYPASS_ABSOLUTE_MAX_HOURS).toBe(72);
    });

    describe("allowlist doctrine — a caller may tighten, never loosen", () => {
      // Portfolio doctrine from WS-0a: a security gate is an ALLOWLIST and its
      // limits are SOURCE CONSTANTS. An env-readable limit fails OPEN on the
      // inputs nobody tests — an unset variable, a typo, a new deployment. Both
      // holes pinned below were real in this file before the doctrine landed.

      it("the built-in reason rule ALWAYS applies — `.*` cannot stand in for it", () => {
        // The hole: a caller-supplied pattern that REPLACED the built-in one
        // would let `.*` satisfy "a reason and a ticket are required" against an
        // empty PR body.
        const decision = bypassWith({
          prBody: "no reason here at all",
          extraReasonPattern: ".*",
        });
        expect(decision.valid).toBe(false);
        expect(decision.reason).toBe("no_reason_or_ticket");
      });

      it("a caller-supplied pattern is an AND — it can only narrow", () => {
        // Body satisfies the built-in rule but not the project's extra rule.
        expect(
          bypassWith({ extraReasonPattern: "^Approved-By: .+$" }).valid
        ).toBe(false);
        // Both satisfied.
        expect(
          bypassWith({
            prBody:
              "Nightly-E2E-Bypass: SE-6899 harness outage\nApproved-By: someone\n",
            extraReasonPattern: "^Approved-By: .+$",
          }).valid
        ).toBe(true);
      });

      it("the permitted-role set is an ALLOWLIST, not a denylist of known-bad roles", () => {
        // A denylist admits any role GitHub adds tomorrow. Two roles in, and a
        // role nobody has heard of stays out.
        expect(
          [...mod.BYPASS_PERMISSIONS].slice().sort((a, b) => a.localeCompare(b))
        ).toEqual(["admin", "maintain"]);
        expect(bypassWith({ actorPermission: "some_future_role" }).valid).toBe(
          false
        );
      });
    });

    it("row 22: an unattributable label (fork PR, unreadable timeline) is rejected", () => {
      expect(bypassWith({ labelEvent: null }).reason).toBe(
        "no_attributable_actor"
      );
    });

    it("row 22: an INVALID bypass leaves the gate RED and says which rule failed", () => {
      const verdict = mod.decide([RED_FINDING], {
        bootstrap: armed,
        bypass: bypassWith({ prBody: "just let me merge" }),
      });
      expect(verdict.blocked).toBe(true);

      const report = mod.formatReport(verdict, {
        branch: BRANCH,
        bypassLabel: LABEL,
      });
      expect(report).toContain("REJECTED");
      expect(report).toContain(
        "carries no `Nightly-E2E-Bypass: <TICKET> <reason>` line"
      );
    });

    it("a stale label on a green PR waived nothing and says nothing", () => {
      const verdict = mod.decide([GREEN_FINDING], {
        bootstrap: armed,
        bypass: bypassWith(),
      });
      expect(verdict.verdict).toBe("pass");
      expect(verdict.bypass).toBeNull();
    });

    it("the report tells a blocked author to prefer the audited bypass, and why", () => {
      const verdict = mod.decide([RED_FINDING], { bootstrap: armed });
      const report = mod.formatReport(verdict, {
        branch: BRANCH,
        bypassLabel: LABEL,
      });
      expect(report).toContain("waive the gate yourself");
      expect(report).toContain("You may apply it to your own PR");
      // The reason to prefer it is the audit record, not exclusivity.
      expect(report).toContain(
        "the only way past this gate that records who waived it"
      );
    });

    // Regression guard for the 2026-08-19 amendment to the bypass contract.
    // The report used to assert "There is no admin-merge-past-red", which was
    // true of the ruleset Lisa ships and false of every deployment measured —
    // all of which had added a `RepositoryRole` bypass actor. A gate cannot
    // know its consumer's ruleset, so it must not make the claim at all.
    it("the report never claims an admin merge is impossible", () => {
      const verdict = mod.decide([RED_FINDING], { bootstrap: armed });
      const report = mod.formatReport(verdict, {
        branch: BRANCH,
        bypassLabel: LABEL,
      });
      expect(report).not.toContain("no admin-merge-past-red");
      expect(report).not.toContain("only sanctioned path");
      // It points the reader at the one place that CAN answer instead.
      expect(report).toContain("bypass actors");
    });
  });

  describe("verdict assembly", () => {
    it("the worst suite decides the whole verdict", () => {
      const verdict = mod.decide(
        [{ ...GREEN_FINDING, label: "green" }, RED_FINDING],
        { bootstrap: armed }
      );
      expect(verdict.verdict).toBe("fail");
    });

    it("all green is a plain pass", () => {
      const verdict = mod.decide([GREEN_FINDING], { bootstrap: armed });
      expect(verdict.verdict).toBe("pass");
      expect(verdict.blocked).toBe(false);
    });
  });

  describe("settings resolution fails loudly rather than measuring nothing", () => {
    const suites = JSON.stringify([
      { label: "one", workflow: "a.yml", match: { mode: "run" } },
    ]);

    it("refuses to run without a token, a repository, or a branch", () => {
      const complete = {
        GITHUB_TOKEN: "t",
        GITHUB_REPOSITORY: "o/r",
        NIGHTLY_BRANCH: BRANCH,
        NIGHTLY_SUITES: suites,
      };
      const cases: readonly (readonly [string, RegExp])[] = [
        ["GITHUB_TOKEN", /GITHUB_TOKEN/],
        ["GITHUB_REPOSITORY", /GITHUB_REPOSITORY/],
        ["NIGHTLY_BRANCH", /must know which branch/],
      ];
      for (const [omitted, matcher] of cases) {
        const env: Record<string, string | undefined> = { ...complete };
        delete env[omitted];
        expect(() => mod.resolveSettings(env)).toThrow(matcher);
      }
      expect(() => mod.resolveSettings(complete)).not.toThrow();
    });

    it("carries a semver contract version the workflow can assert", () => {
      expect(mod.NIGHTLY_E2E_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
