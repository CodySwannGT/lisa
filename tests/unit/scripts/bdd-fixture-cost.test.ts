/**
 * What the BDD gate's own fixtures are allowed to cost (lisa#2887).
 *
 * Measured before this file existed: every case in the family that did NOT
 * create a git repository ran in 60-113 ms, and every case that DID ran in
 * 2,559-45,087 ms. Inside that, `git init` took 1,013-33,916 ms while every
 * other git call took 19-49 ms — and `GIT_TRACE_PERFORMANCE` reported git's
 * own work for the same `init` as 12-206 ms, so the time was not spent in git.
 * It was spent in `/usr/bin/git`, which on macOS is Apple's `xcrun` shim.
 *
 * None of the cases here assert a duration. A wall-clock assertion on a shared
 * machine measures the machine, and this family has already lost a day to
 * exactly that confusion. Each case pins the *structural* fact that made the
 * duration what it was: which binary is chosen, how many processes a fixture
 * spawns, how many times identical content is committed, and where fixtures
 * are put.
 *
 * @module tests/unit/scripts/bdd-fixture-cost
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ENFORCED,
  GIT_BIN,
  GIT_CANDIDATES,
  HEALTHY_MAP,
  WEB,
  XCRUN_SHIM,
  codes,
  committedFixture,
  fixtureBaseDir,
  gitSpawnCount,
  healthyProject,
  makeProject,
  read,
  readMap,
  runGate,
  writeMap,
} from "./bdd/support";

/**
 * The developer-directory gits the shim dispatches to. Both are `root:wheel`
 * files in system locations, so preferring them is the same trust class as
 * `/usr/bin/git` rather than a relaxation of it.
 */
const SYSTEM_GIT = [
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
];

/** Locations a non-root user can write to, which must stay last. */
const USER_WRITABLE_GIT = ["/opt/homebrew/bin/git", "/usr/local/bin/git"];

/** This file, excluded from the source scan it performs. */
const OWN_SPEC = "bdd-fixture-cost.test.ts";

/** Where the family's specs live, read rather than listed. */
const SPEC_DIR = __dirname;

/** The shipped gate module that resolves git for the gate itself. */
const BASELINE_SOURCE = "expo/copy-overwrite/scripts/bdd/baseline.mjs";

/**
 * The quoted paths of a module's `GIT_CANDIDATES` array, in source order.
 * @param source - Module source text.
 * @returns The candidate paths.
 */
function candidateOrder(source: string): string[] {
  const literal =
    /const GIT_CANDIDATES = Object\.freeze\(\[(?<body>[^\]]*)\]/u.exec(source)
      ?.groups?.body;
  return [...(literal ?? "").matchAll(/"(?<value>[^"]+)"/gu)].map(
    match => match.groups?.value ?? ""
  );
}

