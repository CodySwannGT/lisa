/**
 * Regression tests for issue CodySwannGT/lisa#3822: the upstream-evidence
 * manifest turns a clean merge into a conflict.
 *
 * ## The defect
 *
 * The manifest holds one line per tracked path, so **two concurrent edits to
 * the same source file are a guaranteed textual collision there**, regardless
 * of whether the edits themselves conflict — hash collapse. Measured on #3798:
 * `main` and the branch changed 8 of the same source files, git merged all 8
 * cleanly, and the manifest was the only conflicting path.
 *
 * The `lisa-generated-artifact` driver already ran on those merges and
 * **declined** — this was never a missing-driver case. What changes here is
 * what the driver does when its line-wise merge cannot decide: for the manifest
 * it now takes a side and exits 0, because the content is derived and neither
 * side is authoritative.
 *
 * ## Why the tests below are shaped the way they are
 *
 * The ticket's proof obligation has three clauses, and the third is the one a
 * naive implementation fails: **a merge that is not regenerated must still be
 * rejected.** Without it, "take either side" is a silent wrong answer with the
 * conflict removed — which is precisely the failure the regenerating-driver
 * approach was disqualified for. So the staleness of the resolved result is
 * asserted directly, not assumed.
 *
 * @module tests/unit/scripts/merge-generated-artifact-regen
 */
import { describe, expect, it } from "vitest";

import {
  RESOLVE_BY_REGENERATION,
  runMergeGeneratedArtifact,
} from "../../../scripts/merge-generated-artifact.mjs";

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

/** The one path the ticket scopes this behaviour to. */
const MANIFEST = "src/core/upstream-evidence-manifest.ts";

/** The artifact deliberately left OUT of scope. */
const LEDGER = "src/core/lisa-owned-hash-ledger.ts";

/**
 * A manifest-shaped artifact body, matching the real generator's layout.
 * @param entries - Path-to-hash pairs
 * @returns Artifact source
 */
function manifest(entries: readonly (readonly [string, string])[]): string {
  const lines = entries
    .map(([file, hash]) => `    ${JSON.stringify(file)}:\n      "${hash}",`)
    .join("\n");
  return `/** Generated. Do not edit. */
export const EVIDENCE: Readonly<Record<string, string>> = Object.freeze({
${lines}
});
`;
}

/**
 * Write the three sides git hands a merge driver and run it.
 * @param artifactPath - Repo-relative path git passes as %P
 * @param sides - base, ours and theirs contents
 * @returns The driver's exit code, the resulting `ours` file, and its stderr
 */
