/**
 * Tests for the ruleset SCOPE an awaited context carries end to end.
 *
 * An `await` gate names a check some other app posts. It is declared on a gate
 * rather than in `github.rulesets.requiredChecks`, so it names no ruleset of
 * its own and `awaitedHome` resolves one for it. That resolved home has to
 * survive two hand-offs, and it survived neither:
 *
 * 1. **Comparison.** The resolved home never reached the declaration records
 *    the comparison is made of, so an awaited context whose repair home is
 *    `base` was reported satisfied by the same context in `release`. The
 *    requirement `base` was missing stayed missing, and no repair was planned.
 * 2. **Repair.** An awaited record with no resolvable home still routes through
 *    `homes` or the fallback, but the payload kept only awaited records whose
 *    OWN `ruleset` equalled the target. Dropped from that list, the context was
 *    written with the GitHub Actions pin — naming the one writer that can never
 *    post an external check, which blocks every pull request forever.
 * @module tests/unit/scripts/lisa-reconcile-policy-awaited-scope
 */

import { describe, expect, it } from "vitest";

import {
  VERDICT,
  planRepairs,
  reconcile,
  reconcileContexts,
} from "../../../all/copy-overwrite/scripts/lisa-reconcile-policy.mjs";
import {
  ACTIONS_ID,
  REPO,
  SONAR,
  baseRuleset,
  gitHub,
  recorded,
  writes,
} from "./lisa-reconcile-policy-fixtures.js";

const BASE = "base";
const RELEASE = "release";
const QUALITY_CHECKS = "quality checks";
const PULL_REQUEST = "pull-request";
const SONAR_APP = 12_345;

/** A project awaiting one external signal, with no app named. */
const AWAIT_GATES = {
  "static-analysis": {
    [PULL_REQUEST]: { level: "required", await: SONAR },
  },
};

/** The same project, naming the app allowed to post the awaited check. */
const PINNED_AWAIT_GATES = {
  "static-analysis": {
    [PULL_REQUEST]: { level: "required", await: SONAR, posted_by: SONAR_APP },
  },
};

/** An empty settings-drift result, so a plan is only about contexts. */
const NO_SETTINGS = { drift: [], matched: [], unknown: [] };

/**
 * One live required check, shaped as `liveContexts` produces it.
 * @param ruleset - The ruleset requiring it.
 * @param rulesetId - That ruleset's id.
 * @param integrationId - The pin, or null for "any source".
 * @returns The live entry.
 */
const liveCheck = (
  ruleset: string,
  rulesetId: number,
  integrationId: number | null
): {
  context: string;
  integration_id: number | null;
  ruleset: string;
  rulesetId: number;
} => ({ context: SONAR, integration_id: integrationId, ruleset, rulesetId });

/**
 * The checks one planned action would write, by ruleset name.
 * @param plan - A repair plan.
 * @param name - The ruleset to read.
 * @returns Its required checks, or undefined when nothing was planned for it.
 */
const checksIn = (
  plan: readonly {
    ruleset?: string;
    payload?: {
      rules: { parameters: { required_status_checks: unknown[] } }[];
    };
  }[],
  name: string
): unknown =>
  plan.find(action => action.ruleset === name)?.payload?.rules[0].parameters
    .required_status_checks;

describe("an awaited declaration carries its ruleset into the comparison", () => {
  it("keeps the awaited home missing when only another ruleset requires it", () => {
    // The whole defect, at the comparison boundary: the awaited home is
    // `base`, the live check is in `release`, and a name-only record answered
    // `base`'s requirement with `release`'s check.
    const result = reconcileContexts({
      declared: [SONAR],
      live: [liveCheck(RELEASE, 8, null)],
      awaited: [{ context: SONAR, ruleset: BASE }],
    });

    expect(result.missing).toEqual([SONAR]);
    expect(result.matched).toEqual([]);
    expect(result.missingRecords).toEqual([{ context: SONAR, ruleset: BASE }]);
  });

  it("matches once the awaited home requires it, unpinned", () => {
    const result = reconcileContexts({
      declared: [SONAR],
      live: [liveCheck(BASE, 7, null)],
      awaited: [{ context: SONAR, ruleset: BASE }],
    });

    expect(result.missing).toEqual([]);
    expect(result.matched).toEqual([SONAR]);
  });

  it("holds a pinned awaited declaration to its declared app", () => {
    // A declared pin travels with the awaited record, so the same context
    // posted by a different app in the awaited home is not agreement.
    const wrongApp = reconcileContexts({
      declared: [SONAR],
      live: [liveCheck(BASE, 7, 99)],
      awaited: [{ context: SONAR, ruleset: BASE, integration_id: SONAR_APP }],
    });
    expect(wrongApp.missing).toEqual([SONAR]);

    const rightApp = reconcileContexts({
      declared: [SONAR],
      live: [liveCheck(BASE, 7, SONAR_APP)],
      awaited: [{ context: SONAR, ruleset: BASE, integration_id: SONAR_APP }],
    });
    expect(rightApp.missing).toEqual([]);
  });

  it("stays name-only when no home could be resolved", () => {
    // `awaitedHome` returns null on an ambiguous repository. Tightening the
    // comparison there would report drift against a ruleset nobody chose.
    const result = reconcileContexts({
      declared: [SONAR],
      live: [liveCheck(RELEASE, 8, null)],
      awaited: [{ context: SONAR }],
    });

    expect(result.missing).toEqual([]);
    expect(result.matched).toEqual([SONAR]);
  });

  it("leaves an explicit requiredChecks declaration in charge of its pair", () => {
    // Same (context, ruleset) declared BOTH ways. The explicit declaration is
    // the one the project wrote down, so it — and its pin — decides, and the
    // awaited record must not be added beside it as a contradicting duplicate.
    const result = reconcileContexts({
      declared: [SONAR],
      live: [liveCheck(BASE, 7, SONAR_APP)],
      records: [{ context: SONAR, ruleset: BASE, integration_id: SONAR_APP }],
      awaited: [{ context: SONAR, ruleset: BASE }],
    });

    expect(result.missing).toEqual([]);
    expect(result.missingRecords).toEqual([]);
  });
});

