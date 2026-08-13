/**
 * Source-shape regressions for the analyser classes reported against the
 * vendored v2 BDD gate (CodySwannGT/lisa#2468, section B).
 *
 * These cases assert on the SOURCE because the finding IS the shape of the
 * source. All seventeen bare `.sort()` calls behaved correctly — every one of
 * them sorted a string array, where the default order is exactly right — so no
 * behavioural test can distinguish before from after. What the class costs is
 * the next array: the first numeric one sorts `[2, 10]` to `[10, 2]` and
 * nothing notices. Pinning the shape is the only thing that stops that.
 *
 * @module tests/unit/scripts/bdd-gate-defects
 */
import { GATE_DIR, sourceCode } from "./bdd/sources";
import { read } from "./bdd/support";

/** Every vendored gate source the SonarCloud findings were raised against. */
const GATE_SOURCES = [
  `${GATE_DIR}/check-bdd-coverage.mjs`,
  `${GATE_DIR}/bdd-matrix.mjs`,
  `${GATE_DIR}/bdd/baseline.mjs`,
  `${GATE_DIR}/bdd/contract.mjs`,
  `${GATE_DIR}/bdd/discover.mjs`,
  `${GATE_DIR}/bdd/envelope.mjs`,
  `${GATE_DIR}/bdd/parse.mjs`,
  `${GATE_DIR}/bdd/render.mjs`,
  `${GATE_DIR}/bdd/report.mjs`,
  `${GATE_DIR}/bdd/validate.mjs`,
  `${GATE_DIR}/bdd/waivers.mjs`,
];

describe("bdd gate: analyser classes (lisa#2468 section B)", () => {
  describe("S2871 — every sort declares its comparator", () => {
    it.each(GATE_SOURCES)("%s has no bare .sort()", source => {
      expect(sourceCode(source)).not.toContain(".sort()");
    });

    it("names one shared comparator rather than a per-file copy", () => {
      expect(sourceCode(`${GATE_DIR}/bdd/contract.mjs`)).toContain(
        "export const byCodeUnit"
      );
    });
  });

  describe("S4036 — git is never resolved off a bare PATH lookup", () => {
    it("does not spawn the literal command name", () => {
      expect(read(`${GATE_DIR}/bdd/baseline.mjs`)).not.toMatch(
        /spawnSync\(\s*"git"/u
      );
    });

    it("resolves an absolute path and verifies it is a real file", () => {
      const source = sourceCode(`${GATE_DIR}/bdd/baseline.mjs`);
      expect(source).toContain("path.isAbsolute(candidate)");
      expect(source).toContain("fs.statSync(candidate).isFile()");
    });
  });

  describe("S3403 — no comparison that can only ever have one answer", () => {
    it("discover.mjs tests the regex groups by type, not against undefined", () => {
      const source = sourceCode(`${GATE_DIR}/bdd/discover.mjs`);
      expect(source).not.toContain("evidence === undefined");
      expect(source).not.toContain("template !== undefined");
      expect(source).toContain('typeof evidence !== "string"');
      expect(source).toContain('typeof template === "string"');
    });
  });

  describe("S3735 — the unused-parameter `void` is gone", () => {
    it("enforcedDefects no longer takes a platforms parameter", () => {
      expect(read(`${GATE_DIR}/check-bdd-coverage.mjs`)).not.toMatch(
        /\bvoid\s+platforms\b/u
      );
    });
  });
});
