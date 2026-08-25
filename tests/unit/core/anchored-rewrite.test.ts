/**
 * Tests for per-step accountability in multi-step transforms
 * (CodySwannGT/lisa#3081).
 *
 * The load-bearing pair is `a transform whose second step silently stops
 * matching` and its negative control `a transform whose every step applies`.
 * The first reconstructs the exact shape that shipped in
 * CodySwannGT/lisa#2980 — two anchored rewrites where the FIRST one's anchor
 * was deleted out from under it — and asserts it now fails NAMING that step.
 * Under the whole-output comparison it replaces, the same input returned a
 * partially-applied result and the guard stayed green. The control exists
 * because a mechanism that failed on everything would satisfy the first
 * assertion and be useless.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED — no
 * assertion here computes its expectation by calling the code under test.
 * @module tests/unit/core/anchored-rewrite
 */
import { describe, expect, it } from "vitest";

import {
  applyRewrites,
  MissingAnchorError,
  replaceOptional,
  replaceOrThrow,
  type Rewrite,
} from "../../../src/core/anchored-rewrite.js";

/** The import line CodySwannGT/lisa#2980 deleted, which step one anchored on. */
const DELETED_IMPORT = 'import { execFileSync } from "node:child_process";';

/** The expression step two anchors on, which survived #2980 untouched. */
const SURVIVING_ANCHOR = "path.resolve(root ?? process.cwd())";

/** The `node:path` import both fixture sources open with. */
const PATH_IMPORT = 'import path from "node:path";';

/** Source as it looked BEFORE #2980: both anchors present. */
const SOURCE_WITH_BOTH = [
  PATH_IMPORT,
  DELETED_IMPORT,
  "",
  `const base = ${SURVIVING_ANCHOR};`,
].join("\n");

/** Source as it looked AFTER #2980: step one's anchor is gone. */
const SOURCE_MISSING_FIRST = [
  PATH_IMPORT,
  "",
  `const base = ${SURVIVING_ANCHOR};`,
].join("\n");

/** The two-step transform the fixture in #2980 performed. */
const PROVER_REWRITES: readonly Rewrite[] = [
  {
    anchor: DELETED_IMPORT,
    label: "the fileURLToPath import",
    replacement: `${DELETED_IMPORT}\nimport { fileURLToPath } from "node:url";`,
  },
  {
    anchor: SURVIVING_ANCHOR,
    label: "the default root",
    replacement: "path.resolve(root ?? scriptDirectory)",
  },
];

/** What the caller says it is transforming, quoted in every failure. */
const CONTEXT = "the pre-move prover fixture";

