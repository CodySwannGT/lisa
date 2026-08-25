/**
 * Tests for the whole-output-guard sweep (CodySwannGT/lisa#3081).
 *
 * The load-bearing cases point the real `sweep()` at REAL directory trees. One
 * holds the exact shape the ticket was filed for — two chained anchored
 * rewrites plus `if (out === source) throw` — and asserts the report names the
 * unaccounted anchors; a sweep proven only against hand-written strings would
 * demonstrate that it parses, not that it bites. Its negative control is a tree
 * whose transform asserts each anchor, which must come back clean, because a
 * sweep that reported everything would satisfy the first assertion and be
 * useless. A third points it at an empty tree and asserts exit 2, because an
 * empty inspection and a clean tree otherwise print the same tick.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/check-whole-output-guards
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  classifyAnchor,
  collectFiles,
  formatReport,
  judgeScope,
  SCANNED_ROOTS,
  sweep,
} from "../../../scripts/check-whole-output-guards.mjs";

/** Where the offending fixture is written inside a throwaway tree. */
const FIXTURE_PATH = "src/prover-fixture.mjs";

/** Temp trees created by a test, removed afterwards. */
const created: string[] = [];

/**
 * Create a throwaway directory tree for the sweep to walk.
 * @returns Absolute path of the new tree.
 */
