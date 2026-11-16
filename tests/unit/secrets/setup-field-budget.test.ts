/**
 * The setup field must fit the vendor's setup-script time budget.
 *
 * A setup script has roughly five minutes before it is killed, and a killed
 * script does not degrade — the vendor reports "Session failed to start: Setup
 * script failed" and the session never starts. Observed on a live Claude Tag
 * channel with the unscoped install.
 *
 * The bootstrap's default is every coding agent it knows: claude, codex,
 * cursor-agent, opencode, agy, copilot. `agy` alone is ~193MB. A remote
 * container needs none of them — it IS an agent — so the field asks for the
 * provider CLI and tools only.
 * @module tests/unit/secrets/setup-field-budget
 */

import { describe, expect, it } from "vitest";

import { AGENTS } from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/catalogue.mjs";
import { planWorkstation } from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/workstation.mjs";
import { SETUP_FIELD } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/**
 * The group a plan row belongs to.
 *
 * The planner is untyped JavaScript that reports rows as bare objects, so the
 * field is read through a presence check rather than assumed.
 * @param row One planned row.
 * @returns Its group, or undefined when the row names none.
 */
const groupOf = (row: object): unknown =>
  "group" in row ? row.group : undefined;

/** The sentinel the field passes to select no agents. */
const NONE = "none";

describe("the setup field's install scope", () => {
  it("asks for no agents", () => {
    expect(SETUP_FIELD).toContain(`--agents=${NONE}`);
  });

  it("still asks for the provider, which is the point of the run", () => {
    expect(SETUP_FIELD).toMatch(/--provider=/);
  });
});

describe(`"${NONE}" as an agent selector`, () => {
  it("matches no agent in the catalogue", () => {
    // The sentinel works because nothing is called this. If an agent named
    // "none" were ever added, the field would silently start installing it —
    // and the failure would be a killed setup script, not a wrong tool.
    expect(AGENTS.map(a => a.name)).not.toContain(NONE);
  });

  it("plans zero agents", () => {
    const plan = planWorkstation({
      agents: [NONE],
      probe: () => ({ present: true, version: "1.0.0" }),
    });

    expect(plan.filter(row => groupOf(row) === "agent")).toEqual([]);
  });

  it("still plans the provider and the tools", () => {
    // Scoping the install must not scope away the reason for running it.
    const plan = planWorkstation({
      agents: [NONE],
      provider: "bitwarden",
      probe: () => ({ present: false, version: null }),
    });

    expect(plan.some(row => groupOf(row) === "provider")).toBe(true);
    expect(plan.some(row => groupOf(row) === "tool")).toBe(true);
  });
});
