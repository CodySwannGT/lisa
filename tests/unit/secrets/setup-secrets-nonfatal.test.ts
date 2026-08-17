/**
 * A setup-phase secrets failure must not kill the environment when the session
 * start hook will retry.
 *
 * Regression of record: making `claude-web` materialize at BOTH setup and
 * session start fixed the multi-repo case (the project-scoped hook never
 * registers when the session opens in the parent directory) but introduced a
 * worse failure. `setup.sh` ends in `exec node <this script>`, so a non-zero
 * exit fails the vendor's setup step and Claude Code never starts — observed
 * live on AcmeOrgD/frontend, where the configured bootstrap variable is visible
 * to the session but not to the earlier setup phase.
 *
 * The distinction under test is "will anything try again", not "is this a
 * cloud surface": a setup-only surface and the hook's own authoritative run
 * must both still fail hard, because a silent pass there hands back a session
 * with no credentials and reports it ready.
 * @module tests/unit/secrets/setup-secrets-nonfatal
 */

import { describe, expect, it } from "vitest";

import {
  materializesAtSessionStart,
  materializesAtSetup,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/**
 * Whether a setup-phase failure is survivable, mirroring the runner's rule:
 * fatal unless a later authoritative run will retry.
 * @param requested The explicit `--phase` value, if the caller gave one.
 * @param materializeAt The surface's declared materialization points.
 * @returns True when the failure should be reported and tolerated.
 */
function survivesSetupFailure(
  requested: string | undefined,
  materializeAt: string | null
): boolean {
  return !requested && materializesAtSessionStart(materializeAt);
}

describe("materializeAt covers both phases", () => {
  it('treats "both" as materializing at setup AND at session start', () => {
    // The whole regression lives in this value, so it is asserted directly
    // rather than inferred from the surfaces table.
    expect(materializesAtSetup("both")).toBe(true);
    expect(materializesAtSessionStart("both")).toBe(true);
  });

  it("keeps the single-phase values single-phase", () => {
    expect(materializesAtSetup("setup")).toBe(true);
    expect(materializesAtSessionStart("setup")).toBe(false);
    expect(materializesAtSetup("session-start")).toBe(false);
    expect(materializesAtSessionStart("session-start")).toBe(true);
  });
});

describe("when a setup-phase secrets failure is survivable", () => {
  it('survives on a "both" surface during the setup run', () => {
    // claude-web: the hook runs moments later with the session's environment.
    expect(survivesSetupFailure(undefined, "both")).toBe(true);
  });

  it("is fatal on a setup-only surface", () => {
    // codex-cloud: nothing runs again, so tolerating this would hand back a
    // credential-less session and call it ready.
    expect(survivesSetupFailure(undefined, "setup")).toBe(false);
  });

  it("is fatal when the hook explicitly asks for the secrets phase", () => {
    // `--phase=secrets` IS the authoritative run. If it cannot materialize,
    // there is no later attempt to defer to.
    expect(survivesSetupFailure("secrets", "both")).toBe(false);
  });

  it("is fatal when no materialization is declared at all", () => {
    expect(survivesSetupFailure(undefined, null)).toBe(false);
  });
});
