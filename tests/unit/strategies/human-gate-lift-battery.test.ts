/**
 * The independent verifier's layout and wording battery for the hold lift
 * (CodySwannGT/lisa#4658), pinned under the structural lift rule: any secret
 * or act token anywhere in an item's hold text keeps the hold, and only a
 * clean topic hold is lifted.
 * @module tests/unit/strategies/human-gate-lift-battery
 */
import { describe, expect, it } from "vitest";

import { planHumanGateLift } from "../../../plugins/src/base/scripts/human-gate-lift.mjs";

const NEEDED = "human-needed";
const READY = "status:ready";
const LIFECYCLE = [
  READY,
  "status:in-progress",
  "status:blocked",
  "status:done",
  NEEDED,
];
const DESIGN_NOTES = "## Design notes";
const OLD_WORDING = "Held for a human product call:";

/**
 * Plan a lift for a body given as lines.
 * @param lines - The body lines
 * @returns The lift plan
 */
function plan(lines: readonly string[]) {
  return planHumanGateLift({
    body: lines.join("\n"),
    labels: [NEEDED],
    readyLabel: READY,
    lifecycleLabels: LIFECYCLE,
  });
}

// Every layout and wording the independent verifier flagged, with the verdict
// the structural lift rule gives it. Any secret or act token anywhere in the
// item's hold text keeps the hold; only a clean topic hold is lifted.
const VISIBLE_CREDENTIAL =
  "Held for a person to supply a credential only a person holds: the Stripe API key.";
const STRIPE_MARKER = "<!-- [lisa-human-gate] reason=stripe-key -->";

describe("verifier battery: the sweep keeps every doubtful hold", () => {
  it.each([
    [
      "old wording, design notes below",
      [`${OLD_WORDING} the Stripe API key.`, STRIPE_MARKER, DESIGN_NOTES],
    ],
    [
      "writer layout under a heading",
      [DESIGN_NOTES, VISIBLE_CREDENTIAL, STRIPE_MARKER],
    ],
    ["marker first, visible line below", [STRIPE_MARKER, VISIBLE_CREDENTIAL]],
    [
      "marker first under a heading",
      [DESIGN_NOTES, STRIPE_MARKER, VISIBLE_CREDENTIAL],
    ],
    [
      "visible line, heading, marker",
      [VISIBLE_CREDENTIAL, DESIGN_NOTES, STRIPE_MARKER],
    ],
    [
      "visible line, blank, heading, marker",
      [VISIBLE_CREDENTIAL, "", DESIGN_NOTES, STRIPE_MARKER],
    ],
    [
      "marker first, legal sign-off below",
      [
        "<!-- [lisa-human-gate] reason=a -->",
        "Need the legal sign-off from counsel.",
      ],
    ],
    [
      "old wording, credential slug with a topic word",
      [
        `${OLD_WORDING} the Stripe API key for the payments dashboard.`,
        "<!-- [lisa-human-gate] reason=stripe-key-dashboard -->",
      ],
    ],
    [
      "old wording, password for a migration",
      [
        `${OLD_WORDING} the production database password for the migration.`,
        "<!-- [lisa-human-gate] reason=db-password-migration -->",
      ],
    ],
    [
      "old wording, BAA signature",
      [
        `${OLD_WORDING} the client must sign the BAA.`,
        "<!-- [lisa-human-gate] reason=client-baa -->",
      ],
    ],
    [
      "old wording, admin rights",
      [
        `${OLD_WORDING} add the bot to the workspace.`,
        "<!-- [lisa-human-gate] reason=workspace-admin -->",
      ],
    ],
    [
      "topic hold beside a secret in prose",
      [
        "The secret store is out of scope here.",
        "<!-- [lisa-human-gate] reason=role-split-triage -->",
      ],
    ],
    [
      "topic hold beside a budget line",
      [
        "<!-- [lisa-human-gate] reason=dashboard-triage -->",
        "Budget approval for the dashboard is tracked elsewhere.",
      ],
    ],
  ])("keeps the hold: %s", (_name, lines) => {
    const result = plan(lines);
    expect(result.lift).toBe(false);
    expect(result.actions).toEqual({
      removeHumanNeededLabel: false,
      addReadyLabel: null,
    });
  });

  it.each([
    [
      "old wording topic hold",
      [
        `${OLD_WORDING} role split triage.`,
        "<!-- [lisa-human-gate] reason=role-split-triage -->",
      ],
    ],
    [
      "keyless topic hold",
      [`${OLD_WORDING} which policy to adopt.`, "<!-- [lisa-human-gate] -->"],
    ],
    [
      "topic hold under a heading",
      [
        "## Notes",
        `${OLD_WORDING} naming triage.`,
        "<!-- [lisa-human-gate] reason=naming-triage -->",
      ],
    ],
  ])("lifts a clean topic hold: %s", (_name, lines) => {
    const result = plan(lines);
    expect(result.lift).toBe(true);
    expect(result.actions.removeHumanNeededLabel).toBe(true);
  });
});
