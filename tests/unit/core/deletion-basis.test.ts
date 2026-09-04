/**
 * The basis a declared deletion path must carry before Lisa will remove it.
 *
 * `deletions.json` authorises a removal by the path being LISTED and nothing
 * else. CodySwannGT/lisa#3656 closed that for `.github/workflows/` — 42 of 255
 * declared paths — by reading each workflow's own ownership header. These cases
 * pin the rule for the other 213.
 *
 * The measurement that shaped the design, taken against `main`: of those 213,
 * **11** are attributable to a lane Lisa still ships and **202** are not. So the
 * obvious gate — delete only what Lisa currently ships — fails on 95% of the
 * manifest, and the 202 are the ones that matter: renamed skill trees whose
 * stranding leaves every consumer carrying dead directories forever. Ownership
 * is a per-consumer fact and the manifest is a repo-side artifact, so it cannot
 * be inferred here at all. It has to be declared.
 * @module tests/unit/core/deletion-basis
 */
import { describe, expect, it } from "vitest";

import type { DeletionsConfig } from "../../../src/core/config.js";
import {
  basisAuthorisesDeletion,
  countDeletionBases,
  resolveDeletionBasis,
  unclassifiedDeletionPaths,
} from "../../../src/core/deletion-basis.js";

const PATH = "jest.config.local.ts";
const NEEDS_REVIEW = "needs-review";

/**
 * Build a manifest around one declared path.
 * @param extra - Fields layered onto the minimal manifest.
 * @returns A manifest declaring PATH.
 */
const manifest = (extra: Partial<DeletionsConfig> = {}): DeletionsConfig => ({
  paths: [PATH],
  ...extra,
});

describe("resolveDeletionBasis", () => {
  it("reports an absent basis as unclassified, not as unowned", () => {
    // The distinction is the whole point: "I cannot tell" has to be a third
    // answer, or the uncertain case is silently resolved as one of the other
    // two — and one of those two deletes a file out of someone's repository.
    expect(resolveDeletionBasis(manifest(), PATH).kind).toBe("unclassified");
  });

  it("reads `owned`", () => {
    expect(
      resolveDeletionBasis(manifest({ basis: { [PATH]: "owned" } }), PATH).kind
    ).toBe("owned");
  });

  it("reads `legacy:` and keeps the prose", () => {
    const basis = resolveDeletionBasis(
      manifest({ basis: { [PATH]: "legacy: renamed in 4.20.0 (#1234)" } }),
      PATH
    );
    expect(basis.kind).toBe("legacy");
    expect(basis.reason).toBe("renamed in 4.20.0 (#1234)");
  });

  it("treats `legacy:` with no reason as unclassified", () => {
    // The kind exists to record WHY. An empty reason is the debt without the
    // marker that makes it countable, so it must not pass as classified — that
    // would be a way to satisfy the gate while saying nothing.
    expect(
      resolveDeletionBasis(manifest({ basis: { [PATH]: "legacy:  " } }), PATH)
        .kind
    ).toBe("unclassified");
  });

  it("reads `needs-review`", () => {
    expect(
      resolveDeletionBasis(manifest({ basis: { [PATH]: NEEDS_REVIEW } }), PATH)
        .kind
    ).toBe(NEEDS_REVIEW);
  });

  it("rejects a basis it does not recognise", () => {
    // Fail closed on a typo. A basis that resolves to nothing known is not a
    // licence to delete; the alternative is that `"ownd"` deletes a file.
    expect(
      resolveDeletionBasis(
        manifest({ basis: { [PATH]: "probably fine" } }),
        PATH
      ).kind
    ).toBe("unclassified");
  });

  it("lets `force` outrank the basis map", () => {
    const basis = resolveDeletionBasis(
      manifest({
        basis: { [PATH]: NEEDS_REVIEW },
        force: { [PATH]: "Removed fleet-wide (#3590)" },
      }),
      PATH
    );
    expect(basis.kind).toBe("force");
    expect(basis.reason).toBe("Removed fleet-wide (#3590)");
  });

  it("ignores an empty force reason", () => {
    // `force` prints its reason beside the deletion, and a blank one is a
    // removal with no explanation — exactly what the field exists to prevent.
    expect(
      resolveDeletionBasis(manifest({ force: { [PATH]: "   " } }), PATH).kind
    ).toBe("unclassified");
  });
});

describe("basisAuthorisesDeletion", () => {
  it("authorises every declared kind, including needs-review", () => {
    // `needs-review` MUST authorise. The field lands with every existing path
    // already marked, so an existing consumer sees byte-identical behaviour and
    // the gate binds only on paths added afterwards. If it refused, shipping
    // the mechanism would silently stop 244 removals that are working today.
    for (const value of ["owned", NEEDS_REVIEW, "legacy: because"])
      expect(
        basisAuthorisesDeletion(
          resolveDeletionBasis(manifest({ basis: { [PATH]: value } }), PATH)
        ),
        value
      ).toBe(true);
  });

  it("refuses an unclassified path", () => {
    expect(
      basisAuthorisesDeletion(resolveDeletionBasis(manifest(), PATH))
    ).toBe(false);
  });
});

describe("unclassifiedDeletionPaths", () => {
  it("finds a declared path with no basis", () => {
    expect(unclassifiedDeletionPaths(manifest())).toEqual([PATH]);
  });

  it("finds nothing when every path is classified", () => {
    expect(
      unclassifiedDeletionPaths(manifest({ basis: { [PATH]: NEEDS_REVIEW } }))
    ).toEqual([]);
  });

  it("ignores a path the manifest already protects with keep", () => {
    // A kept path is never deleted, so demanding a reason for its removal would
    // be demanding prose for something that does not happen.
    expect(unclassifiedDeletionPaths(manifest({ keep: [PATH] }))).toEqual([]);
  });
});

describe("countDeletionBases", () => {
  it("counts each kind, including zeroes", () => {
    const counts = countDeletionBases({
      paths: ["a", "b", "c", "d"],
      force: { d: "a ruling" },
      basis: { a: "owned", b: "legacy: gone in 4.1.0", c: NEEDS_REVIEW },
    });
    expect(counts).toEqual({
      owned: 1,
      legacy: 1,
      [NEEDS_REVIEW]: 1,
      force: 1,
      unclassified: 0,
    });
  });
});
