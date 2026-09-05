/**
 * Tests for the probe-absence-direction sweep (CodySwannGT/lisa#3848).
 *
 * The load-bearing cases point the real `sweep()` at REAL directory trees. One
 * holds the exact shape the ticket was filed for — a lookup that shells out and
 * reads a non-zero exit as a legitimate negative answer — and asserts the
 * report names it. Its negative control is the same tree with a direction
 * marker at the line, which must come back clean, because a sweep that reported
 * everything would satisfy the first assertion and be useless. A third points
 * it at an empty tree and asserts zero inspected, because an empty inspection
 * and a clean tree otherwise print the same tick.
 *
 * The last case is the enforcement itself: the sweep run over THIS repository
 * must find nothing while having inspected something. That pairing is the whole
 * control — either half alone is satisfiable by a sweep that stopped looking.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/check-probe-absence-direction
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  absenceBranches,
  BLIND_SPOTS,
  formatReport,
  nextCodeLine,
  PERMITTED_DIRECTIONS,
  readDirection,
  refusalFor,
  sweep,
} from "../../../scripts/check-probe-absence-direction.mjs";

/** Repository root, four levels up from this file. */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/** Where the fixture is written inside a throwaway tree. */
const FIXTURE_PATH = "scripts/probe-fixture.mjs";

/** Temp trees created by a test, removed afterwards. */
const created: string[] = [];

/**
 * Create a throwaway directory tree for the sweep to walk.
 * @returns Absolute path of the new tree.
 */
function makeTree(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-test-probe-dir-"));
  created.push(root);
  return root;
}

/**
 * Write a file into a tree, creating parent directories.
 * @param root - Tree root.
 * @param relative - Path within the tree.
 * @param contents - File contents.
 */
function write(root: string, relative: string, contents: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

/** The failure branch every fixture below is built around. */
const GUARD_LINE = "  if (result.status !== 0) return undefined;";

/** A `return null` inside a catch, written once so the fixtures can share it. */
const RETURN_NULL = "    return null;";

/**
 * The shape #3848 was filed for: a lookup that shells out and spends a
 * non-zero exit as "there is no pull request".
 */
const UNMARKED_LOOKUP = [
  'import { spawnSync } from "node:child_process";',
  "",
  "export function currentPullRequest(repository) {",
  '  const result = spawnSync("gh", ["pr", "view", "--repo", repository], {',
  '    encoding: "utf8",',
  "  });",
  GUARD_LINE,
  "  return JSON.parse(result.stdout);",
  "}",
  "",
].join("\n");

/** The same lookup with the direction recorded at the line. */
const MARKED_LOOKUP = UNMARKED_LOOKUP.replace(
  GUARD_LINE,
  [
    "  // probe-direction: fail-closed — undefined makes the caller refuse to",
    "  // report the branch as compliant, so a lookup that could not be taken",
    "  // costs a refusal rather than a skipped gate.",
    GUARD_LINE,
  ].join("\n")
);

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop()!, { force: true, recursive: true });
  }
});

