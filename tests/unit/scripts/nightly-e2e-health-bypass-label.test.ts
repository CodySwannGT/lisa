/**
 * The nightly e2e gate, contract **§10.9**: a gate may not be armed while the
 * escape hatch it documents does not exist.
 *
 * §6 names the audited `nightly-e2e-bypass` label the PREFERRED way past a red
 * gate, and the reporter prints the recipe for it in every tracking issue it
 * files for an armed gate. That recipe only works if the label exists. Measured
 * across four adopters on 2026-08-19: two had the gate required by an active
 * ruleset and no bypass label at all. On those two the documented path was
 * unreachable and the only remaining exit was the unaudited admin merge — the
 * exact destination the bypass contract was written to prevent, reached by
 * following the printed instructions to the letter.
 *
 * ## The same harm as row 40, from the opposite direction
 *
 * Row 40 fixed the case where the label EXISTED, was applied, and the gate read
 * a frozen event payload from before it was applied — so the operator did
 * everything right and was still routed to admin merge. This is the case where
 * the operator does everything right and there is no label to apply. Both end
 * on the unaudited merge; only the cause differs.
 *
 * ## These are bite controls, not coverage
 *
 * The failure being defended against is a *sentence that cannot be acted on*, so
 * a renderer that prints the defect in the case someone was looking at and the
 * old text everywhere else would pass any happy-path suite. Three properties are
 * therefore asserted directly:
 *
 *   - the NEGATIVE CONTROL — a repository whose label exists renders byte for
 *     byte what a caller that never asked renders, which is the pre-§10.9
 *     rendering path still present in this same file;
 *   - unreadable is NEVER `present` and never `absent` — the state this guard
 *     must not invent is the one claiming an escape hatch is there;
 *   - the measurement is not merely unrendered but UNASKED on a branch the gate
 *     does not guard, so "not reported when nothing is gated" is a property of
 *     the wire rather than of a renderer someone can edit.
 *
 * Specification: `docs/nightly-e2e-gate.md` §10.9.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BRANCH,
  type BypassLabelState,
  type Finding,
  GATE_CONTEXT,
  type GateModule,
  GREEN_JOB,
  type IssuePlanEntry,
  LABEL_STATE,
  NOW,
  REASON,
  REQUIRED_STATE,
  type RulesetSource,
  STATE,
  TEST_API,
  fakeResponse,
  loadGateModule,
  noWait,
  requiredChecksRule,
} from "../../helpers/nightly-e2e-gate-harness";

/** The audited bypass label, as the gate's own default names it. */
const LABEL = "nightly-e2e-bypass";

/** The suite every case speaks about. */
const SUITE_LABEL = "Maestro native e2e";

/** The line that makes the defect unmistakable in an issue body. */
const DEFECT = "armed with no escape hatch";

/** The GitHub alert marker the defect block leads with. */
const CAUTION = "> [!CAUTION]";

/** The GitHub alert marker the unreadable hedge leads with. */
const WARNING = "> [!WARNING]";

/** The first line of the waiver recipe, present in every armed-gate issue. */
const RECIPE = `1. Apply the \`${LABEL}\` label to the pull request.`;

/**
 * A red finding — the state that makes the reporter print a waiver recipe.
 *
 * @param overrides - Field overrides
 * @returns A finding
 */
function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    label: SUITE_LABEL,
    state: STATE.fail,
    reason: REASON.runConclusion,
    conclusion: "failure",
    url: "https://example.test/run/1",
    ...overrides,
  } as Finding;
}

/** A repository ruleset that requires this gate, as the API reports its source. */
const REPO_RULESET: RulesetSource = Object.freeze({
  sourceType: "Repository",
  source: "o/r",
  id: 1,
});