function makeTree(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-test-wog-sweep-"));
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

/**
 * The two-step transform guarded only by a whole-output comparison — the shape
 * that shipped in CodySwannGT/lisa#2980, reproduced verbatim in structure.
 */
const OFFENDING_TRANSFORM = [
  "export function preMoveProverSource(source) {",
  "  const rewritten = source",
  '    .replace("import { execFileSync } from \\"node:child_process\\";", "IMPORTS")',
  '    .replace("path.resolve(root ?? process.cwd())", "path.resolve(root ?? dir)");',
  "  if (rewritten === source) {",
  '    throw new Error("the pre-move prover fixture no longer applies");',
  "  }",
  "  return rewritten;",
  "}",
  "",
].join("\n");

/** The same transform with each anchor asserted before it is replaced. */
const ACCOUNTABLE_TRANSFORM = [
  "export function preMoveProverSource(source) {",
  "  return [",
  '    ["import { execFileSync } from \\"node:child_process\\";", "IMPORTS"],',
  '    ["path.resolve(root ?? process.cwd())", "path.resolve(root ?? dir)"],',
  "  ].reduce((text, [anchor, replacement]) => {",
  "    if (!text.includes(anchor)) {",
  "      throw new Error(`missing anchor ${anchor}`);",
  "    }",
  "    return text.replace(anchor, replacement);",
  "  }, source);",
  "}",
  "",
].join("\n");

/** A single-step transform: the whole-output comparison is sound at N=1. */
const SINGLE_STEP_TRANSFORM = [
  "export function bump(source) {",
  '  const out = source.replace("0.0.0", "1.0.0");',
  "  if (out === source) {",
  '    throw new Error("the version anchor moved");',
  "  }",
  "  return out;",
  "}",
  "",
].join("\n");

/** The write-if-changed idiom: a comparison that returns rather than throws. */
const IDEMPOTENCE_SHORT_CIRCUIT = [
  "export function reconcile(existing) {",
  '  const stripped = existing.replace("<!-- legacy -->", "");',
  '  const desired = stripped.replace("<!-- pointer -->", "POINTER");',
  "  if (desired === existing) {",
  "    return [];",
  "  }",
  '  return ["wrote"];',
  "}",
  "",
].join("\n");

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("sweep", () => {
  it("names every unaccounted anchor of a transform guarded only whole-output", () => {
    const root = makeTree();
    write(root, FIXTURE_PATH, OFFENDING_TRANSFORM);

    const report = sweep(root);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].file).toBe(FIXTURE_PATH);
    expect(report.findings[0].scope).toBe("preMoveProverSource");
    expect(report.findings[0].steps).toBe(2);
    expect(report.findings[0].unaccounted).toHaveLength(2);
    expect(
      report.findings[0].unaccounted.map(
        (step: { anchor: string }) => step.anchor
      )
    ).toEqual([
      '"import { execFileSync } from \\"node:child_process\\";"',
      '"path.resolve(root ?? process.cwd())"',
    ]);
    expect(report.findings[0].guards[0].test).toBe("rewritten === source");
  });

  it("a transform that asserts each anchor comes back clean", () => {
    const root = makeTree();
    write(root, FIXTURE_PATH, ACCOUNTABLE_TRANSFORM);

    const report = sweep(root);

    expect(report.inspected).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("leaves a single-step transform alone — the comparison is sound at N=1", () => {
    const root = makeTree();
    write(root, "src/bump.mjs", SINGLE_STEP_TRANSFORM);

    const report = sweep(root);

    expect(report.inspected).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("passes a write-if-changed comparison that returns rather than throws", () => {
    const root = makeTree();
    write(root, "src/reconcile.mjs", IDEMPOTENCE_SHORT_CIRCUIT);

    const report = sweep(root);

    expect(report.inspected).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("reports zero inspected for an empty tree, so an empty sweep cannot read as clean", () => {
    const root = makeTree();
    mkdirSync(path.join(root, "src"), { recursive: true });

    const report = sweep(root);

    expect(report.inspected).toBe(0);
    expect(formatReport(report)).toContain("ZERO transforms inspected");
  });

  it("reports zero inspected when no scanned root exists at all", () => {
    const report = sweep(makeTree());

    expect(report.files).toBe(0);
    expect(report.inspected).toBe(0);
  });

  it("inspects this repository and finds nothing", () => {
    const report = sweep(process.cwd());

    expect(report.findings).toEqual([]);
    expect(report.inspected).toBeGreaterThan(0);
  });
});

describe("classifyAnchor", () => {
  it("counts a literal anchor and skips a global regular expression", () => {
    const root = makeTree();
    write(
      root,
      "src/global-rewrite.mjs",
      [
        "export function strip(source) {",
        '  const out = source.replace(/\\s+/g, " ").replace(/^\\s+/g, "");',
        "  if (out === source) {",
        '    throw new Error("nothing changed");',
        "  }",
        "  return out;",
        "}",
        "",
      ].join("\n")
    );

    const report = sweep(root);

    expect(report.inspected).toBe(0);
    expect(report.findings).toEqual([]);
    expect(typeof classifyAnchor).toBe("function");
  });
});

describe("judgeScope", () => {
  it("clears a scope whose every step comes from an accountable call", () => {
    expect(
      judgeScope(
        {
          accountableCalls: 2,
          assertedAnchors: new Set<string>(),
          guards: [
            { line: 3, operands: ["out", "source"], test: "out === source" },
          ],
          name: "build",
          steps: [
            { anchor: '"a"', iterated: false, line: 1 },
            { anchor: '"b"', iterated: false, line: 2 },
          ],
          variables: new Set(["out", "source"]),
        },
        "src/build.mjs"
      )
    ).toBeNull();
  });

  it("clears a guard whose operands have nothing to do with the transform", () => {
    expect(
      judgeScope(
        {
          accountableCalls: 0,
          assertedAnchors: new Set<string>(),
          guards: [
            { line: 3, operands: ["mode", "other"], test: "mode !== other" },
          ],
          name: "build",
          steps: [
            { anchor: '"a"', iterated: false, line: 1 },
            { anchor: '"b"', iterated: false, line: 2 },
          ],
          variables: new Set(["out", "source"]),
        },
        "src/build.mjs"
      )
    ).toBeNull();
  });
});

describe("collectFiles", () => {
  it("skips node_modules, dist and type-declaration files", () => {
    const root = makeTree();
    write(root, "src/kept.ts", "export const kept = 1;\n");
    write(root, "src/types.d.ts", "export declare const skipped: number;\n");
    write(root, "src/node_modules/dep/index.js", "module.exports = 1;\n");
    write(root, "src/dist/built.js", "export const built = 1;\n");

    expect(
      collectFiles(path.join(root, "src"), root).map(file => file.relative)
    ).toEqual([path.join("src", "kept.ts")]);
  });
});

describe("SCANNED_ROOTS", () => {
  it("covers the trees this repository authors source in", () => {
    expect([...SCANNED_ROOTS]).toEqual([
      "all",
      "cdk",
      "expo",
      "harper-fabric",
      "nestjs",
      "npm-package",
      "phaser",
      "plugins/src",
      "rails",
      "scripts",
      "src",
      "tests",
      "typescript",
    ]);
  });
});