describe("check-probe-absence-direction", () => {
  it("reports an unmarked failure-as-absence in a real tree", () => {
    const root = makeTree();
    write(root, FIXTURE_PATH, UNMARKED_LOOKUP);

    const report = sweep(root, ["scripts"]);

    expect(report.inspected).toBe(1);
    expect(report.findings.length).toBe(1);
    const finding = report.findings[0]!;
    expect(finding.file).toBe(FIXTURE_PATH);
    expect(finding.line).toBe(7);
    expect(finding.reason).toContain("no `probe-direction:` marker");
  });

  it("passes the same site once the direction is recorded at the line", () => {
    const root = makeTree();
    write(root, FIXTURE_PATH, MARKED_LOOKUP);

    const report = sweep(root, ["scripts"]);

    expect(report.inspected).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("refuses a `fail-open` marker instead of accepting it as an exemption", () => {
    const root = makeTree();
    write(
      root,
      FIXTURE_PATH,
      UNMARKED_LOOKUP.replace(
        GUARD_LINE,
        [
          "  // probe-direction: fail-open — we know this skips the gate and we",
          "  // have decided to live with it for now.",
          GUARD_LINE,
        ].join("\n")
      )
    );

    const report = sweep(root, ["scripts"]);

    expect(report.inspected).toBe(1);
    expect(report.findings.length).toBe(1);
    const finding = report.findings[0]!;
    expect(finding.direction).toBe("fail-open");
    expect(finding.reason).toContain("marked `fail-open`");
  });

  it("refuses a direction asserted with no rationale", () => {
    const root = makeTree();
    write(
      root,
      FIXTURE_PATH,
      UNMARKED_LOOKUP.replace(
        GUARD_LINE,
        ["  // probe-direction: fail-closed", GUARD_LINE].join("\n")
      )
    );

    const report = sweep(root, ["scripts"]);

    expect(report.findings.length).toBe(1);
    expect(report.findings[0]!.reason).toContain("no rationale");
  });

  it("leaves an absence that never asked anything external uninspected", () => {
    const root = makeTree();
    write(
      root,
      FIXTURE_PATH,
      [
        "export function parseRows(text) {",
        "  try {",
        "    return JSON.parse(text);",
        "  } catch {",
        RETURN_NULL,
        "  }",
        "}",
        "",
      ].join("\n")
    );

    const report = sweep(root, ["scripts"]);

    expect(report.inspected).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it("keeps a catch site inspected once the marker is written inside it", () => {
    const root = makeTree();
    write(
      root,
      FIXTURE_PATH,
      [
        'import { execFileSync } from "node:child_process";',
        "",
        "export function head(repo) {",
        "  try {",
        '    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo });',
        "  } catch {",
        "    // probe-direction: fail-closed — no revision means the caller",
        "    // refuses rather than reporting an unchanged tree.",
        RETURN_NULL,
        "  }",
        "}",
        "",
      ].join("\n")
    );

    const report = sweep(root, ["scripts"]);

    // The marker must not be able to hide the site from the sweep: a check that
    // goes green because annotating removed the population is the same defect
    // one level up.
    expect(report.inspected).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("does not read a comment quoting the shape as the shape", () => {
    const root = makeTree();
    write(
      root,
      FIXTURE_PATH,
      [
        'import { spawnSync } from "node:child_process";',
        "",
        "/**",
        " * Documents the `catch { return null; }` form this module avoids.",
        " * @returns {number} Always zero.",
        " */",
        "export function noop() {",
        '  spawnSync("true", []);',
        "  return 0;",
        "}",
        "",
      ].join("\n")
    );

    const report = sweep(root, ["scripts"]);

    expect(report.inspected).toBe(0);
  });

  it("treats an empty tree as an unperformed inspection, not a clean one", () => {
    const root = makeTree();
    mkdirSync(path.join(root, "scripts"), { recursive: true });

    const report = sweep(root, ["scripts"]);

    expect(report.inspected).toBe(0);
    expect(formatReport(report)).toContain("ZERO sites inspected");
  });

  it("names its blind spots in every report", () => {
    const root = makeTree();
    write(root, FIXTURE_PATH, MARKED_LOOKUP);

    const text = formatReport(sweep(root, ["scripts"]));

    expect(text).toContain("Not audited by this sweep:");
    for (const spot of BLIND_SPOTS) expect(text).toContain(spot);
  });

  it("accepts exactly two directions, and `fail-open` is not one", () => {
    expect(PERMITTED_DIRECTIONS).toEqual(["fail-closed", "neutral"]);
    expect(refusalFor(undefined)).toContain("no `probe-direction:` marker");
    expect(
      refusalFor({ direction: "neutral", rationale: "printed in the report" })
    ).toBeUndefined();
  });

  it("reads the direction and its rationale off a marker line", () => {
    expect(
      readDirection(["  // probe-direction: neutral — nothing gates on it"])
    ).toEqual({ direction: "neutral", rationale: "nothing gates on it" });
  });

  it("skips blanks and comments when locating a branch's return", () => {
    expect(nextCodeLine(["} catch {", "  // note", "", RETURN_NULL], 0)).toBe(
      3
    );
  });

  it("finds both the guarded-return and the catch form", () => {
    const shapes = absenceBranches([
      "if (result.status !== 0) return undefined;",
      "} catch {",
      RETURN_NULL,
    ]).map(site => site.shape);
    const ordered = [...shapes].sort((left: string, right: string) =>
      left.localeCompare(right)
    );

    expect(ordered).toEqual(["catch", "guarded return"]);
  });

  it("finds nothing in this repository, having inspected something", () => {
    const report = sweep(REPO_ROOT);

    // Both halves, always together. Zero findings alone is satisfied by a sweep
    // that stopped looking; a non-zero inspected count is what makes the clean
    // verdict a fact about the tree rather than about the sweep.
    expect(report.inspected).toBeGreaterThan(0);
    expect(report.findings).toEqual([]);
  });
});