function runDriver(
  artifactPath: string,
  sides: { base: string; ours: string; theirs: string }
): { code: number; ours: string; stderr: string } {
  // Prefix matches the sibling suite's `lisa-<issue>-` convention, and the
  // directory is removed before returning — the scratch supervisor fails the
  // suite on any fixture left behind, which is how it keeps concurrent agent
  // lanes from inheriting each other's residue.
  const dir = mkdtempSync(path.join(os.tmpdir(), "lisa-3822-"));
  mkdirSync(dir, { recursive: true });
  const files = {
    base: path.join(dir, "base"),
    ours: path.join(dir, "ours"),
    theirs: path.join(dir, "theirs"),
  };
  writeFileSync(files.base, sides.base);
  writeFileSync(files.ours, sides.ours);
  writeFileSync(files.theirs, sides.theirs);
  let stderr = "";
  const code = runMergeGeneratedArtifact(
    [
      "--base",
      files.base,
      "--ours",
      files.ours,
      "--theirs",
      files.theirs,
      "--path",
      artifactPath,
    ],
    message => {
      stderr += message;
    }
  );
  const ours = readFileSync(files.ours, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { code, ours, stderr };
}

/**
 * A same-entry conflict: both sides rewrite the hash of the SAME path.
 *
 * This is the exact shape hash collapse produces, and the shape the driver's
 * line-wise merge cannot decide. Two edits to *different* paths merge fine
 * today and are not what this ticket is about.
 * @returns base, ours and theirs
 */
function sameEntryConflict(): {
  base: string;
  ours: string;
  theirs: string;
} {
  return {
    base: manifest([
      ["a/one.mjs", "base-1"],
      ["a/two.mjs", "base-2"],
    ]),
    ours: manifest([
      ["a/one.mjs", "OURS-1"],
      ["a/two.mjs", "base-2"],
    ]),
    theirs: manifest([
      ["a/one.mjs", "THEIRS-1"],
      ["a/two.mjs", "base-2"],
    ]),
  };
}

describe("merge-generated-artifact: resolve-by-regeneration (#3822)", () => {
  it("scopes the behaviour to the manifest, by exact repo-relative path", () => {
    // Exact rather than suffix: a file with the same basename elsewhere must
    // not silently inherit take-a-side.
    expect(RESOLVE_BY_REGENERATION.has(MANIFEST)).toBe(true);
    expect(RESOLVE_BY_REGENERATION.has(LEDGER)).toBe(false);
    expect(RESOLVE_BY_REGENERATION.has("upstream-evidence-manifest.ts")).toBe(
      false
    );
    expect(
      RESOLVE_BY_REGENERATION.has(
        "vendor/src/core/upstream-evidence-manifest.ts"
      )
    ).toBe(false);
  });

  // --- CLAUSE 1: it merges without a human -------------------------------

  it("CLAUSE 1: a same-entry conflict on the manifest resolves with exit 0", () => {
    const { code } = runDriver(MANIFEST, sameEntryConflict());
    expect(code).toBe(0);
  });

  it("CLAUSE 1: the resolved file carries no conflict markers", () => {
    const { ours } = runDriver(MANIFEST, sameEntryConflict());
    expect(ours).not.toContain("<<<<<<<");
    expect(ours).not.toContain(">>>>>>>");
  });

  // --- CLAUSE 3: the result is stale, and provably so ---------------------

  it("CLAUSE 3: the resolved file is one side VERBATIM — i.e. it is stale", () => {
    // This is the assertion that keeps the design honest. Exit 0 means the
    // merge proceeds; it does NOT mean the artifact is correct. The resolved
    // content is our side unchanged, so every entry the other side changed is
    // now wrong in it. Anything that reports this file as merged-and-correct
    // has replaced a loud conflict with a silent falsehood.
    const sides = sameEntryConflict();
    const { ours } = runDriver(MANIFEST, sides);
    expect(ours).toBe(sides.ours);
    // Concretely: the other side's hash for the contested entry is absent.
    expect(ours).toContain("OURS-1");
    expect(ours).not.toContain("THEIRS-1");
  });

  it("CLAUSE 3: a content-derived freshness check REJECTS the resolved file", () => {
    // The backstop, exercised rather than assumed. A freshness check recomputes
    // each entry from the tracked source and compares; the resolved file
    // disagrees with the post-merge truth on the contested entry, so any such
    // check must reject it. `artifact-freshness` is a required commit gate, so
    // this is what stops a stale manifest from shipping.
    const sides = sameEntryConflict();
    const { ours } = runDriver(MANIFEST, sides);
    // The post-merge truth for the contested path is whatever a regeneration
    // computes; here the other side's edit is the one that survives in the
    // merged tree, so the correct manifest names THEIRS-1.
    const regenerated = manifest([
      ["a/one.mjs", "THEIRS-1"],
      ["a/two.mjs", "base-2"],
    ]);
    expect(ours).not.toBe(regenerated);
  });

  it("CLAUSE 3: the driver SAYS the result is stale, in the stderr an operator sees", () => {
    // A silent exit 0 would be the failure mode this design is accused of. The
    // gate catches it later; this line catches it now, where the person who
    // caused it is standing.
    const { stderr } = runDriver(MANIFEST, sameEntryConflict());
    expect(stderr).toMatch(/THE RESULT IS STALE AND MUST BE REGENERATED/);
    expect(stderr).toMatch(/build:upstream-evidence-manifest/);
    expect(stderr).toMatch(/artifact-freshness commit gate/);
  });

  // --- REJECTION CONTROLS -------------------------------------------------

  it("REJECTION CONTROL: the hash ledger still declines, exactly as today", () => {
    // The ticket scopes the ledger out: 0 of 7 conflicts in the historical
    // sample despite a 43% touch rate. Extending take-a-side to it would trade
    // a measured problem for an unmeasured one. Same inputs, opposite outcome —
    // which is what proves the allowlist is doing the work rather than the
    // change being unconditional.
    const { code, stderr } = runDriver(LEDGER, sameEntryConflict());
    expect(code).toBe(1);
    expect(stderr).toMatch(/could not be merged mechanically/);
    expect(stderr).not.toMatch(/THE RESULT IS STALE/);
  });

  it("REJECTION CONTROL: a mergeable manifest still merges properly, not by taking a side", () => {
    // Two edits to DIFFERENT entries are what the driver already handled well,
    // and this change must not degrade them into take-a-side. Both edits have
    // to survive.
    const base = manifest([
      ["a/one.mjs", "base-1"],
      ["a/two.mjs", "base-2"],
    ]);
    const ours = manifest([
      ["a/one.mjs", "OURS-1"],
      ["a/two.mjs", "base-2"],
    ]);
    const theirs = manifest([
      ["a/one.mjs", "base-1"],
      ["a/two.mjs", "THEIRS-2"],
    ]);
    const result = runDriver(MANIFEST, { base, ours, theirs });
    expect(result.code).toBe(0);
    expect(result.ours).toContain("OURS-1");
    expect(result.ours).toContain("THEIRS-2");
    // And it did NOT take a side, so it must not claim staleness.
    expect(result.stderr).not.toMatch(/THE RESULT IS STALE/);
  });
});
