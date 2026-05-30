/**
 * Unit tests for scripts/plugin-parity-drift.mjs (issue #1059).
 *
 * The empirical core of the parity subsystem: proves Scenario 3 (version-pinned
 * reimplementations + drift detection) against the committed fixture under
 * `parity/fixtures/drift/`, the exit-code contract, the drift-status coverage
 * (unresolved/unparseable), the zero-synced-skills CI footgun, and the pure
 * helpers.
 *
 * Two test surfaces:
 *   1. End-to-end: spawn the real script with fixture roots and assert stdout
 *      JSON + exit code + that it never edits the fixture (3c).
 *   2. Pure functions imported directly, asserted against HARDCODED expected
 *      values per the Test Isolation house rule (never compute an expectation
 *      by calling the function under test).
 *
 * Shared fixtures/constants/helpers live in ./plugin-parity-drift-helpers.
 *
 * @module tests/unit/scripts/plugin-parity-drift
 */
import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  classify,
  compareSemver,
  isValidSemver,
  parseFrontmatter,
  parseSyncedFrom,
  resolveCurrentVersion,
} from "../../../scripts/plugin-parity-drift.mjs";
import {
  ABSENT_CACHE,
  CACHE_FLAG,
  CACHE_ROOT,
  CODERABBIT_ID,
  MARKETPLACE,
  makeTempSkill,
  NOT_INSTALLED,
  RC_VERSION,
  SIMPLIFIER,
  SIMPLIFIER_ID,
  SKILLS_FLAG,
  SKILLS_ROOT,
  STALE_SKILL,
  UNRESOLVED,
  UNRESOLVED_PLUGIN,
  findResult,
  runDrift,
} from "./plugin-parity-drift-helpers";

describe("plugin-parity-drift end-to-end (Scenario 3)", () => {
  it("exits 1 and reports code-simplifier stale 1.0.0 -> 2.0.0 (max-semver resolution)", () => {
    const { code, report } = runDrift([
      CACHE_FLAG,
      CACHE_ROOT,
      SKILLS_FLAG,
      SKILLS_ROOT,
      "--json",
    ]);

    expect(code).toBe(1);
    expect(report.summary).toEqual({ scanned: 2, ok: 1, drift: 1 });

    const simplifier = findResult(report, SIMPLIFIER_ID);
    expect(simplifier).toBeDefined();
    expect(simplifier?.pinnedVersion).toBe("1.0.0");
    expect(simplifier?.currentVersion).toBe("2.0.0");
    expect(simplifier?.status).toBe("stale");

    const coderabbit = findResult(report, CODERABBIT_ID);
    expect(coderabbit?.status).toBe("ok");

    // The `plain` skill (no synced-from) is ignored, not counted.
    expect(report.results).toHaveLength(2);
  });

  it("does not modify the fixture skill file (never auto-bumps, 3c)", () => {
    const before = fs.readFileSync(STALE_SKILL);
    runDrift([CACHE_FLAG, CACHE_ROOT, SKILLS_FLAG, SKILLS_ROOT, "--json"]);
    const after = fs.readFileSync(STALE_SKILL);
    expect(after.equals(before)).toBe(true);
  });
});

