/**
 * `blocked-plan` judges a hold under the project's own human-gate policy
 * (CodySwannGT/lisa#4687).
 *
 * A lift comment discharges a hold only while the hold is invalid, and
 * validity depends on `humanGate.mode` and `humanGate.humanOnly`. The manager
 * used to judge every hold under the default, so a strict project's
 * accountable-person hold, or a project-declared `pricing` hold, read as
 * liftable and a lift comment released it. The policy comes from config,
 * resolved local-then-global, and never from the item JSON on stdin, which is
 * built from the item's own untrusted text.
 * @module tests/unit/session-manager/cli-blocked-plan-human-gate-policy
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { formatHumanGateLift } from "../../../plugins/src/base/scripts/human-gate-lift.mjs";
import { HUMAN_GATE_MARKER } from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
import {
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
} from "./support/cli-harness.js";

afterEach(() => removeSandboxes());

const BLOCKED_PLAN = "blocked-plan";
const SKIP = "skip-human-gate";
const RELEASE = "release";
const STRICT = { humanGate: { mode: "strict" } };
const EDGES = [
  {
    ref: "<TEAM>-1",
    contained: true,
    blockerState: "closed",
    blockerReason: "completed",
  },
];

/**
 * A Blocked item held for one reason, with a lift comment naming it.
 * @param reason - The hold's slug
 * @param visible - The visible "Held for …" line
 * @returns The item JSON blocked-plan reads
 */
function liftedItem(reason: string, visible: string) {
  return {
    labels: [],
    body: `${visible}\n<!-- ${HUMAN_GATE_MARKER} reason=${reason} -->`,
    comments: [{ body: formatHumanGateLift({ reason }) }],
    edges: EDGES,
  };
}

const ACCOUNTABLE = liftedItem(
  "accountable-owner",
  "Held for a person to name an accountable person: the processor owner."
);
const PRICING = liftedItem(
  "pricing-tier",
  "Held for a human product call: pricing tier."
);

/**
 * Plan the item in a sandbox with the given config.
 * @param item - Item JSON
 * @param extraConfig - Keys merged into `.lisa.config.json`
 * @param localConfig - Contents of `.lisa.config.local.json`, if any
 * @returns The planned action
 */
function plan(
  item: object,
  extraConfig: Record<string, unknown> = {},
  localConfig?: object
): string {
  const sandbox = makeSandbox({ extraConfig });
  if (localConfig !== undefined) {
    writeJson(path.join(sandbox.root, ".lisa.config.local.json"), localConfig);
  }
  const result = runCli(sandbox, [BLOCKED_PLAN], {
    input: JSON.stringify(item),
  });
  expect(result.status).toBe(0);
  return result.json.action as string;
}

describe("blocked-plan reads humanGate from config", () => {
  it("honours a lift of a legacy hold under the default access-only mode", () => {
    expect(plan(ACCOUNTABLE)).toBe(RELEASE);
  });

  it("keeps a legacy hold under humanGate.mode strict", () => {
    expect(plan(ACCOUNTABLE, STRICT)).toBe(SKIP);
  });

  it("lets the local config's mode replace the global one", () => {
    expect(
      plan(ACCOUNTABLE, STRICT, { humanGate: { mode: "access-only" } })
    ).toBe(RELEASE);
  });

  it("keeps a hold in a project-declared humanOnly class", () => {
    expect(plan(PRICING)).toBe(RELEASE);
    expect(plan(PRICING, { humanGate: { humanOnly: ["pricing"] } })).toBe(SKIP);
  });

  it("ignores a humanGate policy carried in the item JSON", () => {
    expect(plan({ ...ACCOUNTABLE, humanGateMode: "access-only" }, STRICT)).toBe(
      SKIP
    );
    expect(
      plan(
        { ...PRICING, humanOnly: [] },
        { humanGate: { humanOnly: ["pricing"] } }
      )
    ).toBe(SKIP);
  });
});

describe("blocked-plan: a blocker closed NOT PLANNED follows humanGate.mode", () => {
  const cancelled = {
    labels: [],
    body: "Depends on the export work.",
    comments: [],
    edges: [
      {
        ref: "<TEAM>-9",
        contained: true,
        blockerState: "closed",
        blockerReason: "not_planned",
      },
    ],
  };

  it("hands the decision to the agent by default", () => {
    expect(plan(cancelled)).toBe("decide");
  });

  it("relays it to a person under strict", () => {
    expect(plan(cancelled, STRICT)).toBe("escalate");
  });
});
