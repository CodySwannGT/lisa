/**
 * Tests for the config-implied CLI floor.
 *
 * The floor promotes `detect-tooling`'s pairings from proposal-time hints to a
 * runtime derivation, so a project that never ran the skill — or ran it before
 * adopting Maestro — is still protected by what its own config states.
 * @module tests/unit/secrets/tool-floor
 */

import { describe, expect, it } from "vitest";

import { toolFloor } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/tool-floor.mjs";

/**
 * Derived tool names only, for assertions that ignore the reason text.
 * @param config - Parsed config root to derive from
 * @returns Sorted CLI names the config implies
 */
const names = (config?: object) =>
  toolFloor(config).map((entry: { name: string }) => entry.name);

describe("toolFloor", () => {
  it("derives gh from a github tracker", () => {
    expect(names({ tracker: "github" })).toEqual(["gh"]);
  });

  it("derives gh from a github PRD source", () => {
    expect(names({ source: "github" })).toEqual(["gh"]);
  });

  it("derives bws from the bitwarden provider", () => {
    expect(names({ secrets: { provider: "bitwarden" } })).toEqual(["bws"]);
  });

  it("derives doppler from the doppler provider", () => {
    expect(names({ secrets: { provider: "doppler" } })).toEqual(["doppler"]);
  });

  it("does not derive a CLI from the env provider", () => {
    expect(names({ secrets: { provider: "env" } })).toEqual([]);
  });

  it("derives maestro from configured e2e coverage", () => {
    expect(
      names({ quality: { e2eCoverage: { maestro: { routes: 5 } } } })
    ).toEqual(["maestro"]);
  });

  it("does not derive maestro from playwright-only coverage", () => {
    expect(
      names({ quality: { e2eCoverage: { playwright: { routes: 5 } } } })
    ).toEqual([]);
  });

  it("unions several derivations, sorted", () => {
    expect(
      names({ tracker: "github", secrets: { provider: "bitwarden" } })
    ).toEqual(["bws", "gh"]);
  });

  it("derives nothing from an empty config", () => {
    expect(names({})).toEqual([]);
    expect(names()).toEqual([]);
  });

  it("names the config key responsible, so the requirement can be argued with", () => {
    const [entry] = toolFloor({ tracker: "github" });
    expect(entry.reason).toContain("github");
    expect(entry.reason).toContain("gh");
  });

  it("treats a malformed config as deriving nothing rather than throwing", () => {
    // A structural defect is the schema validator's to report, in its own
    // vocabulary. Throwing here would make a readiness check the place it
    // first surfaces, with a message about tools that names nothing to fix.
    expect(() =>
      toolFloor({ secrets: "not-an-object" as never })
    ).not.toThrow();
    expect(names({ quality: null as never })).toEqual([]);
  });
});
