/**
 * Tests for the guard-parity-note sweep (CodySwannGT/lisa#3908).
 *
 * The load-bearing cases point the real `sweep()` at REAL directory trees. One
 * holds the exact note the ticket was filed for — the pre-fix wording claiming
 * three missing ports while two of them sit in the tree — and asserts the
 * report names the guard, each contradicted surface, and the file that proves
 * it. Its negative control is the corrected wording over the SAME tree, which
 * must come back clean, because a sweep that refused every note would satisfy
 * the first assertion and be useless. A third records a gap that is genuinely
 * absent and must also pass: the note exists to record real gaps, and a check
 * that could not tell a true record from a stale one would delete the record
 * along with the drift. A fourth points the sweep at an empty tree and asserts
 * zero sources read, because an empty sweep and a clean tree otherwise print
 * the same tick.
 *
 * The last case is the enforcement itself: the sweep run over THIS repository
 * must find nothing while having read something. That pairing is the whole
 * control — either half alone is satisfiable by a sweep that stopped looking.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/check-guard-parity-notes
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  BLIND_SPOTS,
  claimsIn,
  commentBlocks,
  formatReport,
  guardIdFor,
  portFor,
  SURFACES,
  sweep,
} from "../../../scripts/check-guard-parity-notes.mjs";

/** Repository root, four levels up from this file. */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/** Temp trees created by a test, removed afterwards. */
const created: string[] = [];

/**
 * Create a throwaway directory tree for the sweep to walk.
 * @returns Absolute path of the new tree.
 */
function makeTree(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-test-parity-note-"));
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

/** The Antigravity port fixture, written and then named as the contradiction. */
const DEMO_AGY_PORT = "plugins/src/base/hooks/demo-guard.agy.sh";

/** Guard id every fixture tree in this file uses. */
const DEMO_GUARD = "demo-guard";

/** A real guard id, spelled once for the naming-convention cases. */
const REAL_GUARD = "block-no-verify";

/** The exact sentence #3908 was filed for. */
const STALE_CLAIM =
  "This guard has no Antigravity, Codex or OpenCode port — only the Claude";

/** The corrected wording: Codex is the one surface with no port. */
const TRUE_CLAIM = "This guard has no Codex port. Every other surface has one.";

/**
 * A guard header carrying one parity note.
 * @param claim - The note's claim sentence.
 * @returns Shell source for the guard.
 */
function guardSource(claim: string): string {
  return [
    "#!/usr/bin/env bash",
    "#",
    "# ## Parity gap, recorded rather than silently dropped",
    "#",
    `# ${claim}`,
    "# reference and the copies generated from it.",
    "set -euo pipefail",
    "",
  ].join("\n");
}

/**
 * Lay down a guard whose Antigravity and OpenCode ports both exist.
 * @param root - Tree root.
 * @param claim - The note's claim sentence.
 */
function writeGuardWithTwoPorts(root: string, claim: string): void {
  write(root, "plugins/src/base/hooks/demo-guard.sh", guardSource(claim));
  write(root, DEMO_AGY_PORT, "# agy port\n");
  write(root, "src/opencode/plugin-templates/lisa-demo-guard.ts", "// port\n");
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop()!, { force: true, recursive: true });
  }
});

describe("check-guard-parity-notes", () => {
  it("refuses the pre-fix note against a tree that holds two of the three ports", () => {
    const root = makeTree();
    writeGuardWithTwoPorts(root, STALE_CLAIM);

    const report = sweep(root);

    expect(report.claims).toBe(1);
    expect(report.findings.length).toBe(2);
    expect(report.findings.map(finding => finding.surface)).toEqual([
      "antigravity",
      "opencode",
    ]);
    expect(report.findings[0]!.guard).toBe(DEMO_GUARD);
    expect(report.findings[0]!.file).toBe(
      "plugins/src/base/hooks/demo-guard.sh"
    );
    expect(report.findings[0]!.line).toBe(5);
    expect(report.findings[0]!.evidence).toBe(DEMO_AGY_PORT);
    expect(report.findings[1]!.evidence).toBe(
      "src/opencode/plugin-templates/lisa-demo-guard.ts"
    );
  });

  it("accepts the corrected note over the very same tree", () => {
    const root = makeTree();
    writeGuardWithTwoPorts(root, TRUE_CLAIM);

    const report = sweep(root);

    expect(report.claims).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("still lets a guard record a gap that is genuinely open", () => {
    const root = makeTree();
    write(
      root,
      "plugins/src/base/hooks/lonely-guard.sh",
      guardSource("This guard has no Codex or OpenCode port yet.")
    );

    const report = sweep(root);

    expect(report.claims).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("reads zero sources from an empty tree and says so instead of passing", () => {
    const root = makeTree();

    const report = sweep(root);

    expect(report.files).toBe(0);
    expect(formatReport(report)).toContain("ZERO guard sources read");
  });

  it("recognises the claim and its surfaces without the surrounding clause", () => {
    const blocks = commentBlocks(guardSource(STALE_CLAIM));
    const claims = claimsIn(blocks[0]!.text);

    expect(claims.length).toBe(1);
    expect(claims[0]!.surfaces).toEqual(["antigravity", "codex", "opencode"]);
    expect(claims[0]!.text).toBe("no Antigravity, Codex or OpenCode port");
  });

  it("ignores a sentence that names a surface without claiming a missing port", () => {
    const source = [
      "# The Codex port resolves its own root, so no path is passed to it.",
      "# Its OpenCode sibling reads the same environment variable.",
      "",
    ].join("\n");

    expect(claimsIn(commentBlocks(source)[0]!.text)).toEqual([]);
  });

  it("derives one guard id from each surface's file-naming convention", () => {
    expect(guardIdFor("plugins/src/base/hooks/block-no-verify.sh")).toBe(
      REAL_GUARD
    );
    expect(guardIdFor("plugins/src/base/hooks/block-no-verify.agy.sh")).toBe(
      REAL_GUARD
    );
    expect(
      guardIdFor("src/opencode/plugin-templates/lisa-block-no-verify.ts")
    ).toBe(REAL_GUARD);
    expect(guardIdFor("src/codex/scripts/block-no-verify.sh")).toBe(REAL_GUARD);
    expect(guardIdFor("plugins/src/base/hooks/README.md")).toBeUndefined();
    expect(
      guardIdFor("src/opencode/plugin-templates/unprefixed.ts")
    ).toBeUndefined();
  });

  it("covers every supported agent surface with a port path shape", () => {
    expect(SURFACES.map(surface => surface.id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "opencode",
      "antigravity",
      "copilot",
    ]);
  });

  it("resolves presence from the files rather than from a declaration", () => {
    const root = makeTree();
    write(root, DEMO_AGY_PORT, "# agy port\n");

    expect(portFor(root, DEMO_GUARD, "antigravity")).toBe(DEMO_AGY_PORT);
    expect(portFor(root, DEMO_GUARD, "codex")).toBeUndefined();
    expect(portFor(root, DEMO_GUARD, "not-a-surface")).toBeUndefined();
  });

  it("finds nothing in this repository while having read something", () => {
    const report = sweep(REPO_ROOT);

    expect(report.findings).toEqual([]);
    expect(report.files).toBeGreaterThan(0);
    expect(report.claims).toBeGreaterThan(0);
    expect(formatReport(report)).toContain(BLIND_SPOTS[0]!);
  });
});
