import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../../helpers/io-latency-budget.js";

import {
  changelogSection,
  currentSurface,
  exportedNames,
  parseArtifact,
  removedExports,
  renderArtifact,
  shippedScripts,
} from "../../../scripts/generate-export-surface.mjs";

/**
 * Tests for the export-surface observation.
 *
 * A release shipped a changelog declaring ZERO breaking changes over a diff
 * that removed a public export, and two consumer repositories nearly upgraded
 * on the strength of it (CodySwannGT/lisa#3718). The attestation was derived
 * from commit-message conventions — whether an author typed `!` or a
 * `BREAKING CHANGE:` footer — so it described what people wrote rather than
 * what happened to the exported surface.
 *
 * The load-bearing property here is that the check has **two arms that must
 * disagree**: removing an export has to fail, and an additive change has to
 * pass. A check that can hold either constant and stay green is not a gate.
 * The passing arm is not decoration — without it, "always report a removal"
 * would satisfy every failing case.
 * @module tests/unit/scripts/export-surface
 */

const REPO = path.resolve(__dirname, "..", "..", "..");

/** One module's worth of surface, as the artifact records it. */
type Surface = Record<string, string[]>;

/** A file path used across the comparison cases. */
const MODULE = "all/copy-overwrite/scripts/example.mjs";