describe("an awaited repair reaches the ruleset it was routed to", () => {
  const rulesets = [
    baseRuleset([], { id: 7, name: BASE }),
    baseRuleset([], { id: 8, name: RELEASE }),
  ];

  it("writes an unscoped awaited context unpinned through homes", () => {
    // Routed to `release` by `homes`, the awaited record — whose own ruleset is
    // unresolved — was filtered out of the payload's awaited list, and the
    // context was written pinned to Actions: permanently unsatisfiable.
    const plan = planRepairs({
      contexts: {
        missing: [SONAR],
        missingRecords: [{ context: SONAR }],
        extra: [],
        matched: [],
      },
      settings: NO_SETTINGS,
      live: { rulesets },
      prune: false,
      rulesetName: null,
      awaited: [{ context: SONAR }],
      pins: {},
      homes: { [SONAR]: RELEASE },
    });

    expect(checksIn(plan, RELEASE)).toEqual([{ context: SONAR }]);
  });

  it("writes an unscoped awaited context unpinned through the fallback", () => {
    const plan = planRepairs({
      contexts: {
        missing: [SONAR],
        missingRecords: [{ context: SONAR }],
        extra: [],
        matched: [],
      },
      settings: NO_SETTINGS,
      live: { rulesets: [baseRuleset([], { id: 9, name: QUALITY_CHECKS })] },
      prune: false,
      rulesetName: null,
      awaited: [{ context: SONAR }],
      pins: {},
      homes: {},
    });

    expect(checksIn(plan, QUALITY_CHECKS)).toEqual([{ context: SONAR }]);
  });

  it("still applies a declared awaited pin on the routed ruleset", () => {
    const plan = planRepairs({
      contexts: {
        missing: [SONAR],
        missingRecords: [{ context: SONAR }],
        extra: [],
        matched: [],
      },
      settings: NO_SETTINGS,
      live: { rulesets },
      prune: false,
      rulesetName: null,
      awaited: [{ context: SONAR }],
      pins: { [SONAR]: SONAR_APP },
      homes: { [SONAR]: RELEASE },
    });

    expect(checksIn(plan, RELEASE)).toEqual([
      { context: SONAR, integration_id: SONAR_APP },
    ]);
  });

  it("leaves a non-awaited context on the Actions default", () => {
    const plan = planRepairs({
      contexts: {
        missing: [SONAR],
        missingRecords: [{ context: SONAR }],
        extra: [],
        matched: [],
      },
      settings: NO_SETTINGS,
      live: { rulesets },
      prune: false,
      rulesetName: null,
      awaited: [],
      pins: {},
      homes: { [SONAR]: RELEASE },
    });

    expect(checksIn(plan, RELEASE)).toEqual([
      { context: SONAR, integration_id: ACTIONS_ID },
    ]);
  });
});

describe("awaited scope, end to end", () => {
  /**
   * A repository carrying `base` and `release`, only one of which requires it.
   * @param requiredIn - The ruleset that already requires the awaited context.
   * @returns The two live rulesets.
   */
  const repository = (requiredIn: string): Record<string, unknown>[] => [
    baseRuleset(requiredIn === BASE ? [SONAR] : [], { id: 7, name: BASE }),
    baseRuleset(requiredIn === RELEASE ? [SONAR] : [], {
      id: 8,
      name: RELEASE,
    }),
  ];

  it("repairs the awaited home rather than reading another ruleset as agreement", () => {
    const gh = gitHub({ rulesets: repository(RELEASE), settings: {} });
    const result = reconcile({ repo: REPO, gates: AWAIT_GATES, gh });

    expect(result.verdict).toBe(VERDICT.DRIFT);
    expect(result.contexts?.missing).toEqual([SONAR]);
    const written = writes(recorded(gh.mock.calls));
    expect(written).toHaveLength(1);
    expect(written[0].args).toContain(`repos/${REPO}/rulesets/7`);
    expect(
      JSON.parse(written[0].input as string).rules[0].parameters
        .required_status_checks
    ).toEqual([{ context: SONAR }]);
  });

  it("keeps a pinned awaited context on its declared app in the awaited home", () => {
    const gh = gitHub({ rulesets: repository(RELEASE), settings: {} });
    reconcile({ repo: REPO, gates: PINNED_AWAIT_GATES, gh });

    const written = writes(recorded(gh.mock.calls));
    expect(
      JSON.parse(written[0].input as string).rules[0].parameters
        .required_status_checks
    ).toEqual([{ context: SONAR, integration_id: SONAR_APP }]);
  });
});