describe("nightly e2e reporting — §10.9, the escape hatch is measured", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  /**
   * Reporting context at one requiredness state and one label state.
   *
   * @param state - The measured requiredness
   * @param bypassLabelState - The measured label state, or omitted to model a
   *   caller that never asked
   * @param rulesets - The rule sources requiredness matched
   * @returns A context `planIssueActions` accepts
   */
  function context(
    state: string,
    bypassLabelState?: BypassLabelState,
    rulesets: readonly RulesetSource[] = [REPO_RULESET]
  ): Record<string, unknown> {
    return {
      branch: BRANCH,
      label: "nightly-e2e",
      now: NOW,
      gateContext: GATE_CONTEXT,
      bypassLabel: LABEL,
      requiredness: { state, detail: null, contexts: [], rulesets },
      ...(bypassLabelState ? { bypassLabelState } : {}),
    };
  }

  /**
   * The issue body one suite gets under one context.
   *
   * @param state - The measured requiredness
   * @param bypassLabelState - The measured label state, or omitted
   * @param rulesets - The rule sources requiredness matched
   * @returns The rendered body
   */
  function bodyFor(
    state: string,
    bypassLabelState?: BypassLabelState,
    rulesets: readonly RulesetSource[] = [REPO_RULESET]
  ): string {
    const plan = mod.planIssueActions(
      [finding()],
      [],
      context(state, bypassLabelState, rulesets) as never
    );
    const entry = plan[0] as IssuePlanEntry;
    expect(entry.body).toBeTruthy();
    return entry.body as string;
  }

  // -------------------------------------------------------------------------
  // Measuring it
  // -------------------------------------------------------------------------

  describe("reading whether the label exists", () => {
    it("asks the repository's own labels endpoint by name, and only ever reads", async () => {
      const seen: { url: string; method: string }[] = [];
      (globalThis as { fetch: unknown }).fetch = async (
        url: string,
        init?: { method?: string }
      ): Promise<unknown> => {
        seen.push({ url: String(url), method: init?.method ?? "GET" });
        return fakeResponse(200, {}, { name: LABEL });
      };
      await mod.fetchBypassLabelState(TEST_API, LABEL, noWait);
      expect(seen[0]?.url).toBe(`https://api.test/repos/o/r/labels/${LABEL}`);
      expect(seen.every(call => call.method === "GET")).toBe(true);
    });

    it("`present` when the label exists", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(200, {}, { name: LABEL, color: "B60205" });
      const measured = await mod.fetchBypassLabelState(TEST_API, LABEL, noWait);
      expect(measured.state).toBe(LABEL_STATE.present);
    });

    it("`absent` on a 404 — on THIS endpoint a 404 is the label, not the repository", async () => {
      // Unlike `/rules/branches/{b}`, where a 404 conflates "no rules" with
      // "not allowed to look", this measurement is only ever acted on after the
      // branch rules came back `200` from the same repository. Visibility is
      // already proven; what is left for a 404 to mean is the label.
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(404, {}, { message: "Not Found" });
      const measured = await mod.fetchBypassLabelState(TEST_API, LABEL, noWait);
      expect(measured.state).toBe(LABEL_STATE.absent);
      expect(measured.detail).toContain("404");
    });

    it("`unknown` when the labels API stays unreadable — never `present`", async () => {
      // `apiGet` exhausts its bounded retries and RAISES. Absorbing that as
      // `present` would reprint the instruction that does not work; absorbing it
      // as `absent` would file a defect against a repository that is fine.
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(500, {}, {});
      const measured = await mod.fetchBypassLabelState(TEST_API, LABEL, noWait);
      expect(measured.state).toBe(LABEL_STATE.unknown);
      expect(measured.state).not.toBe(LABEL_STATE.present);
      expect(measured.state).not.toBe(LABEL_STATE.absent);
    });

    it("`unknown`, never `present`, when a network error kills every attempt", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> => {
        throw new Error("ECONNRESET");
      };
      const measured = await mod.fetchBypassLabelState(TEST_API, LABEL, noWait);
      expect(measured.state).toBe(LABEL_STATE.unknown);
    });

    it("`unknown`, never `present`, when no bypass label is configured at all", async () => {
      let called = false;
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> => {
        called = true;
        return fakeResponse(200, {}, {});
      };
      const measured = await mod.fetchBypassLabelState(TEST_API, "  ", noWait);
      expect(measured.state).toBe(LABEL_STATE.unknown);
      // An unnamed label cannot be looked up, and looking up `""` would 404 and
      // render as `absent` — a defect manufactured out of a missing input.
      expect(called).toBe(false);
    });

    it("never invents `not_measured` — that token belongs to callers who did not ask", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(404, {}, {});
      const measured = await mod.fetchBypassLabelState(TEST_API, LABEL, noWait);
      expect(measured.state).not.toBe(LABEL_STATE.notMeasured);
    });
  });

  // -------------------------------------------------------------------------
  // Naming the ruleset — the second half of the mismatch
  // -------------------------------------------------------------------------

  describe("naming which ruleset armed the gate", () => {
    it("carries the matching rule's SOURCE out of the effective-rules read", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(200, {}, [requiredChecksRule([GATE_CONTEXT])]);
      const measured = await mod.fetchRequiredness(
        TEST_API,
        BRANCH,
        GATE_CONTEXT,
        noWait
      );
      expect(measured.state).toBe(REQUIRED_STATE.required);
      expect(measured.rulesets).toEqual([
        { sourceType: "Repository", source: "o/r", id: 1 },
      ]);
    });

    it("names only the rule that requires THIS gate, not every rule on the branch", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(200, {}, [
          {
            ...(requiredChecksRule(["CodeRabbit"]) as Record<string, unknown>),
            ruleset_source: "unrelated",
            ruleset_id: 9,
          },
          requiredChecksRule([GATE_CONTEXT]),
        ]);
      const measured = await mod.fetchRequiredness(
        TEST_API,
        BRANCH,
        GATE_CONTEXT,
        noWait
      );
      expect(measured.rulesets).toHaveLength(1);
      expect(measured.rulesets?.[0]?.id).toBe(1);
    });

    it("renders an ORGANIZATION ruleset as such — repository settings is the wrong page", () => {
      expect(
        mod.describeRulesets([
          { sourceType: "Organization", source: "acme", id: 7 },
        ])
      ).toBe("Organization ruleset `acme` (id 7)");
    });

    it("still names something when the API omitted the rule's source", () => {
      // Requiredness already proved a rule is in effect; only its provenance is
      // missing. "unknown ruleset" would read as doubt about the measurement.
      expect(mod.describeRulesets([])).toBe("an active ruleset on this branch");
      expect(mod.describeRulesets(undefined)).toBe(
        "an active ruleset on this branch"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Reporting it as a defect
  // -------------------------------------------------------------------------

  describe("an armed gate whose escape hatch does not exist", () => {
    it("reports a defect naming the label AND the ruleset that armed the gate", () => {
      const body = bodyFor(REQUIRED_STATE.required, {
        state: LABEL_STATE.absent,
        detail: "404",
      });
      expect(body).toContain(CAUTION);
      expect(body).toContain(DEFECT);
      expect(body).toContain(`\`${LABEL}\` label does not exist`);
      expect(body).toContain("Repository ruleset `o/r` (id 1)");
    });

    it("says where following the instructions actually ends — the unaudited admin merge", () => {
      const body = bodyFor(REQUIRED_STATE.required, {
        state: LABEL_STATE.absent,
        detail: null,
      });
      expect(body).toContain("unaudited admin merge");
    });

    it("prints the one command that fixes it, and says it will not run it", () => {
      const body = bodyFor(REQUIRED_STATE.required, {
        state: LABEL_STATE.absent,
        detail: null,
      });
      expect(body).toContain(`gh label create ${LABEL}`);
      // Creating the label from the reporter would manufacture a bypass surface
      // in a repository whose owners never chose to have one. Naming the
      // mismatch leaves the decision where it belongs.
      expect(body).toContain("does not create the label itself");
    });

    it("keeps the recipe below the defect — it is unreachable, not wrong", () => {
      const body = bodyFor(REQUIRED_STATE.required, {
        state: LABEL_STATE.absent,
        detail: null,
      });
      expect(body).toContain(CAUTION);
      expect(body).toContain(RECIPE);
      expect(body.indexOf(CAUTION)).toBeLessThan(body.indexOf(RECIPE));
    });

    it("reports it under an UNKNOWN requiredness too — that branch still prints the recipe", () => {
      const body = bodyFor(REQUIRED_STATE.unknown, {
        state: LABEL_STATE.absent,
        detail: null,
      });
      expect(body).toContain(DEFECT);
    });
  });

  // -------------------------------------------------------------------------
  // Ambiguity: hedged, never resolved into a claim
  // -------------------------------------------------------------------------

  describe("an unreadable label state", () => {
    it("hedges — it never claims the label is there", () => {
      const body = bodyFor(REQUIRED_STATE.required, {
        state: LABEL_STATE.unknown,
        detail: "the labels API was unreadable: HTTP 500",
      });
      expect(body).toContain(WARNING);
      expect(body).toContain("could not be read");
      expect(body).toContain("HTTP 500");
    });

    it("is kept DISTINCT from an absent one — only one of them is a defect", () => {
      const unreadable = bodyFor(REQUIRED_STATE.required, {
        state: LABEL_STATE.unknown,
        detail: null,
      });
      const missing = bodyFor(REQUIRED_STATE.required, {
        state: LABEL_STATE.absent,
        detail: null,
      });
      expect(unreadable).not.toContain(DEFECT);
      expect(unreadable).not.toContain(CAUTION);
      expect(missing).toContain(DEFECT);
      expect(missing).not.toContain(WARNING);
      expect(unreadable).not.toBe(missing);
    });
  });

  // -------------------------------------------------------------------------
  // THE NEGATIVE CONTROL
  // -------------------------------------------------------------------------

  describe("a repository that installed the whole contract", () => {
    it("NEGATIVE CONTROL: renders byte for byte what a caller that never asked renders", () => {
      // `not_measured` IS the pre-§10.9 rendering path: it is what
      // `planIssueActions` falls back to for a caller that carries no label
      // measurement, which is every caller that existed before this shipped.
      // Equality here is the assertion that the healthy case was not perturbed.
      const present = bodyFor(REQUIRED_STATE.required, {
        state: LABEL_STATE.present,
        detail: null,
      });
      const unasked = bodyFor(REQUIRED_STATE.required);
      expect(present).toBe(unasked);
    });

    it("NEGATIVE CONTROL: still prints the full waiver recipe and no alert of any kind", () => {
      const body = bodyFor(REQUIRED_STATE.required, {
        state: LABEL_STATE.present,
        detail: null,
      });
      expect(body).toContain(RECIPE);
      expect(body).toContain("Nightly-E2E-Bypass:");
      expect(body).not.toContain(CAUTION);
      expect(body).not.toContain(WARNING);
      expect(body).not.toContain(DEFECT);
    });

    it("NEGATIVE CONTROL: the job summary says nothing about the label", () => {
      const report = mod.formatIssueReport([], {
        branch: BRANCH,
        gateContext: GATE_CONTEXT,
        bypassLabel: LABEL,
        requiredness: {
          state: REQUIRED_STATE.required,
          detail: null,
          contexts: [],
          rulesets: [REPO_RULESET],
        },
        bypassLabelState: { state: LABEL_STATE.present, detail: null },
      });
      expect(report).not.toContain(LABEL);
      expect(report).not.toContain("escape hatch");
    });
  });

  // -------------------------------------------------------------------------
  // Nothing gated, nothing reported
  // -------------------------------------------------------------------------

  describe("a branch this gate does not guard", () => {
    it("reports no defect — a label that waives nothing is not missing anything", () => {
      const body = bodyFor(REQUIRED_STATE.notRequired, {
        state: LABEL_STATE.absent,
        detail: "404",
      });
      expect(body).not.toContain(DEFECT);
      expect(body).not.toContain(CAUTION);
      expect(body).toContain("Do you need a waiver? No.");
    });

    it("reports no defect for a suite declared `gated: false` either", () => {
      const plan = mod.planIssueActions(
        [finding({ gated: false } as Partial<Finding>)],
        [],
        context(REQUIRED_STATE.required, {
          state: LABEL_STATE.absent,
          detail: "404",
        }) as never
      );
      expect((plan[0] as IssuePlanEntry).body).not.toContain(DEFECT);
    });
  });

  // -------------------------------------------------------------------------
  // The nightly surface: visible BEFORE anybody needs it
  // -------------------------------------------------------------------------

  describe("the job summary, which runs whether or not anybody is blocked", () => {
    /**
     * The summary for one label state on an armed gate.
     *
     * @param bypassLabelState - The measured label state
     * @returns The rendered summary
     */
    function summary(bypassLabelState: BypassLabelState): string {
      return mod.formatIssueReport([], {
        branch: BRANCH,
        gateContext: GATE_CONTEXT,
        bypassLabel: LABEL,
        requiredness: {
          state: REQUIRED_STATE.required,
          detail: null,
          contexts: [],
          rulesets: [REPO_RULESET],
        },
        bypassLabelState,
      });
    }

    it("names the defect on a GREEN night, with no tracking issues and nobody blocked", () => {
      // This is the requirement the reporting half exists to satisfy. The gate
      // half only speaks once somebody is already blocked, which is the moment
      // it is too late to find out the documented way out was never installed.
      const report = summary({ state: LABEL_STATE.absent, detail: null });
      expect(report).toContain("Defect");
      expect(report).toContain(LABEL);
      expect(report).toContain("Repository ruleset `o/r` (id 1)");
      expect(report).toContain(`gh label create ${LABEL}`);
    });

    it("hedges rather than reassures when the label state could not be read", () => {
      const report = summary({
        state: LABEL_STATE.unknown,
        detail: "the labels API was unreadable: HTTP 500",
      });
      expect(report).toContain("could not be read");
      expect(report).not.toContain("Defect");
    });

    it("says nothing at all for a caller that never measured", () => {
      const report = summary({ state: LABEL_STATE.notMeasured, detail: null });
      expect(report).not.toContain(LABEL);
    });
  });

  // -------------------------------------------------------------------------
  // End to end, through the wire
  // -------------------------------------------------------------------------

  describe("runReport, end to end", () => {
    let requested: string[] = [];

    beforeEach(() => {
      requested = [];
    });

    /** The effective-rules endpoint, which §10.7 measures requiredness from. */
    const RULES_PATH = "/rules/branches/";

    /** The labels endpoint, which §10.9 measures the escape hatch from. */
    const LABELS_PATH = "/labels/";

    /** One green run, so the plan is `none` and nothing is ever written. */
    const GREEN_RUN = Object.freeze({
      id: 7,
      conclusion: "success",
      created_at: "2026-08-12T06:00:00Z",
      html_url: "https://example.test/run/7",
      event: "schedule",
      head_branch: BRANCH,
    });

    /**
     * Stubs every endpoint one report reads.
     *
     * The suite is GREEN and untracked, so the plan writes nothing and the only
     * behaviour under test is which measurements were taken.
     *
     * @param options - What the rules and labels endpoints answer
     */
    function stubApi(options: {
      rulesStatus?: number;
      rules?: unknown[];
      labelStatus?: number;
    }): void {
      const {
        rulesStatus = 200,
        rules = [requiredChecksRule([GATE_CONTEXT])],
        labelStatus = 200,
      } = options;
      (globalThis as { fetch: unknown }).fetch = async (
        url: string
      ): Promise<unknown> => {
        const seen = String(url);
        requested.push(seen);
        if (seen.includes(RULES_PATH))
          return fakeResponse(rulesStatus, {}, rules);
        if (seen.includes(LABELS_PATH))
          return fakeResponse(labelStatus, {}, { name: LABEL });
        if (seen.includes("/issues?")) return fakeResponse(200, {}, []);
        if (seen.includes("/artifacts"))
          return fakeResponse(200, {}, { artifacts: [] });
        if (seen.includes("/jobs"))
          return fakeResponse(200, {}, { jobs: [GREEN_JOB] });
        return fakeResponse(200, {}, { workflow_runs: [GREEN_RUN] });
      };
    }

    /** The environment as the reusable reporting workflow sets it. */
    const ENV: Record<string, string | undefined> = Object.freeze({
      GITHUB_TOKEN: "t",
      GITHUB_REPOSITORY: "o/r",
      NIGHTLY_BRANCH: BRANCH,
      NIGHTLY_GATE_CONTEXT: GATE_CONTEXT,
      NIGHTLY_BYPASS_LABEL: LABEL,
      NIGHTLY_SUITES: JSON.stringify([
        {
          label: SUITE_LABEL,
          workflow: "maestro-native-e2e.yml",
          match: { mode: "run" },
        },
      ]),
    });

    it("measures the label and carries the state into its machine record", async () => {
      stubApi({ labelStatus: 404 });
      const outcome = await mod.runReport(ENV, noWait);
      expect(outcome.requiredness.state).toBe(REQUIRED_STATE.required);
      expect(outcome.bypassLabelState.state).toBe(LABEL_STATE.absent);
      expect(
        requested.some(url => url.endsWith(`/repos/o/r/labels/${LABEL}`))
      ).toBe(true);
    });

    it("does not even ASK about the label when the gate is required by nothing", async () => {
      // Skipping the CALL rather than suppressing the RENDER makes "not
      // reported when nothing is gated" a property of the wire, which a
      // renderer edit cannot quietly undo.
      stubApi({
        rules: [requiredChecksRule(["CodeRabbit"])],
        labelStatus: 404,
      });
      const outcome = await mod.runReport(ENV, noWait);
      expect(outcome.requiredness.state).toBe(REQUIRED_STATE.notRequired);
      expect(outcome.bypassLabelState.state).toBe(LABEL_STATE.notMeasured);
      expect(requested.some(url => url.includes(LABELS_PATH))).toBe(false);
    });

    it("still asks when requiredness itself is UNKNOWN — the recipe is printed there too", async () => {
      stubApi({ rulesStatus: 404, labelStatus: 404 });
      const outcome = await mod.runReport(ENV, noWait);
      expect(outcome.requiredness.state).toBe(REQUIRED_STATE.unknown);
      expect(outcome.bypassLabelState.state).toBe(LABEL_STATE.absent);
    });

    it("an unreadable labels API never fails the report — §10.4 holds", async () => {
      stubApi({ labelStatus: 500 });
      const outcome = await mod.runReport(ENV, noWait);
      expect(outcome.bypassLabelState.state).toBe(LABEL_STATE.unknown);
      expect(outcome.results).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Versioning
  // -------------------------------------------------------------------------

  it("ships as contract 1.7.0 or later — additive, on the REPORTING half only", () => {
    const [major, minor] =
      mod.NIGHTLY_E2E_CONTRACT_VERSION.split(".").map(Number);
    expect(major).toBe(1);
    expect(minor).toBeGreaterThanOrEqual(7);
  });
});
