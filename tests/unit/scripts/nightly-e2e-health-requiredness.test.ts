/**
 * The reporter's blocking claim — contract §10.7.
 *
 * Until this shipped, every tracking issue Lisa filed said, unconditionally:
 *
 *   > Pull requests into `dev` are blocked until this suite is green again.
 *
 * That was a hardcoded assertion about somebody else's branch ruleset, and it
 * was measurably FALSE. `GET /repos/TunnlAI/frontend/rules/branches/dev`
 * returns twelve required contexts and not one of them matches this gate — the
 * suite blocked nothing, while people applied audited `nightly-e2e-bypass`
 * labels to clear a gate that was not gating. An issue that misstates its own
 * consequences is worse than one that says nothing, because it gets acted on.
 *
 * So the claim is now MEASURED, and it has three states — `required`,
 * `not_required`, `unknown`. The third is the one this file spends the most
 * cases on, and deliberately: it is the whole doctrine of this guard applied to
 * its own reporting half. "We could not check" must never render as an answer,
 * and here it could render as an answer in EITHER direction — a false
 * `not_required` tells someone to ignore a gate that is holding every PR they
 * have open, and a false `required` sends them to burn a waiver they do not
 * need.
 *
 * ## These are bite controls, not coverage
 *
 * The failure mode being defended against is not an exception — it is a
 * *sentence*. A guard that renders the right prose in the case someone was
 * looking at, and the old hardcoded prose everywhere else, passes any test that
 * only ever observes the happy path. So the cases below are written to
 * DISCRIMINATE: several assert what the body must NOT say, and
 * `the three states are mutually exclusive` fails if any two states ever render
 * the same claim — which is exactly what a regression to a hardcoded string
 * would produce.
 *
 * Specification: `docs/nightly-e2e-gate.md` §10.7.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  BRANCH,
  type Finding,
  GATE_CONTEXT,
  type GateModule,
  type IssuePlanEntry,
  NOW,
  REASON,
  REQUIRED_STATE,
  STATE,
  TEST_API,
  type TrackedIssue,
  fakeResponse,
  loadGateModule,
  noWait,
  requiredChecksRule,
} from "../../helpers/nightly-e2e-gate-harness";

/** The suite every case speaks about. */
const LABEL = "Maestro native e2e";

/** The sentence the old reporter printed unconditionally. */
const BLOCKED_CLAIM = "are blocked until this suite is green again";

/** The audited bypass label, as the gate's own default names it. */
const BYPASS_LABEL = "nightly-e2e-bypass";

/** The line the PR body must carry for a waiver to be valid. */
const BYPASS_RECIPE = "Nightly-E2E-Bypass:";

/** The sentence an ungated suite prints instead of the blocking claim. */
const UNGATED_CLAIM = "does **not** gate merges";

/**
 * A red finding.
 *
 * @param overrides - Field overrides
 * @returns A finding
 */
function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    label: LABEL,
    state: STATE.fail,
    reason: REASON.runConclusion,
    conclusion: "failure",
    url: "https://example.test/run/1",
    ...overrides,
  } as Finding;
}