describe("applyRewrites", () => {
  it("a transform whose second step silently stops matching now fails, naming that step", () => {
    // The pre-fix idiom on this exact input:
    //   const out = source.replace(A, A2).replace(B, B2);
    //   if (out === source) throw ...
    // Step one no-ops, step two lands, `out !== source`, guard passes, and the
    // caller receives a partially-applied — and invalid — result. Proven right
    // here so the assertion below is measured against it rather than asserted
    // from memory.
    const wholeOutput = SOURCE_MISSING_FIRST.replace(
      DELETED_IMPORT,
      `${DELETED_IMPORT}\nimport { fileURLToPath } from "node:url";`
    ).replace(SURVIVING_ANCHOR, "path.resolve(root ?? scriptDirectory)");
    expect(wholeOutput).not.toBe(SOURCE_MISSING_FIRST);
    expect(wholeOutput).not.toContain("fileURLToPath");

    expect(() =>
      applyRewrites(SOURCE_MISSING_FIRST, PROVER_REWRITES, CONTEXT)
    ).toThrow(/the fileURLToPath import/);
  });

  it("a transform whose every step applies still succeeds", () => {
    expect(applyRewrites(SOURCE_WITH_BOTH, PROVER_REWRITES, CONTEXT)).toBe(
      [
        PATH_IMPORT,
        DELETED_IMPORT,
        'import { fileURLToPath } from "node:url";',
        "",
        "const base = path.resolve(root ?? scriptDirectory);",
      ].join("\n")
    );
  });

  it("the failure names the anchor and the context, not the symptom", () => {
    // The guard this replaced said "the root default moved", which was not what
    // had happened and sent its reader to the wrong file.
    let thrown: unknown;
    try {
      applyRewrites(SOURCE_MISSING_FIRST, PROVER_REWRITES, CONTEXT);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MissingAnchorError);
    const failure = thrown as MissingAnchorError;
    expect(failure.anchor).toBe(DELETED_IMPORT);
    expect(failure.step).toBe('"the fileURLToPath import"');
    expect(failure.context).toBe("the pre-move prover fixture");
    expect(failure.message).toContain(
      'import { execFileSync } from \\"node:child_process\\";'
    );
  });

  it("returns nothing partially applied when a step does not fire", () => {
    const seen: string[] = [];
    try {
      applyRewrites(SOURCE_MISSING_FIRST, PROVER_REWRITES, CONTEXT);
      seen.push("returned");
    } catch {
      seen.push("threw");
    }
    expect(seen).toEqual(["threw"]);
  });

  it("names an unlabelled step by its 1-based position", () => {
    expect(() =>
      applyRewrites(
        "nothing here",
        [
          { anchor: "absent", replacement: "x" },
          { anchor: "also absent", replacement: "y" },
        ],
        CONTEXT
      )
    ).toThrow(/rewrite "#1" did not apply/);
  });

  it("a declared-optional step may find nothing while required steps stay enforced", () => {
    expect(
      applyRewrites(
        "keep me",
        [
          { anchor: "not there", optional: true, replacement: "x" },
          { anchor: "keep me", replacement: "kept" },
        ],
        CONTEXT
      )
    ).toBe("kept");

    expect(() =>
      applyRewrites(
        "keep me",
        [
          { anchor: "not there", optional: true, replacement: "x" },
          { anchor: "also not there", replacement: "y" },
        ],
        CONTEXT
      )
    ).toThrow(/rewrite "#2" did not apply/);
  });

  it("runs steps in order, so a later step may anchor on earlier output", () => {
    expect(
      applyRewrites(
        "alpha",
        [
          { anchor: "alpha", replacement: "beta" },
          { anchor: "beta", replacement: "gamma" },
        ],
        CONTEXT
      )
    ).toBe("gamma");
  });
});

describe("replaceOrThrow", () => {
  it("replaces the first occurrence of a present anchor", () => {
    expect(replaceOrThrow("a b a", "a", "z", CONTEXT)).toBe("z b a");
  });

  it("throws naming the anchor when it is absent", () => {
    expect(() => replaceOrThrow("a b", "q", "z", CONTEXT, "step q")).toThrow(
      /rewrite "step q" did not apply — the text does not contain "q"/
    );
  });

  it("accepts a regular-expression anchor and throws when it does not match", () => {
    expect(replaceOrThrow("v1.2.3", /1\.2\.3/, "0.0.0", CONTEXT)).toBe(
      "v0.0.0"
    );
    expect(() => replaceOrThrow("no digits", /1\.2\.3/, "0", CONTEXT)).toThrow(
      MissingAnchorError
    );
  });

  it("does not consume a global pattern's lastIndex while testing it", () => {
    // `RegExp.prototype.test` advances `lastIndex` on a `/g` pattern. Testing
    // the caller's own object would leave it mid-string and make the `replace`
    // that follows start from the wrong offset — a defect the presence check
    // would have introduced.
    const pattern = /ab/g;
    expect(replaceOrThrow("ab ab", pattern, "X", CONTEXT)).toBe("X X");
    expect(pattern.lastIndex).toBe(0);
  });

  it("truncates a very long anchor in the failure instead of eliding it", () => {
    const long = "x".repeat(400);
    let message = "";
    try {
      replaceOrThrow("short", long, "y", CONTEXT);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"xxx');
    expect(message).toContain("…");
    expect(message.length).toBeLessThan(400);
  });
});

describe("replaceOptional", () => {
  it("returns the input unchanged when the anchor is absent", () => {
    expect(replaceOptional("keep me", "absent", "x")).toBe("keep me");
  });

  it("replaces when the anchor is present", () => {
    expect(replaceOptional("keep me", "keep", "drop")).toBe("drop me");
  });
});
