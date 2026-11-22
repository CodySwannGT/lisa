/**
 * Which place answers for each kind of enforcement point
 * (CodySwannGT/lisa#5000).
 *
 * A register lists points in five kinds of place. `lisa controls reconcile`
 * can look at some, can look at others only when asked, and cannot look at
 * the rest, and it has to say which is which: a point it cannot look at is
 * never reported as missing. These cases hand it a carrier check written in
 * memory, so they also hold the one promise made to carriers that do not
 * exist yet: a point is matched by `location` and `moment` and nothing else.
 */
import { describe, expect, it } from "vitest";

import type {
  CarrierPoint,
  CarrierResult,
} from "../../../src/controls/carrier-types.js";
import { pointFindings } from "../../../src/controls/reconcile-findings.js";
import { reconcilePoints } from "../../../src/controls/reconcile-points.js";
import type { ReconciledPoint } from "../../../src/controls/reconcile-types.js";
import { F_PAVED_GATES } from "../../helpers/control-register.js";
import { registerForGates } from "./support/executor-fixtures.js";

const AGENT_ENTRY = "destructive-safety@.";
const AGENT_SETTINGS = ".claude/settings.json";
const NOT_VERIFIABLE = "not-verifiable";

/**
 * A point of a carrier check, as any kind of carrier reports one.
 * @param fields - What the point says
 * @returns The point
 */
function carried(fields: Readonly<Record<string, unknown>>): CarrierPoint {
  return {
    hook: "pre-commit",
    kind: "git-hook",
    outcome: "already-wired",
    path: ".husky/pre-commit",
    reason: null,
    wired_through: "lisa-stack-hook",
    ...fields,
  } as unknown as CarrierPoint;
}

/**
 * A carrier check that reports some points and would write nothing.
 * @param points - The points it reports
 * @returns The check's result
 */
function check(points: readonly CarrierPoint[]): CarrierResult {
  return {
    changes: [],
    each_checkout: { check: "", command: "", why: "" },
    enforcement_points: points,
    hook_owner: "husky",
    mode: "check",
    outcome: "already-wired",
    reason: "",
    record: ".lisa/controls/carriers.json",
    runner: {
      files: [],
      outcome: "not-needed",
      path: "scripts/lisa-run-gates.mjs",
      reason: null,
    },
    schema_version: 1,
  };
}

/**
 * Reconcile the points of the paved-road declaration against a carrier
 * check, with the hosting platform not asked.
 * @param points - The points the carrier check reports
 * @returns Every enforcement point of the register, reconciled
 */
async function reconciled(
  points: readonly CarrierPoint[]
): Promise<readonly ReconciledPoint[]> {
  return reconcilePoints(await registerForGates(F_PAVED_GATES), {
    carriers: check(points),
    platform: { asked: false },
    read: () => Promise.resolve(null),
    root: "/nowhere",
  });
}

/**
 * The state of each point, by where it is and when.
 * @param points - The reconciled points
 * @returns For example `{ "local-checkout commit": ["wired"] }`
 */
function byPlace(
  points: readonly ReconciledPoint[]
): Record<string, readonly string[]> {
  return points.reduce<Record<string, readonly string[]>>((so, point) => {
    const place = `${point.location} ${point.moment}`;
    return {
      ...so,
      [place]: [...new Set([...(so[place] ?? []), point.state])],
    };
  }, {});
}

describe("which place answers for an enforcement point", () => {
  it("gives every kind of place its own answer, and no finding for the ones it cannot look at", async () => {
    const points = await reconciled([
      carried({ location: "local-checkout", moment: "commit" }),
      carried({ hook: "pre-push", location: "local-checkout", moment: "push" }),
    ]);

    expect(byPlace(points)).toEqual({
      "coding-agent pre-tool": [NOT_VERIFIABLE],
      "hosting-platform pull-request": ["not-read"],
      "local-checkout commit": ["wired"],
      "local-checkout push": ["wired"],
      "scheduled-run continuous:staging": [NOT_VERIFIABLE],
    });
    expect(
      pointFindings(await registerForGates(F_PAVED_GATES), points)
    ).toEqual([]);
  });

  it("says a coding-agent point is not verifiable while no carrier check covers it", async () => {
    const agent = (await reconciled([])).find(
      point => point.entry_id === AGENT_ENTRY
    );

    expect(agent).toMatchObject({
      checked: null,
      reason:
        "No carrier check covers the coding agent at pre-tool yet, so this command cannot say whether anything runs the rule there.",
      state: NOT_VERIFIABLE,
    });
  });

  it("picks up a coding-agent carrier as soon as the check reports one", async () => {
    const agent = (
      await reconciled([
        carried({
          hook: "PreToolUse",
          kind: "agent-hook",
          location: "coding-agent",
          moment: "pre-tool",
          path: AGENT_SETTINGS,
          wired_through: "claude",
        }),
      ])
    ).find(point => point.entry_id === AGENT_ENTRY);

    expect(agent).toMatchObject({ checked: AGENT_SETTINGS, state: "wired" });
  });

  it("reports a coding-agent carrier the check says is blocked, for its reason", async () => {
    const register = await registerForGates(F_PAVED_GATES);
    const points = await reconciled([
      carried({
        location: "coding-agent",
        moment: "pre-tool",
        outcome: "blocked",
        path: AGENT_SETTINGS,
        reason: "The agent's settings file does not start the gate runner.",
      }),
    ]);

    expect(
      pointFindings(register, points).map(finding => finding.message)
    ).toEqual([
      `The register says "destructive-safety" is checked at pre-tool, but nothing in this checkout makes the coding agent run it (register entry ${AGENT_ENTRY}). The agent's settings file does not start the gate runner.`,
    ]);
  });

  it("reports a checkout point the carrier check left out as not verifiable", async () => {
    const points = await reconciled([]);

    expect(byPlace(points)["local-checkout commit"]).toEqual([NOT_VERIFIABLE]);
  });
});