describe("plugin-parity-drift temp-fixture scenarios", () => {
  const tempRoots: string[] = [];

  const addSkill = (lines: readonly string[]): string => {
    const root = makeTempSkill(lines);
    tempRoots.push(root);
    return root;
  };

  afterEach(() => {
    while (tempRoots.length > 0) {
      fs.rmSync(tempRoots.pop() as string, { force: true, recursive: true });
    }
  });

  it("exits 0 with zero drift when the pin equals the current version (3b)", () => {
    const root = addSkill([`synced-from: ${SIMPLIFIER_ID}@2.0.0`]);
    const { code, report } = runDrift([
      CACHE_FLAG,
      CACHE_ROOT,
      SKILLS_FLAG,
      root,
      "--json",
    ]);

    expect(code).toBe(0);
    expect(report.summary).toEqual({ scanned: 1, ok: 1, drift: 0 });
    expect(report.results[0]?.status).toBe("ok");
  });

  it("reports `unresolved` (exit 1) when the only cache version dir has a non-semver manifest (W1)", () => {
    const root = addSkill([
      `synced-from: ${UNRESOLVED_PLUGIN}@${MARKETPLACE}@1.0.0`,
    ]);
    const { code, report } = runDrift([
      CACHE_FLAG,
      CACHE_ROOT,
      SKILLS_FLAG,
      root,
      "--json",
    ]);

    expect(code).toBe(1);
    expect(report.summary).toEqual({ scanned: 1, ok: 0, drift: 1 });
    expect(report.results[0]?.status).toBe(UNRESOLVED);
    expect(report.results[0]?.currentVersion).toBeNull();
  });

  it("reports `unparseable` (exit 1) for a malformed synced-from value (W1)", () => {
    const root = addSkill(["synced-from: not-a-valid-pin"]);
    const { code, report } = runDrift([
      CACHE_FLAG,
      CACHE_ROOT,
      SKILLS_FLAG,
      root,
      "--json",
    ]);

    expect(code).toBe(1);
    expect(report.summary).toEqual({ scanned: 1, ok: 0, drift: 1 });
    expect(report.results[0]?.status).toBe("unparseable");
  });

  it("exits 0 when there are no synced skills, even if the cache root is absent (W2)", () => {
    const root = addSkill(["name: plain-skill"]);
    const { code, report } = runDrift([
      CACHE_FLAG,
      ABSENT_CACHE,
      SKILLS_FLAG,
      root,
      "--json",
    ]);

    expect(code).toBe(0);
    expect(report.summary).toEqual({ scanned: 0, ok: 0, drift: 0 });
  });
});

describe("plugin-parity-drift exit-code contract", () => {
  it("exits 2 on an unknown flag (usage error, distinct from drift)", () => {
    expect(runDrift(["--bogus"]).code).toBe(2);
  });

  it("exits 2 when the cache root is absent but synced skills exist", () => {
    expect(
      runDrift([CACHE_FLAG, ABSENT_CACHE, SKILLS_FLAG, SKILLS_ROOT]).code
    ).toBe(2);
  });

  it("exits 2 when a flag is given without a value", () => {
    expect(runDrift([CACHE_FLAG, SKILLS_FLAG, SKILLS_ROOT]).code).toBe(2);
  });
});

describe("isValidSemver", () => {
  it("accepts canonical semver strings", () => {
    expect(isValidSemver("1.0.0")).toBe(true);
    expect(isValidSemver("2.0.0")).toBe(true);
    expect(isValidSemver("1.1.1")).toBe(true);
    expect(isValidSemver("10.20.30")).toBe(true);
    expect(isValidSemver(RC_VERSION)).toBe(true);
    expect(isValidSemver("1.0.0+build.5")).toBe(true);
  });

  it("rejects non-semver values", () => {
    expect(isValidSemver("unknown")).toBe(false);
    expect(isValidSemver("a81eb76a1539")).toBe(false);
    expect(isValidSemver("1.0")).toBe(false);
    expect(isValidSemver("1")).toBe(false);
    expect(isValidSemver("v1.0.0")).toBe(false);
    expect(isValidSemver("")).toBe(false);
    expect(isValidSemver(undefined)).toBe(false);
  });
});

describe("compareSemver", () => {
  it("orders by major, minor, patch", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("2.0.0", "1.0.0")).toBe(1);
    expect(compareSemver("1.1.1", "1.1.1")).toBe(0);
    expect(compareSemver("1.2.0", "1.10.0")).toBe(-1);
    expect(compareSemver("1.0.10", "1.0.2")).toBe(1);
  });

  it("sorts a prerelease below its release and ignores build metadata", () => {
    expect(compareSemver(RC_VERSION, "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", RC_VERSION)).toBe(1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareSemver("1.0.0+build.9", "1.0.0+build.1")).toBe(0);
  });
});

