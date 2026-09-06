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
      reportTools({
        verdict: "ok",
        blocked: [],
        installable: [],
        unverified: [],
        reasons: {},
      })
    ).toBe("");
  });

  it("separates what Lisa can install from what needs a human", () => {
    // A credential can never be self-provisioned; a pinned tool can. Collapsing
    // the two would send someone to do work Lisa was about to do for them.
    const text = reportTools({
      verdict: "missing",
      blocked: [{ name: "gh", reason: GH_MISSING }],
      installable: [{ name: "maestro", reason: MAESTRO_MISSING }],
      unverified: [],
      reasons: { gh: TRACKER_GH },
    });
    expect(text).toContain("Lisa can install these itself");
    expect(text).toContain("maestro");
    expect(text).toContain("STOP — these block the work");
    expect(text).toContain("gh");
    expect(text).toContain(`required because ${TRACKER_GH}`);
  });

  it("calls it a failure only when something blocks", () => {
    // "FAILED" alongside exit 0 would teach readers the word means nothing.
    const installOnly = reportTools({
      verdict: "missing",
      blocked: [],
      installable: [{ name: "maestro", reason: MAESTRO_MISSING }],
      unverified: [],
      reasons: {},
    });
    expect(installOnly).toContain("action available");
    expect(installOnly).not.toContain("FAILED");

    const blocking = reportTools({
      verdict: "missing",
      blocked: [{ name: "gh", reason: GH_MISSING }],
      installable: [],
      unverified: [],
      reasons: {},
    });
    expect(blocking).toContain("FAILED");
  });

  it("omits the installable section when there is nothing to install", () => {
    const text = reportTools({
      verdict: "missing",
      blocked: [{ name: "gh", reason: GH_MISSING }],
      installable: [],
      unverified: [],
      reasons: {},
    });
    expect(text).not.toContain("Lisa can install these itself");
  });
});

/**
 * An install entry with no artifact for the running platform.
 *
 * Deliberately the real shape that caused this: a tool pinned for Linux only,
 * on a machine that is not Linux. No network, no real vault, no dependence on
 * what the developer's machine happens to hold.
 * @returns A manifest whose only install entry cannot resolve on macOS.
 */
const linuxOnly = () => ({
  require: [],
  install: [
    {
      name: "bws",
      version: "2.1.0",
      install: "release-zip",
      platforms: {
        "linux-arm64": {
          url: "https://example.test/a.zip",
          sha256: "a".repeat(64),
        },
        "linux-x64": {
          url: "https://example.test/b.zip",
          sha256: "b".repeat(64),
        },
      },
    },
  ],
});

describe("a tool with no pin for this platform", () => {
  it("does not block when the binary is installed and usable", () => {
    // The defect: `invalid` answers "can Lisa provision this here?", which for
    // an unpinned platform is correctly no. The preflight asks "can the agent
    // use this right now?" and reused the provisioning verdict, so a bws that
    // resolved secrets in the same session was reported as a blocker.
    const result = preflightTools(
      {},
      { tools: linuxOnly() },
      probeFrom({ bws: "2.1.0" }),
      PLATFORM
    );
    expect(result.blocked).toEqual([]);
    expect(result.unverified.map((s: { name: string }) => s.name)).toEqual([
      "bws",
    ]);
  });

  it("blocks exactly as before when the binary is absent", () => {
    // Presence-only, not a skip. Dropping the entry would report clean for a
    // tool that is neither pinned nor installed — a green from a check that
    // never ran.
    const result = preflightTools(
      {},
      { tools: linuxOnly() },
      probeFrom({}),
      PLATFORM
    );
    expect(result.verdict).toBe("missing");
    expect(result.blocked.map((s: { name: string }) => s.name)).toEqual([
      "bws",
    ]);
    expect(result.blocked[0]?.reason).toContain("no pin for darwin-arm64");
    expect(result.blocked[0]?.reason).toContain("linux-arm64, linux-x64");
  });

  it("still blocks a present binary that is below a declared minVersion", () => {
    // The pin names an artifact for another platform and is unusable here. A
    // minimum is a statement about the tool itself, and survives.
    const manifest = linuxOnly();
    const result = preflightTools(
      {},
      {
        tools: {
          ...manifest,
          install: [{ ...manifest.install[0], minVersion: "3.0.0" }],
        },
      },
      probeFrom({ bws: "2.1.0" }),
      PLATFORM
    );
    expect(result.verdict).toBe("missing");
    expect(result.blocked.map((s: { name: string }) => s.name)).toEqual([
      "bws",
    ]);
  });

  it("keeps blocking a malformed platforms map, present or not", () => {
    // A broken declaration is not a fact about this machine, and a binary
    // happening to be on PATH does not redeem it.
    const result = preflightTools(
      {},
      {
        tools: {
          require: [],
          install: [
            { name: "bws", version: "2.1.0", platforms: ["linux-x64"] },
          ],
        },
      },
      probeFrom({ bws: "2.1.0" }),
      PLATFORM
    );
    expect(result.verdict).toBe("missing");
    expect(result.blocked.map((s: { name: string }) => s.name)).toEqual([
      "bws",
    ]);
    expect(result.blocked[0]?.reason).toContain("must be an object");
  });

  it("exits the report without a route-to-blocked instruction", () => {
    // The load-bearing detail is the instruction, not the verdict: a
    // table-lookup gap was being converted into durable tracker state.
    const result = preflightTools(
      {},
      { tools: linuxOnly() },
      probeFrom({ bws: "2.1.0" }),
      PLATFORM
    );
    const text = reportTools(result);
    expect(text).not.toContain("FAILED");
    expect(text).not.toContain("Route the item to");
    expect(text).not.toContain("These need you");
    expect(text).toContain("cannot vouch");
    expect(text).toContain("2.1.0");
    expect(text).toContain("Nothing here blocks your work");
  });
});

