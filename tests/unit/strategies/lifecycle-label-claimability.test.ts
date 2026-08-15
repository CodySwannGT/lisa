/**
 * Tests for whether build-intake may claim an issue.
 *
 * The Phase-2 scan filters on the ready role alone, so an issue carrying BOTH
 * ready and claimed comes back as a candidate. Trust resolution rescued the
 * case where a *bot* applied the claim, and said nothing about the case where a
 * *human* did — which is the strongest claim signal there is, and the one being
 * ignored. An issue a person marked in-progress is somebody's active work.
 *
 * The load-bearing pair is the two directions together: a trusted claim must
 * block, and an untrusted one must not. Asserting only the first would pass
 * against an implementation that reads the raw label set and quietly undoes the
 * bot fix.
 * @module tests/unit/strategies/lifecycle-label-claimability
 */

import { describe, expect, it } from "vitest";

import {
  claimedLifecycleLabel,
  resolveClaimability,
} from "../../../plugins/src/base/scripts/lifecycle-label-trust.mjs";

const CLAIMED = "status:in-progress";
const READY = "status:ready";
const CUSTOM = "lane:mine";

describe("resolveClaimability", () => {
  it("refuses an issue carrying a trusted claim", () => {
    const verdict = resolveClaimability({
      trusted: [READY, CLAIMED],
      config: {},
    });
    expect(verdict.claimable).toBe(false);
    expect(verdict.reason).toContain("somebody is working it");
  });

  it("allows an issue that is merely ready", () => {
    expect(
      resolveClaimability({ trusted: [READY], config: {} }).claimable
    ).toBe(true);
  });

  it("ignores a claim the trust pass refused to believe", () => {
    // The other direction, and the one that keeps this from undoing #2539: a
    // reflexive bot label leaves the issue claimable exactly as if absent.
    // `trusted` is the classifier's output, so an untrusted claim never appears.
    const verdict = resolveClaimability({ trusted: [READY], config: {} });
    expect(verdict.claimable).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it("honours a project's configured claimed role", () => {
    const config = { github: { labels: { build: { claimed: CUSTOM } } } };
    expect(resolveClaimability({ trusted: [CUSTOM], config }).claimable).toBe(
      false
    );
    // And the default must not still be consulted once a project renamed it.
    expect(resolveClaimability({ trusted: [CLAIMED], config }).claimable).toBe(
      true
    );
  });

  it("survives a missing or malformed trusted list", () => {
    expect(resolveClaimability({ config: {} }).claimable).toBe(true);
    expect(
      resolveClaimability({ trusted: undefined, config: undefined }).claimable
    ).toBe(true);
  });
});

describe("claimedLifecycleLabel", () => {
  it("falls back to the shipped default", () => {
    expect(claimedLifecycleLabel({})).toBe(CLAIMED);
    expect(claimedLifecycleLabel(undefined)).toBe(CLAIMED);
  });

  it("reads the configured role and trims it", () => {
    expect(
      claimedLifecycleLabel({
        github: { labels: { build: { claimed: `  ${CUSTOM}  ` } } },
      })
    ).toBe(CUSTOM);
  });

  it("treats a blank configured role as unset", () => {
    // A blank string would otherwise become a label nothing can carry, so every
    // issue would read as unclaimed — the failure this whole item is about.
    expect(
      claimedLifecycleLabel({
        github: { labels: { build: { claimed: "   " } } },
      })
    ).toBe(CLAIMED);
  });
});