describe("what a BDD gate fixture is allowed to cost", () => {
  describe("git is resolved to a binary, not to a dispatcher", () => {
    it("prefers every root-owned system git over the xcrun shim", () => {
      const shim = GIT_CANDIDATES.indexOf(XCRUN_SHIM);
      expect(shim).toBeGreaterThan(-1);
      for (const candidate of SYSTEM_GIT) {
        const at = GIT_CANDIDATES.indexOf(candidate);
        expect(at, candidate).toBeGreaterThan(-1);
        expect(at, candidate).toBeLessThan(shim);
      }
    });

    it("still keeps every user-writable location behind the system ones", () => {
      // The reason the list is fixed paths rather than a PATH lookup is that a
      // writable directory must not get to decide which binary runs. Speed is
      // not allowed to buy its way past that, so the ordering is pinned in
      // both directions and not only in the direction #2887 cared about.
      const shim = GIT_CANDIDATES.indexOf(XCRUN_SHIM);
      for (const candidate of USER_WRITABLE_GIT) {
        expect(GIT_CANDIDATES.indexOf(candidate), candidate).toBeGreaterThan(
          shim
        );
      }
    });

    it("orders the shipped gate's own candidates by the same rule", () => {
      // The fixtures and the gate they run resolve git independently, so a fix
      // applied to one of them leaves the other paying the shim on every call.
      // One rule, asserted against both lists, is what stops them drifting.
      const shipped = candidateOrder(read(BASELINE_SOURCE));
      expect(shipped).toContain(XCRUN_SHIM);
      const shim = shipped.indexOf(XCRUN_SHIM);
      for (const candidate of SYSTEM_GIT) {
        expect(shipped.indexOf(candidate), candidate).toBeGreaterThan(-1);
        expect(shipped.indexOf(candidate), candidate).toBeLessThan(shim);
      }
      for (const candidate of USER_WRITABLE_GIT) {
        expect(shipped.indexOf(candidate), candidate).toBeGreaterThan(shim);
      }
    });

    it("resolves to the first candidate that is actually installed", () => {
      const expected = GIT_CANDIDATES.find(candidate =>
        fs.existsSync(candidate)
      );
      expect(GIT_BIN).toBe(expected ?? XCRUN_SHIM);
      expect(path.isAbsolute(GIT_BIN)).toBe(true);
    });
  });

  describe("identical base revisions are committed once", () => {
    it("spawns four git processes for the first fixture and none for a copy", () => {
      const key = "cost-once";
      const before = gitSpawnCount();
      const first = committedFixture(key, () =>
        makeProject({ map: HEALTHY_MAP })
      );
      const built = gitSpawnCount();
      const second = committedFixture(key, () => {
        throw new Error("the prototype was rebuilt instead of copied");
      });
      expect(built - before).toBe(4);
      expect(gitSpawnCount() - built).toBe(0);
      expect(second.base).toBe(first.base);
      expect(second.root).not.toBe(first.root);
    });

    it("hands out copies no other case can reach into", () => {
      const key = "cost-isolation";
      const one = committedFixture(key, () => healthyProject());
      const other = committedFixture(key, () => healthyProject());
      writeMap(one.root, {
        ...readMap(one.root),
        coverageFloor: { [WEB]: 42 },
      });
      const floors = readMap(other.root).coverageFloor as Record<
        string,
        number
      >;
      expect(floors[WEB]).toBe(100);
    });

    it("copies a working repository, not just the files in it", () => {
      // A copied fixture whose `.git` did not survive would make the baseline
      // unreadable, and an unreadable baseline is reported as a `baseline`
      // defect rather than as a missing repository — so without this case the
      // memoization could break the gate's comparison silently.
      const fixture = committedFixture("cost-readable", () => healthyProject());
      expect(fixture.base).toMatch(/^[0-9a-f]{40}$/u);
      const run = runGate(fixture.root, {
        BDD_MODE: ENFORCED,
        BDD_BASE_SHA: fixture.base,
      });
      expect(codes(run)).not.toContain("baseline");
    });
  });

  describe("fixtures stay inside a directory this process owns", () => {
    it("puts a project under the process fixture base, not the system temp dir", () => {
      const root = makeProject({});
      const base = fixtureBaseDir();
      expect(base).not.toBeNull();
      expect(path.dirname(root)).toBe(base);
      expect(path.dirname(root)).not.toBe(path.resolve(os.tmpdir()));
    });

    it("no spec reaches for the ambient temp directory on its own", () => {
      // Derived from the directory rather than a hardcoded roster, so a spec
      // added tomorrow is covered without anyone remembering to list it.
      const offenders = fs
        .readdirSync(SPEC_DIR)
        .filter(entry => entry.startsWith("bdd-") && entry.endsWith(".test.ts"))
        .filter(entry => entry !== OWN_SPEC)
        .filter(entry =>
          fs
            .readFileSync(path.join(SPEC_DIR, entry), "utf-8")
            .includes("mkdtempSync")
        );
      expect(offenders).toEqual([]);
    });
  });
});
