/**
 * A consumer's deliberate pin can say so, and is then left alone (#3596).
 *
 * `pinReusableWorkflowRefs` rewrites EVERY Lisa caller line to the installed
 * release's SHA. It has one exemption — `shouldPin`, which leaves a callee this
 * release does not carry — and that exemption is about what LISA can vouch for,
 * not about what the HOST decided.
 *
 * So a consumer who deliberately repinned a caller, in a reviewed commit, has it
 * rewritten on the next apply with no direction check and no way to object. The
 * migration's own predecessor recorded the asymmetry: a branch ref is respected
 * as host policy because Lisa "cannot infer that host's release policy", while a
 * SHA pin is not — and a SHA pin is the STRONGER statement of that policy.
 *
 * ## What this suite deliberately does NOT re-assert
 *
 * Two halves of the original report are already closed on `origin/main`, and
 * asserting them here would be re-litigating settled work:
 *
 *  - The pin no longer comes from `ensure-nightly-e2e-workflow-pins`; that
 *    migration's docstring records the arm moving to
 *    `ensure-pinned-reusable-workflow-refs`, so two migrations no longer undo
 *    each other on every apply.
 *  - The stale version comment cannot recur. The rewrite replaces the trailing
 *    comment wholesale on the same line it rewrites the ref, and `isPinnedAt`
 *    requires BOTH to match — so a comment can no longer disagree with the SHA
 *    above it, which was the original tell.
 *
 * ## The declaration, and why it is shaped like #3597's
 *
 * Presence is the declaration and the text after it is the reason, exactly as
 * the `divergence:` field settled for plugin pins. The difference is where it
 * can live: a consumer's workflow file has no registry and no frontmatter, so
 * the only place a declaration can sit beside the thing it governs is the
 * caller line's own comment.
 *
 * It is honoured and never silent: a marker that quietly suppressed a rewrite
 * would be indistinguishable from a migration that did not run.
 * @module tests/unit/core/reusable-workflow-deliberate-pin
 */
import { describe, expect, it } from "vitest";

import {
  isDeliberatePin,
  isPinnedAt,
  findReusableWorkflowRefs,
  pinReusableWorkflowRefs,
  type ReleasePin,
} from "../../../src/core/reusable-workflow-pin.js";

/** The release the migration would pin everything to. */
const PIN: ReleasePin = {
  sha: "1d601d3045b937aeb2465350044fee99c37bdc39",
  version: "4.29.0",
};

/** A SHA a consumer chose for itself, different from the release pin. */
const HOST_SHA = "9c8f3675158687abd73d0ffb61aa00fad3b9befb";

/** A caller line carrying the host's own pin and a deliberate declaration. */
const DECLARED = `    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@${HOST_SHA} # lisa-pin: deliberate — repinned to a ref that loads`;

/** The same line without a declaration: ordinary drift, still rewritten. */
const UNDECLARED = `    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@${HOST_SHA} # v4.29.1`;

describe("a declared deliberate pin is left exactly as written", () => {
  it("does not rewrite the ref", () => {
    expect(pinReusableWorkflowRefs(DECLARED, PIN)).toBe(DECLARED);
  });

  it("does not rewrite the comment either", () => {
    // The comment carries the REASON. Replacing it wholesale, as the normal
    // path does, would delete the declaration while honouring it once — so the
    // next apply would rewrite the ref with nothing left to object.
    expect(pinReusableWorkflowRefs(DECLARED, PIN)).toContain("deliberate");
  });

  it("counts as settled, so nothing reports it as needing a pin", () => {
    const [reference] = findReusableWorkflowRefs(DECLARED);

    expect(reference).toBeDefined();
    expect(isPinnedAt(reference as never, PIN)).toBe(true);
  });

  it("recognises the marker case-insensitively, with or without a reason", () => {
    // The argument is comment text WITHOUT its `#`, which is what `commentOf`
    // hands the production path — asserting the `#` form here would test a
    // shape no caller ever produces.
    for (const comment of [
      "LISA-PIN: DELIBERATE",
      "lisa-pin: deliberate",
      "lisa-pin:deliberate because the release ref does not load",
      "  lisa-pin: deliberate — repinned to a ref that loads",
    ]) {
      expect(isDeliberatePin(comment)).toBe(true);
    }
  });
});

describe("rejection controls: the migration still migrates", () => {
  it("still rewrites an UNDECLARED host pin", () => {
    // THE control. A marker that suppressed every rewrite would satisfy every
    // assertion above and retire the migration — which exists because a caller
    // left on a mutable ref never self-heals.
    const result = pinReusableWorkflowRefs(UNDECLARED, PIN);

    expect(result).toContain(PIN.sha);
    expect(result).toContain("# v4.29.0");
    expect(result).not.toContain(HOST_SHA);
  });

  it("still rewrites a caller on a branch ref", () => {
    const main =
      "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main";

    expect(pinReusableWorkflowRefs(main, PIN)).toContain(PIN.sha);
  });

  it("does not treat an ordinary version comment as a declaration", () => {
    expect(isDeliberatePin("# v4.29.1")).toBe(false);
    expect(isDeliberatePin(null)).toBe(false);
  });

  it("does not treat prose merely mentioning the words as a declaration", () => {
    // The marker is a key, not a topic. A comment discussing pinning policy
    // must not accidentally exempt the line it sits on.
    expect(isDeliberatePin("# this pin is deliberate, see the ADR")).toBe(
      false
    );
  });

  it("leaves a commented-out caller alone, as before", () => {
    const commented = `# uses: CodySwannGT/lisa/.github/workflows/quality.yml@main`;

    expect(pinReusableWorkflowRefs(commented, PIN)).toBe(commented);
  });

  it("still rewrites every other caller in a file carrying one declaration", () => {
    // A declaration is per-line. One deliberate pin must not exempt the file.
    const file = [
      DECLARED,
      "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main",
    ].join("\n");
    const result = pinReusableWorkflowRefs(file, PIN);

    expect(result).toContain(HOST_SHA);
    expect(result).toContain(`quality.yml@${PIN.sha}`);
  });
});
