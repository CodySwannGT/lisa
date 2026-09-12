/** The report distinguishes blockers from tools Lisa can install. */
import { describe, expect, it } from "vitest";

import { reportTools } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/preflight-tools.mjs";

const GH_MISSING = "required but not present";

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
