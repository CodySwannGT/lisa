/**
 * An operator's UPGRADE is not drift, so an apply must not revert it (#3505).
 *
 * Bumping `@codyswann/lisa` in a consumer repo silently reverted on the first
 * `bun install`: the declared version went back, `node_modules` went back with
 * it, the lockfile never moved, and the install exited 0. A second install made
 * it stick, so the operator's reasonable conclusion was "the bump did not take"
 * — and the likely next moves are giving up, or hand-editing around the
 * reconciliation into a package/asset skew.
 *
 * ## The mechanism, and why the revert was defensible before this
 *
 * `alignLisaPin` rewrites the host's pin to the version DOING the apply, and
 * the invariant behind that is real: an apply writes templates that call into
 * the package's own API, so the applied version and the installed version are
 * two halves of one thing. When they drift, a config file calls an export the
 * installed package does not have and every run dies at config load (#2953).
 *
 * What the rule never distinguished is DIRECTION. A declared version OLDER than
 * the applying one is drift — the apply just wrote newer files and the pin has
 * to catch up. A declared version NEWER is an operator upgrading, and reverting
 * it is the one direction that undoes an intent rather than correcting an
 * accident.
 *
 * ## Leaving it is what makes a single install enough
 *
 * The files this apply wrote are still the older version's, so the tree is not
 * yet consistent — but the pin now names where it is going, the next install
 * resolves that version, and its apply converges everything. Reverting instead
 * guaranteed the second install, because it destroyed the only record that an
 * upgrade had been asked for.
 *
 * ## Why this is asserted at all
 *
 * MEASURED before writing it: no test anywhere asserted that an intended
 * version bump survives an apply. `alignLisaPin` had no direct test at all. The
 * silence was not merely unfixed, it was unwatched — which is the more durable
 * half of this defect, and the reason the rejection controls below matter as
 * much as the new behaviour.
 * @module tests/unit/strategies/lisa-pin-upgrade-survives
 */
import { describe, expect, it } from "vitest";

import { alignLisaPinForTest } from "../../../src/strategies/package-lisa.js";

/** The package whose pin the apply reconciles. */
const LISA = "@codyswann/lisa";

/** The version performing the apply in every case below. */
const APPLYING = "4.23.20";

/** A newer version an operator has just declared: the upgrade. */
const NEWER = "4.26.2";

/** An older declared version: real drift the apply should correct. */
const OLDER = "4.20.0";

/**
 * Run the pin alignment over a manifest declaring `spec` in devDependencies.
 *
 * @param spec - What the host declares, or undefined for no pin at all
 * @returns The resulting pin and the operator notes
 */
function align(spec: string | undefined): {
  readonly pin: unknown;
  readonly notes: readonly string[];
} {
  const manifest =
    spec === undefined
      ? { name: "host" }
      : { name: "host", devDependencies: { [LISA]: spec } };
  const result = alignLisaPinForTest(manifest, APPLYING);
  const dev = result.packageJson["devDependencies"] as
    | Record<string, unknown>
    | undefined;
  return { pin: dev?.[LISA], notes: result.notes };
}

describe("an upgrade survives the apply that did not ship it", () => {
  it("leaves a NEWER declared version exactly as the operator wrote it", () => {
    expect(align(NEWER).pin).toBe(NEWER);
  });

  it("leaves a newer RANGE alone too, since its floor is still ahead", () => {
    // `^4.26.0` cannot be satisfied by 4.23.20, so rewriting it to the applying
    // version is the same revert wearing a range.
    expect(align("^4.26.0").pin).toBe("^4.26.0");
  });

  it("says what happened and what completes the upgrade", () => {
    // The AC's other half: if the tree is left inconsistent for one install,
    // the run has to say so and name the remedy. Silence is the defect.
    const note = align(NEWER).notes.join(" ");

    expect(note).toContain(NEWER);
    expect(note).toContain(APPLYING);
    expect(note).toContain("install");
  });

  it("does not claim to have pinned anything", () => {
    expect(align(NEWER).notes.join(" ")).not.toContain("Pinned");
  });
});

describe("rejection controls: the reconciliation still reconciles", () => {
  it("still corrects an OLDER declared version, which is real drift", () => {
    // THE control. A fix that simply stopped rewriting would satisfy every
    // assertion above and retire the invariant the phase exists for: the files
    // this apply wrote are the applying version's, and a pin behind them means
    // a config calls an export the installed package does not have.
    expect(align(OLDER).pin).toBe(APPLYING);
  });

  it("still says so when it corrects one", () => {
    expect(align(OLDER).notes.join(" ")).toContain("Pinned");
  });

  it("still adds a pin to a host that has none", () => {
    expect(align(undefined).pin).toBe(APPLYING);
  });

  it("is silent when the pin already names the applying version", () => {
    const result = align(APPLYING);

    expect(result.pin).toBe(APPLYING);
    expect(result.notes).toEqual([]);
  });

  it("still leaves a location spec alone and reports the skew", () => {
    // `file:`/`link:`/`workspace:` mean somebody is developing against a
    // checkout; replacing one with a version number breaks that setup.
    const result = align("file:../lisa");

    expect(result.pin).toBe("file:../lisa");
    expect(result.notes.join(" ")).toContain("local copy");
  });

  it("still rewrites a range the applying version already satisfies", () => {
    // `^4.20.0` admits 4.23.20 without requiring it, so a lockfile resolving an
    // older build produces exactly the skew this phase closes. Unchanged.
    expect(align("^4.20.0").pin).toBe(APPLYING);
  });
});