describe("parseSyncedFrom", () => {
  it("splits name@marketplace@version on the LAST @", () => {
    expect(parseSyncedFrom(`${SIMPLIFIER_ID}@1.0.0`)).toEqual({
      name: SIMPLIFIER,
      marketplace: MARKETPLACE,
      version: "1.0.0",
      plugin: SIMPLIFIER_ID,
    });
  });

  it("accepts a prerelease version", () => {
    expect(parseSyncedFrom(`${CODERABBIT_ID}@1.1.1-rc.2`)).toEqual({
      name: "coderabbit",
      marketplace: MARKETPLACE,
      version: "1.1.1-rc.2",
      plugin: CODERABBIT_ID,
    });
  });

  it("rejects malformed values", () => {
    expect(parseSyncedFrom(`${SIMPLIFIER}@1.0.0`)).toBeNull();
    expect(parseSyncedFrom(`${SIMPLIFIER_ID}@notsemver`)).toBeNull();
    expect(parseSyncedFrom(`${SIMPLIFIER_ID}@`)).toBeNull();
    expect(parseSyncedFrom(`@${MARKETPLACE}@1.0.0`)).toBeNull();
    expect(parseSyncedFrom("noatsign")).toBeNull();
    expect(parseSyncedFrom("")).toBeNull();
    expect(parseSyncedFrom(undefined)).toBeNull();
  });
});

describe("parseFrontmatter", () => {
  it("extracts a synced-from scalar from a frontmatter block", () => {
    const content = [
      "---",
      `name: ${SIMPLIFIER}`,
      `synced-from: ${SIMPLIFIER_ID}@1.0.0`,
      "---",
      "# body",
      "",
    ].join("\n");
    expect(parseFrontmatter(content)["synced-from"]).toBe(
      `${SIMPLIFIER_ID}@1.0.0`
    );
  });

  it("strips surrounding quotes", () => {
    const content = ["---", 'synced-from: "x@y@1.0.0"', "---", ""].join("\n");
    expect(parseFrontmatter(content)["synced-from"]).toBe("x@y@1.0.0");
  });

  it("returns an empty object when there is no frontmatter", () => {
    expect(parseFrontmatter("# just a heading\n")).toEqual({});
  });
});

describe("classify", () => {
  it("maps the resolver outcome + version comparison to a status", () => {
    expect(classify("1.0.0", { status: "ok", version: "2.0.0" })).toBe("stale");
    expect(classify("2.0.0", { status: "ok", version: "1.0.0" })).toBe("ahead");
    expect(classify("1.1.1", { status: "ok", version: "1.1.1" })).toBe("ok");
    expect(classify("1.0.0", { status: NOT_INSTALLED, version: null })).toBe(
      NOT_INSTALLED
    );
    expect(classify("1.0.0", { status: UNRESOLVED, version: null })).toBe(
      UNRESOLVED
    );
  });

  it("defensively treats `ok` without a version as unresolved (no null compare)", () => {
    expect(classify("1.0.0", { status: "ok", version: null })).toBe(UNRESOLVED);
  });
});

describe("resolveCurrentVersion", () => {
  it("picks the max valid semver across the fixture cache version subdirs", () => {
    expect(resolveCurrentVersion(CACHE_ROOT, SIMPLIFIER, MARKETPLACE)).toEqual({
      status: "ok",
      version: "2.0.0",
    });
  });

  it("reports unresolved when the only version dir has a non-semver manifest", () => {
    expect(
      resolveCurrentVersion(CACHE_ROOT, UNRESOLVED_PLUGIN, MARKETPLACE)
    ).toEqual({ status: UNRESOLVED, version: null });
  });

  it("reports not-installed for an unknown plugin", () => {
    expect(resolveCurrentVersion(CACHE_ROOT, "nope", MARKETPLACE)).toEqual({
      status: NOT_INSTALLED,
      version: null,
    });
  });

  it("reports not-installed for a path-traversal name (defense-in-depth)", () => {
    expect(resolveCurrentVersion(CACHE_ROOT, "..", MARKETPLACE)).toEqual({
      status: NOT_INSTALLED,
      version: null,
    });
  });
});