describe("the report as an operator reads it", () => {
  /**
   * One of each tier: the exact pairing two operators misread.
   *
   * `unverified` is present and empty rather than omitted. `preflightTools`
   * always returns the key, so a fixture without it describes a result the
   * producer cannot emit — and the report reads `result.unverified.length`
   * unconditionally, so omitting it fails on a shape no operator will ever see.
   * Every spread below inherits it, which is why only this one declaration
   * needs it.
   */
  const mixed = {
    verdict: "missing",
    blocked: [{ name: "bws", reason: "bws: no pin for darwin-arm64." }],
    installable: [{ name: "jq", reason: "jq 1.8.1 does not match pin 1.8.2" }],
    unverified: [],
    reasons: { bws: 'secrets.provider is "bitwarden"' },
  };

  it("puts what stops the work above what Lisa will handle", () => {
    // The softer tier rendered first, under a header saying FAILED, so a reader
    // met an installable tool while still holding the word.
    const text = reportTools(mixed);
    expect(text.indexOf("[BLOCKED]")).toBeGreaterThan(-1);
    expect(text.indexOf("[BLOCKED]")).toBeLessThan(
      text.indexOf("[INSTALLABLE]")
    );
  });

  it("scopes the FAILED header with counts", () => {
    // A bare "FAILED." says nothing about how much of the screen it covers.
    expect(reportTools(mixed)).toContain(
      "Tooling preflight FAILED — 1 tool blocks. 1 more Lisa can install for you."
    );
  });

  it("agrees with itself about how many tools block", () => {
    const two = reportTools({
      ...mixed,
      blocked: [
        { name: "bws", reason: GH_MISSING },
        { name: "gh", reason: GH_MISSING },
      ],
      installable: [],
    });
    expect(two).toContain("FAILED — 2 tools block.");
    expect(two).not.toContain("more Lisa can install");
  });

  it("keeps the route-to-blocked instruction inside the blocking section", () => {
    // This instruction is what a session ACTS on. Trailing the whole report, it
    // read as covering every tool listed anywhere above it, which is how a
    // layout problem became a routing decision written into the backlog.
    const text = reportTools(mixed);
    const instruction = text.indexOf("Route that");
    expect(instruction).toBeGreaterThan(-1);
    expect(instruction).toBeLessThan(text.indexOf("NOT A BLOCKER"));
    expect(text).toContain("the tools above");
    expect(text).toContain("Nothing else in this report is a reason to stop.");
  });

  it("marks the two tiers differently, line by line", () => {
    // Same indent and same `name — reason` left nothing but prose headers to
    // tell an action from a stop.
    const text = reportTools(mixed);
    expect(text).toContain("  [BLOCKED] bws — ");
    expect(text).toContain("  [INSTALLABLE] jq — ");
    expect(text).not.toContain("[BLOCKED] jq");
    expect(text).not.toContain("[INSTALLABLE] bws");
  });

  it("counts the installable tools when nothing blocks", () => {
    const text = reportTools({ ...mixed, blocked: [], reasons: {} });
    expect(text).toContain(
      "action available. Nothing blocks; 1 tool Lisa can install for you."
    );
    expect(text).not.toContain("FAILED");
    expect(text).not.toContain("Route that");
  });
});