describe("nightly e2e reporting — §10.7, the blocking claim is measured", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  /**
   * Reporting context at one requiredness state.
   *
   * @param state - The measured state
   * @param detail - Why, when it is `unknown`
   * @returns A context `planIssueActions` accepts
   */
  function context(
    state: string,
    detail: string | null = null
  ): Record<string, unknown> {
    return {
      branch: BRANCH,
      label: "nightly-e2e",
      now: NOW,
      gateContext: GATE_CONTEXT,
      bypassLabel: BYPASS_LABEL,
      requiredness: { state, detail, contexts: [] },
    };
  }

  /**
   * Plans one suite and returns its entry.
   *
   * @param one - The finding
   * @param state - The measured requiredness
   * @param open - Already-open issues
   * @returns The single plan entry
   */
  function planOne(
    one: Finding,
    state: string,
    open: readonly TrackedIssue[] = []
  ): IssuePlanEntry {
    const plan = mod.planIssueActions([one], open, context(state));
    expect(plan).toHaveLength(1);
    return plan[0] as IssuePlanEntry;
  }

  // -------------------------------------------------------------------------
  // Measuring it
  // -------------------------------------------------------------------------

  describe("reading the branch rules", () => {
    it("reads the EFFECTIVE rules endpoint, and only ever reads", async () => {
      const seen: { url: string; method: string }[] = [];
      (globalThis as { fetch: unknown }).fetch = async (
        url: string,
        init?: { method?: string }
      ): Promise<unknown> => {
        seen.push({ url: String(url), method: init?.method ?? "GET" });
        return fakeResponse(200, {}, [requiredChecksRule([GATE_CONTEXT])]);
      };
      await mod.fetchRequiredness(TEST_API, BRANCH, GATE_CONTEXT, noWait);
      // `/rules/branches/` and not `/branches/{b}/protection`: the former
      // returns the rules in EFFECT from every source, so a context required by
      // an ORG-level ruleset is seen. Reading one repository ruleset by id
      // would render an org-gated branch as `not_required`.
      expect(seen[0]?.url).toContain(`/repos/o/r/rules/branches/${BRANCH}`);
      expect(seen.every(call => call.method === "GET")).toBe(true);
    });

    it("`required` when a matching context is in effect", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(200, {}, [
          requiredChecksRule([
            "🔍 Quality Checks / 🧹 Lint",
            GATE_CONTEXT,
            "CodeRabbit",
          ]),
        ]);
      const measured = await mod.fetchRequiredness(
        TEST_API,
        BRANCH,
        GATE_CONTEXT,
        noWait
      );
      expect(measured.state).toBe(REQUIRED_STATE.required);
      expect(measured.contexts).toContain("CodeRabbit");
    });

    it("`not_required` when the branch has rules but none is this gate", async () => {
      // This is TunnlAI/frontend's `dev`, measured 2026-08-18: twelve required
      // contexts, none of them the nightly gate. The branch IS protected — so
      // "there are rules" must not be mistaken for "this gate is one of them".
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(200, {}, [
          requiredChecksRule([
            "🔍 Quality Checks / 🧪 Run Unit Tests",
            "🔍 Quality Checks / 🔒 Security Scan",
            "CodeRabbit",
            "SonarCloud Code Analysis",
          ]),
        ]);
      const measured = await mod.fetchRequiredness(
        TEST_API,
        BRANCH,
        GATE_CONTEXT,
        noWait
      );
      expect(measured.state).toBe(REQUIRED_STATE.notRequired);
    });

    it("`not_required` for a branch with no rules at all — 200 `[]` IS an answer", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(200, {}, []);
      const measured = await mod.fetchRequiredness(
        TEST_API,
        BRANCH,
        GATE_CONTEXT,
        noWait
      );
      expect(measured.state).toBe(REQUIRED_STATE.notRequired);
    });

    it("BITE: `unknown` when the body is not a list of rules", async () => {
      // The third `unknown` branch. A shape this endpoint should never return
      // must not read as "no rules" — and must not throw either: without the
      // `Array.isArray` guard the body flows straight into `.filter`/`.flatMap`
      // and takes down the reporter, which is §10.4's forbidden outcome
      // (a notification channel becoming an outage).
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(200, {}, { message: "not a list" });
      const measured = await mod.fetchRequiredness(
        TEST_API,
        BRANCH,
        GATE_CONTEXT,
        noWait
      );
      expect(measured.state).toBe(REQUIRED_STATE.unknown);
      expect(measured.state).not.toBe(REQUIRED_STATE.notRequired);
      expect(measured.detail).toContain("not a list of rules");
    });

    // ---- BITE CONTROL: the unknown state ----------------------------------

    it("BITE: `unknown` when the API stays unreadable — never a claim either way", async () => {
      // The control that matters. A reporter that answered `not_required` here
      // would print "nothing is blocking you" because it was not allowed to
      // look, on every issue, every night. Five hundreds exhaust `apiGet`'s
      // bounded retry and it RAISES; `fetchRequiredness` must absorb that.
      let calls = 0;
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> => {
        calls += 1;
        return fakeResponse(500, {}, {});
      };
      const measured = await mod.fetchRequiredness(
        TEST_API,
        BRANCH,
        GATE_CONTEXT,
        noWait
      );
      expect(calls).toBe(TEST_API.maxAttempts);
      expect(measured.state).toBe(REQUIRED_STATE.unknown);
      expect(measured.state).not.toBe(REQUIRED_STATE.notRequired);
      expect(measured.state).not.toBe(REQUIRED_STATE.required);
      // And it says WHY, because "unknown" with no reason is unactionable.
      expect(measured.detail).toBeTruthy();
    });

    it("BITE: `unknown` on a 403 the token cannot retry its way out of", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(403, { "x-ratelimit-remaining": "4999" }, {});
      const measured = await mod.fetchRequiredness(
        TEST_API,
        BRANCH,
        GATE_CONTEXT,
        noWait
      );
      expect(measured.state).toBe(REQUIRED_STATE.unknown);
    });

    it("BITE: `unknown` on a network error, not a thrown reporter", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> => {
        throw new Error("ECONNRESET");
      };
      const measured = await mod.fetchRequiredness(
        TEST_API,
        BRANCH,
        GATE_CONTEXT,
        noWait
      );
      expect(measured.state).toBe(REQUIRED_STATE.unknown);
      expect(measured.detail).toContain("ECONNRESET");
    });

    it("BITE: 404 is `unknown`, NOT `not_required`", async () => {
      // The subtlest of the three. `apiGet` maps 404 to `null`, and a 404 here
      // means the branch or repo is invisible to this token — which is a
      // failure to observe, not an observation of "no rules". A branch that
      // genuinely has none answers `200 []` (asserted above). Collapsing the
      // two is how "we were not allowed to look" becomes "you are not blocked".
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(404, {}, {});
      const measured = await mod.fetchRequiredness(
        TEST_API,
        BRANCH,
        GATE_CONTEXT,
        noWait
      );
      expect(measured.state).toBe(REQUIRED_STATE.unknown);
      expect(measured.state).not.toBe(REQUIRED_STATE.notRequired);
    });
  });

  // -------------------------------------------------------------------------
  // Matching the context
  // -------------------------------------------------------------------------

  describe("which context counts as this gate", () => {
    it("matches the composite the reusable publishes, and the bare caller half", () => {
      // Both strings were measured live on 2026-08-18: gemini's `dev` requires
      // the composite (it calls Lisa's reusable), propswap's `dev` requires the
      // bare name (its local fork is a single job). Both ARE the gate, and
      // string equality alone would report propswap's genuinely-blocked branch
      // as `not_required` — a false all-clear.
      expect(mod.contextMatchesGate(GATE_CONTEXT, GATE_CONTEXT)).toBe(true);
      expect(
        mod.contextMatchesGate("🌙 Nightly E2E Health", GATE_CONTEXT)
      ).toBe(true);
      expect(
        mod.contextMatchesGate(
          "🌙 Nightly E2E Health / 🌙 Gate / inner",
          GATE_CONTEXT
        )
      ).toBe(true);
    });

    it("is not a substring test — a neighbouring check is not this gate", () => {
      // `includes()` would match all three of these, and each is a different
      // check somebody could plausibly add beside the gate.
      for (const near of [
        "🌙 Nightly E2E Health (advisory)",
        "pre-🌙 Nightly E2E Health",
        "🌙 Nightly E2E Health Report",
      ]) {
        expect(mod.contextMatchesGate(near, GATE_CONTEXT)).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Rendering it
  // -------------------------------------------------------------------------

  describe("what the issue says", () => {
    it("`required`: the blocking claim survives — it was never wrong, only unconditional", () => {
      const entry = planOne(finding(), REQUIRED_STATE.required);
      expect(entry.body).toContain(BLOCKED_CLAIM);
      expect(entry.title).toContain("blocking merges");
      // And the full audited-bypass recipe, because here a waiver buys
      // something real.
      expect(entry.body).toContain(BYPASS_LABEL);
      expect(entry.body).toContain(BYPASS_RECIPE);
    });

    it("BITE: `not_required` NEVER says merges are blocked", () => {
      const entry = planOne(finding(), REQUIRED_STATE.notRequired);
      expect(entry.body).not.toContain(BLOCKED_CLAIM);
      expect(entry.body).toContain(UNGATED_CLAIM);
      expect(entry.title).toContain("not blocking merges");
      // It still says to fix the suite. "Not blocking" must not read as
      // "ignore this" — a nightly nobody fixes stops being evidence at all.
      expect(entry.body).toContain("Fixing it is still the point");
    });

    it("BITE: `not_required` tells the reader the bypass label would waive NOTHING", () => {
      // The measured harm this replaces: bypass labels applied in TunnlAI's
      // frontend to clear a gate that was not gating. A waiver recipe printed
      // unconditionally is what taught people to do that.
      const entry = planOne(finding(), REQUIRED_STATE.notRequired);
      expect(entry.body).toContain("would waive nothing");
      expect(entry.body).not.toContain(BYPASS_RECIPE);
    });

    it("BITE: `unknown` claims NEITHER — not blocked, and not unblocked", () => {
      const entry = planOne(finding(), REQUIRED_STATE.unknown);
      expect(entry.body).not.toContain(BLOCKED_CLAIM);
      expect(entry.body).not.toContain(UNGATED_CLAIM);
      expect(entry.body).not.toContain("would waive nothing");
      expect(entry.body).toContain("Not known");
      expect(entry.title).toContain("merge impact unknown");
    });

    it("BITE: the three states are mutually exclusive claims", () => {
      // The control that catches a regression to a hardcoded sentence. If
      // anyone reintroduces an unconditional claim, two of these three bodies
      // become equal on that sentence and this fails — whereas a test that only
      // ever renders one state would sail past it.
      const bodies = [
        REQUIRED_STATE.required,
        REQUIRED_STATE.notRequired,
        REQUIRED_STATE.unknown,
      ].map(state => String(planOne(finding(), state).body));
      expect(new Set(bodies).size).toBe(3);
      // Exactly ONE of the three may claim merges are blocked.
      expect(bodies.filter(body => body.includes(BLOCKED_CLAIM))).toHaveLength(
        1
      );
      // The waiver recipe is printed by TWO of the three, and that asymmetry is
      // deliberate rather than sloppy. `not_required` must never print it —
      // that is the measured harm. `unknown` must, because withholding it would
      // strand somebody who really is blocked with no path forward; it is
      // printed behind an explicit "confirm whether the gate is required first"
      // caveat, which `required` does not carry. Both halves are asserted so a
      // regression that drops the caveat, or that prints the recipe
      // unconditionally, still fails.
      const [required, notRequired, unknown] = bodies;
      expect(required).toContain(BYPASS_RECIPE);
      expect(notRequired).not.toContain(BYPASS_RECIPE);
      expect(unknown).toContain(BYPASS_RECIPE);
      expect(unknown).toContain("Confirm first whether the gate is actually");
      expect(required).not.toContain("Confirm first whether the gate is");
    });

    it("the details table states the measurement, so it is auditable", () => {
      expect(planOne(finding(), REQUIRED_STATE.required).body).toContain(
        `\`${GATE_CONTEXT}\` is a required status check`
      );
      expect(planOne(finding(), REQUIRED_STATE.unknown).body).toContain(
        "unknown — the branch rules could not be read"
      );
    });

    it("BITE: the ALL-CLEAR carries the claim too", () => {
      // The close comment is the last thing anyone reads on this issue and the
      // line that gets quoted in a standup. An all-clear announcing that merges
      // are unblocked, about a gate that never blocked anything, is the same
      // falsehood as the one at the top of the body — and harder to catch,
      // because everybody is relieved.
      const green = finding({ state: STATE.pass, conclusion: "success" });
      const open = [
        {
          number: 41,
          body: String(planOne(finding(), REQUIRED_STATE.required).body),
        },
      ];
      const blocked = planOne(green, REQUIRED_STATE.required, open);
      const free = planOne(green, REQUIRED_STATE.notRequired, open);
      const dunno = planOne(green, REQUIRED_STATE.unknown, open);
      expect(blocked.comment).toContain("no longer held by this suite");
      expect(free.comment).toContain("so nothing was blocked while it was red");
      expect(free.comment).not.toContain("no longer held");
      expect(dunno.comment).toContain("could not be read");
      expect(dunno.comment).not.toContain("no longer held");
      expect(new Set([blocked.comment, free.comment, dunno.comment]).size).toBe(
        3
      );
    });

    it("the job log states the measurement as well as the issues", () => {
      const results = [
        {
          label: LABEL,
          action: "create",
          ok: true,
          issues: [7],
          error: null,
        },
      ];
      const log = mod.formatIssueReport(results, {
        branch: BRANCH,
        gateContext: GATE_CONTEXT,
        requiredness: {
          state: REQUIRED_STATE.notRequired,
          detail: null,
          contexts: [],
        },
      });
      expect(log).toContain("not required");
      expect(log).toContain("blocks nothing");
    });
  });

  // -------------------------------------------------------------------------
  // The per-suite `gated` flag
  // -------------------------------------------------------------------------

  describe("`gated: false` — a suite that is tracked but does not gate", () => {
    it("is accepted by the schema validator, as a boolean and nothing else", () => {
      const table = (gated: unknown): string =>
        JSON.stringify([
          { label: "s", workflow: "e2e.yml", match: { mode: "run" }, gated },
        ]);
      expect(mod.validateSuites(table(false))).toHaveLength(1);
      expect(mod.validateSuites(table(true))).toHaveLength(1);
      // A string "false" is TRUTHY, and a suite that believed it was ungated
      // while claiming to block merges is the exact confusion this removes.
      expect(() => mod.validateSuites(table("false"))).toThrow(/boolean/);
    });

    it("BITE: an ungated suite does NOT say merges are blocked", () => {
      // propswap's requirement, in their words: "an ungated suite that claimed
      // to block merges would be crying wolf." Note the branch measurement here
      // is `required` — the suite-level opt-out has to win over it, or the flag
      // does nothing on precisely the repos that have a gate at all.
      const entry = planOne(
        finding({ gated: false } as Partial<Finding>),
        REQUIRED_STATE.required
      );
      expect(entry.body).not.toContain(BLOCKED_CLAIM);
      expect(entry.body).toContain(UNGATED_CLAIM);
      expect(entry.body).toContain('`"gated": false`');
      expect(entry.title).toContain("not blocking merges");
      expect(entry.requiredness).toBe(REQUIRED_STATE.notRequired);
    });

    it("BITE: `gated: true` cannot MANUFACTURE a blocking claim", () => {
      // The asymmetry, and the reason this is a narrowing override rather than
      // a switch. A suite table is written by whoever owns the suite; the
      // branch ruleset is written by whoever owns the branch. Letting the first
      // assert a merge consequence the second does not impose would put the
      // false "you are blocked" sentence back, just spelled differently.
      const entry = planOne(
        finding({ gated: true } as Partial<Finding>),
        REQUIRED_STATE.notRequired
      );
      expect(entry.requiredness).toBe(REQUIRED_STATE.notRequired);
      expect(entry.body).not.toContain(BLOCKED_CLAIM);
    });

    it("`gated: false` does not silence the issue — it is still filed and refreshed", () => {
      // Ungated is not untracked. The suite still gets its state mirror; only
      // the merge-consequence sentence changes.
      const entry = planOne(
        finding({ gated: false } as Partial<Finding>),
        REQUIRED_STATE.notRequired
      );
      expect(entry.action).toBe("create");
      expect(entry.body).toContain(LABEL);
    });

    it("an untouched suite table behaves exactly as before the flag existed", () => {
      const withoutFlag = planOne(finding(), REQUIRED_STATE.required);
      expect(withoutFlag.body).toContain(BLOCKED_CLAIM);
      expect(withoutFlag.requiredness).toBe(REQUIRED_STATE.required);
    });
  });

  // -------------------------------------------------------------------------
  // A caller that predates all of this
  // -------------------------------------------------------------------------

  it("BITE: a context carrying NO measurement renders `unknown`, and does not throw", () => {
    // Skew direction: a new guard under an older reporting caller. It must not
    // crash — the reporting half going down is how people stop hearing that a
    // suite is red — and it must not fall back to the old hardcoded claim.
    const plan = mod.planIssueActions([finding()], [], {
      branch: BRANCH,
      label: "nightly-e2e",
      now: NOW,
    } as unknown as Record<string, unknown>);
    expect(plan[0]?.requiredness).toBe(REQUIRED_STATE.unknown);
    expect(plan[0]?.body).not.toContain(BLOCKED_CLAIM);
  });
});