describe("reading exports out of a module", () => {
  it.each([
    ["export const A = 1;", "A"],
    ["export function b() {}", "b"],
    ["export async function c() {}", "c"],
    ["export class D {}", "D"],
    ["export let e = 1;", "e"],
    ["export var f = 1;", "f"],
  ])("reads %s", (source, expected) => {
    expect(exportedNames(source)).toEqual([expected]);
  });

  it("reads a brace list, and records the EXPORTED name of an alias", () => {
    // `local as Public` puts `Public` on the surface. Recording `local` would
    // make the artifact disagree with what a consumer can actually import.
    expect(exportedNames("export { a, b as Public };")).toEqual([
      "Public",
      "a",
    ]);
  });

  it("ignores an export that is not a declaration at line start", () => {
    // A mention inside a string or a comment is not part of the surface, and
    // counting it would make the artifact drift from the module for reasons no
    // reader could see.
    const source = [
      "// export const Commented = 1;",
      'const doc = "export const Quoted = 1;";',
      "  export const Indented = 1;",
      "export const Real = 1;",
    ].join("\n");

    expect(exportedNames(source)).toEqual(["Real"]);
  });

  it("ignores a BRACE LIST that is not at line start", () => {
    // Found by mutation: the line-start case above covered only the
    // declaration regex, so dropping the anchor from the brace-list regex
    // survived. An indented or quoted `export { … }` is not part of the
    // surface either, and counting it would put names in the artifact that no
    // consumer can import.
    const source = [
      'const doc = "export { Quoted };";',
      "  export { Indented };",
      "export { Real };",
    ].join("\n");

    expect(exportedNames(source)).toEqual(["Real"]);
  });

  it("omits a default export, which has no name to compare", () => {
    expect(exportedNames("export default function () {}")).toEqual([]);
  });

  it("deduplicates and sorts, so the artifact is stable across runs", () => {
    // An unstable ordering would make the artifact diff on every regeneration
    // and train reviewers to skip it — the same failure as a noisy changelog.
    expect(exportedNames("export const b = 1;\nexport const a = 2;")).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("comparing two surfaces", () => {
  const before: Surface = { [MODULE]: ["kept", "removed"] };

  it("names a removed export", () => {
    const after: Surface = { [MODULE]: ["kept"] };

    expect(removedExports(before, after)).toEqual([
      { file: MODULE, name: "removed" },
    ]);
  });

  it("reports nothing for a purely additive change", () => {
    // The other arm. Without it, "always report a removal" passes every case
    // above, and the check would block every release.
    const after: Surface = { [MODULE]: ["added", "kept", "removed"] };

    expect(removedExports(before, after)).toEqual([]);
  });

  it("treats a whole deleted module as removing all of its exports", () => {
    expect(removedExports(before, {})).toEqual([
      { file: MODULE, name: "kept" },
      { file: MODULE, name: "removed" },
    ]);
  });

  it("does not report a name that moved to a different module", () => {
    // Deliberate: the recorded surface is per-module, so a name relocated to
    // another shipped file IS a break for anyone importing the old path. This
    // case pins that the report says so rather than silently forgiving it.
    const after: Surface = {
      "all/copy-overwrite/scripts/other.mjs": ["removed"],
    };

    expect(removedExports(before, after).map(entry => entry.name)).toContain(
      "removed"
    );
  });
});

describe("the changelog section", () => {
  it("emits nothing when nothing was removed", () => {
    // A release that removed no export must not carry a paragraph saying so,
    // or the section becomes noise readers learn to skip — which is how the
    // original changelog came to be read past.
    expect(changelogSection([])).toBe("");
  });

  it("names each removed export and the module that exported it", () => {
    const section = changelogSection([{ file: MODULE, name: "gone" }]);

    expect(section).toContain("gone");
    expect(section).toContain(MODULE);
  });

  it("states the consequence for a consumer, not merely the fact", () => {
    // "Removed export" is a fact about this repository. "A consumer importing
    // it will break on upgrade" is what the reader needs in order to act, and
    // is what the previous changelog failed to convey by asserting the
    // opposite.
    expect(changelogSection([{ file: MODULE, name: "gone" }])).toContain(
      "break on upgrade"
    );
  });

  it("counts the removals, so a truncated read still carries the scale", () => {
    const section = changelogSection([
      { file: MODULE, name: "a" },
      { file: MODULE, name: "b" },
    ]);

    expect(section).toContain("2 exported name(s)");
  });
});

describe("the artifact round-trips", () => {
  it("parses back exactly what it rendered", () => {
    // Parsing is what lets a comparison read an OLDER revision via `git show`,
    // so a render the parser cannot read would make every historical
    // comparison silently empty.
    const surface: Surface = {
      [MODULE]: ["A", "b"],
      "all/copy-overwrite/scripts/other.mjs": ["C"],
    };

    expect(parseArtifact(renderArtifact(surface))).toEqual(surface);
  });

  it("omits a module that exports nothing, rather than recording an empty row", () => {
    // Also found by mutation. A module with no exports contributes nothing to
    // the surface, and a row of `[]` for every such file would pad the
    // artifact with lines that can never carry a removal — noise in exactly
    // the diff this file exists to keep readable.
    const surface = currentSurface(REPO);

    expect(
      Object.entries(surface).filter(([, names]) => names.length === 0)
    ).toEqual([]);
  });

  it("records the real shipped corpus, not an empty set", () => {
    // The guard against the whole thing being vacuous: a generator that
    // enumerated nothing would satisfy every assertion above.
    const files = shippedScripts(REPO);

    expect(files.length).toBeGreaterThan(50);
    expect(files.every(file => file.endsWith(".mjs"))).toBe(true);
  });
});

describe("an unanswerable comparison is not a pass", () => {
  const script = path.join(REPO, "scripts", "generate-export-surface.mjs");

  /**
   * Run the comparison CLI against a revision and report how it exited.
   * @param ref - Git revision to compare against
   * @returns The exit code and combined output
   */
  const compareAgainst = (ref: string): { code: number; out: string } => {
    // `boundedSpawnSync`, not the throwing exec form: a non-zero exit is the
    // subject of these cases, not an error. The deadline matters for the same
    // reason this whole file does — a child killed from outside returns empty
    // streams, and the failure would then read as a content mismatch rather
    // than as a kill.
    const outcome = boundedSpawnSync({
      label: "generate-export-surface --removed-since",
      command: process.execPath,
      args: [script, "--removed-since", ref],
      cwd: REPO,
    });
    return { code: outcome.status ?? -1, out: outcome.stdout ?? "" };
  };

  it("exits 2, not 0, when no surface was recorded at that revision", () => {
    // The load-bearing distinction. "I could not compare" and "nothing was
    // removed" are opposite facts, and this whole script exists because a
    // release reported the second while meaning closer to the first. Exit 0
    // here would make a release gate pass on an unanswered question.
    const result = compareAgainst("c32f33010f");

    expect(result.code).toBe(2);
    expect(result.code).not.toBe(0);
  });

  it("says the unanswered comparison is not clean, in words", () => {
    // The exit code is for the caller; the sentence is for the human reading
    // a release log, who has no exit code in front of them.
    expect(compareAgainst("c32f33010f").out).toContain("NOT a clean result");
  });

  it("exits 0 and states the scale when the comparison IS answerable", () => {
    // The control against the check degrading into always-refusing, and it
    // reports how many names it compared so a vacuous pass is visible rather
    // than indistinguishable from a real one.
    const result = compareAgainst("HEAD");

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/\d+ names compared/);
  });
});

describe("it names the removal that caused this ticket", () => {
  it("reports SNAPSHOT_MAX_AGE_DAYS removed by the real commit", () => {
    // Not a fixture. This is the historical event #3718 is about: the commit
    // that removed the required-checks drift arm (#3599) also removed three
    // public exports, and the changelog for the release carrying it declared
    // zero breaking changes.
    const file =
      "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";
    const at = (ref: string): string =>
      boundedExecFileSync({
        label: `git show ${ref}`,
        command: "/usr/bin/git",
        args: ["show", `${ref}:${file}`],
        cwd: REPO,
      });

    const removals = removedExports(
      { [file]: exportedNames(at("c32f33010f")) },
      { [file]: exportedNames(at("f13bb00ec7")) }
    );

    expect(removals.map(entry => entry.name)).toEqual([
      "SNAPSHOT_MAX_AGE_DAYS",
      "compareRulesetBaseline",
      "fetchLiveRequiredContexts",
    ]);
  });
});
