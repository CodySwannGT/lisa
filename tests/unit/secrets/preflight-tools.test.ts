/**
 * Tests for the session-start tooling preflight.
 *
 * The assertions that carry weight are the ones proving this is a *caller* and
 * not a second checker: `minVersion` is enforced because `planToolchain`
 * enforces it, an unparseable version fails closed for the same reason, and a
 * tool narrowed to another surface is ignored rather than reported missing.
 * @module tests/unit/secrets/preflight-tools
 */

import { describe, expect, it } from "vitest";

import {
  mergeFloor,
  preflightTools,
  reportTools,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/preflight-tools.mjs";

/**
 * Build a version probe answering from a fixed table.
 * @param installed - Tool name to version; absent means not installed
 * @returns A probe function accepted by `preflightTools`
 */
const probeFrom =
  (installed: Record<string, string | null>) => (name: string) =>
    name in installed
      ? { present: true, version: installed[name] }
      : { present: false, version: null };

const noTools = { tools: { require: [], install: [] } };

/** Repeated across assertions; hoisted so the literal appears once. */
const GH_MISSING = "required but not present";
const MAESTRO_MISSING = "pinned 1.0.0, not installed";
const TRACKER_GH = "tracker is github";
const PLATFORM = "darwin-arm64";

describe("mergeFloor", () => {
  it("adds a derived tool the project did not declare", () => {
    const { tools } = mergeFloor({ require: [] }, [
      { name: "gh", reason: TRACKER_GH },
    ]);
    expect(tools.require).toEqual([{ name: "gh" }]);
  });

  it("lets an explicit declaration win over the derivation", () => {
    // A pinned minVersion is a more specific statement than the floor knows.
    const { tools } = mergeFloor(
      { require: [{ name: "gh", minVersion: "2" }] },
      [{ name: "gh", reason: TRACKER_GH }]
    );
    expect(tools.require).toEqual([{ name: "gh", minVersion: "2" }]);
  });

  it("does not re-add a tool already covered by an install entry", () => {
    const { tools } = mergeFloor(
      { require: [], install: [{ name: "maestro", version: "1.0.0" }] },
      [{ name: "maestro", reason: "e2e coverage configured" }]
    );
    expect(tools.require).toEqual([]);
  });
});

describe("preflightTools", () => {
  it("passes when nothing is declared or derived", () => {
    const result = preflightTools({}, noTools, probeFrom({}), PLATFORM);
    expect(result.verdict).toBe("ok");
  });

  it("passes when a required tool is present", () => {
    const result = preflightTools(
      {},
      { tools: { require: [{ name: "gh" }], install: [] } },
      probeFrom({ gh: "2.40.0" }),
      PLATFORM
    );
    expect(result.verdict).toBe("ok");
  });

  it("blocks when a required tool is absent", () => {
    const result = preflightTools(
      {},
      { tools: { require: [{ name: "gh" }], install: [] } },
      probeFrom({}),
      PLATFORM
    );
    expect(result.verdict).toBe("missing");
    expect(result.blocked.map((step: { name: string }) => step.name)).toEqual([
      "gh",
    ]);
  });

  it("enforces minVersion, because planToolchain does", () => {
    // The defect this replaces: verify-remote-env's own loop accepted any
    // version that answered --version at all.
    const result = preflightTools(
      {},
      { tools: { require: [{ name: "node", minVersion: "20" }], install: [] } },
      probeFrom({ node: "18.19.0" }),
      PLATFORM
    );
    expect(result.verdict).toBe("missing");
    expect(result.blocked[0]?.reason).toContain("older than");
  });

  it("fails closed when a present tool's version cannot be parsed", () => {
    const result = preflightTools(
      {},
      { tools: { require: [{ name: "node", minVersion: "20" }], install: [] } },
      probeFrom({ node: null }),
      PLATFORM
    );
    expect(result.verdict).toBe("missing");
  });

  it("ignores a tool narrowed to another surface", () => {
    const result = preflightTools(
      {},
      {
        tools: {
          require: [{ name: "docker", surfaces: ["remote"] }],
          install: [],
        },
      },
      probeFrom({}),
      PLATFORM
    );
    expect(result.verdict).toBe("ok");
  });

  it("derives a required tool from config the manifest never mentioned", () => {
    const result = preflightTools(
      { tracker: "github" },
      noTools,
      probeFrom({}),
      PLATFORM
    );
    expect(result.blocked.map((step: { name: string }) => step.name)).toEqual([
      "gh",
    ]);
  });
});

describe("reportTools", () => {
  it("says nothing when the verdict is ok", () => {
    expect(
      reportTools({ verdict: "ok", blocked: [], installable: [], reasons: {} })
    ).toBe("");
  });

  it("separates what Lisa can install from what needs a human", () => {
    // A credential can never be self-provisioned; a pinned tool can. Collapsing
    // the two would send someone to do work Lisa was about to do for them.
    const text = reportTools({
      verdict: "missing",
      blocked: [{ name: "gh", reason: GH_MISSING }],
      installable: [{ name: "maestro", reason: MAESTRO_MISSING }],
      reasons: { gh: TRACKER_GH },
    });
    expect(text).toContain("Lisa can install these itself");
    expect(text).toContain("maestro");
    expect(text).toContain("These need you");
    expect(text).toContain("gh");
    expect(text).toContain(`required because ${TRACKER_GH}`);
  });

  it("calls it a failure only when something blocks", () => {
    // "FAILED" alongside exit 0 would teach readers the word means nothing.
    const installOnly = reportTools({
      verdict: "missing",
      blocked: [],
      installable: [{ name: "maestro", reason: MAESTRO_MISSING }],
      reasons: {},
    });
    expect(installOnly).toContain("action available");
    expect(installOnly).not.toContain("FAILED");

    const blocking = reportTools({
      verdict: "missing",
      blocked: [{ name: "gh", reason: GH_MISSING }],
      installable: [],
      reasons: {},
    });
    expect(blocking).toContain("FAILED");
  });

  it("omits the installable section when there is nothing to install", () => {
    const text = reportTools({
      verdict: "missing",
      blocked: [{ name: "gh", reason: GH_MISSING }],
      installable: [],
      reasons: {},
    });
    expect(text).not.toContain("Lisa can install these itself");
  });
});
