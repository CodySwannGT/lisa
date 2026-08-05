/**
 * Regression tests for the `both` materialization timing on `claude-web`.
 *
 * The surface used to materialize only from its committed SessionStart hook.
 * That hook is PROJECT-scoped — it lives in a repository's
 * `.claude/settings.json` and only loads when Claude Code's project directory is
 * that repository. A cloud environment configured with more than one repository
 * starts in their parent:
 *
 *     HOME=/root   PWD=/home/user
 *     /home/user/backend   /home/user/infrastructure
 *
 * `/home/user` is not a project root, so no settings load, no hook registers,
 * and nothing materializes at all. Confirmed in a real Claude Code web session:
 * `~/.config/tunnl/` absent and `CLAUDE_PROJECT_DIR` unset, while running the
 * same hook by hand wrote 12 secrets and exited 0.
 * @module tests/unit/secrets/remote-env-materialize-both
 */

import { describe, expect, it } from "vitest";

import {
  materializesAtSessionStart,
  materializesAtSetup,
  selectPhases,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";
import { SURFACES } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";

/** Materializes in the setup run AND from the session-start hook. */
const BOTH = "both";

/** Every phase the setup run performs, in order. */
const ALL_PHASES = ["toolchain", "secrets", "hook"];

describe("claude-web materializes in both places", () => {
  it("declares the both timing", () => {
    expect(SURFACES["claude-web"].materializeAt).toBe(BOTH);
  });

  it("materializes during setup, so a fresh multi-repo environment works", () => {
    // The floor. Without this, a Claude web environment holding more than one
    // repository materialized NOTHING, because the hook could never fire.
    expect(selectPhases(undefined, BOTH)).toEqual(ALL_PHASES);
  });

  it("still honours an explicit --phase=secrets, so the hook keeps working", () => {
    // The refresh. The committed hook re-enters the script this way; returning
    // an empty list would make it a silent no-op and lose rotation pickup on
    // resumed sessions, which skip setup entirely.
    expect(selectPhases("secrets", BOTH)).toEqual(["secrets"]);
  });
});

describe("timing predicates", () => {
  it.each([
    ["setup", true, false],
    ["session-start", false, true],
    [BOTH, true, true],
    [null, false, false],
  ])("%s -> setup=%s sessionStart=%s", (timing, atSetup, atSessionStart) => {
    // Asserted through the predicates rather than string equality, so adding a
    // fourth timing cannot silently take a branch nobody considered.
    expect(materializesAtSetup(timing)).toBe(atSetup);
    expect(materializesAtSessionStart(timing)).toBe(atSessionStart);
  });
});

describe("other surfaces are unchanged", () => {
  it("codex-cloud still materializes only during setup", () => {
    // It has no equivalent hole: its setup field runs inside the checkout.
    expect(SURFACES["codex-cloud"].materializeAt).toBe("setup");
    expect(selectPhases(undefined, "setup")).toEqual(ALL_PHASES);
    expect(selectPhases("secrets", "setup")).toEqual([]);
  });

  it("local and github-actions never materialize", () => {
    // A developer machine and a CI runner read credentials from their own
    // stores; writing a copy to disk there would be a leak, not a feature.
    expect(SURFACES.local.materializeAt).toBeNull();
    expect(SURFACES["github-actions"].materializeAt).toBeNull();
    expect(selectPhases(undefined, null)).toEqual(["toolchain", "hook"]);
  });
});
