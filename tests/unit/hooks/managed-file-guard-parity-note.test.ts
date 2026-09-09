/**
 * The managed-file guard's parity note must agree with the ports that exist.
 *
 * ## The defect this exists to make visible
 *
 * `block-managed-file-edits.sh` carried a header paragraph reading "This guard
 * has no Antigravity, Codex or OpenCode port". It was true when written, and
 * AGENTS.md is why it was written: a behaviour a surface cannot represent gets
 * documented rather than silently dropped. Then all three ports shipped and the
 * note did not move, so a rule meant to make a gap legible was reporting three
 * missing ports where none were missing.
 *
 * **A stale gap note is worse than no note.** It OVERSTATES the gap, and the
 * reader who trusts it cannot tell which third is real without redoing the
 * whole measurement — which is the cost the note existed to save. It also
 * survives review indefinitely, because a comment claiming absence reads as
 * conservative and nobody re-derives a conservative claim.
 *
 * ## Why this asserts against artifacts rather than against a string
 *
 * The obvious test — "the file does not contain that sentence" — pins one
 * spelling of one stale claim and says nothing about the next one. This asks
 * the question the note is an answer to: for each surface, does a port exist,
 * and does the guard's own text claim it does not? A note that goes stale in
 * either direction fails here — a port that ships without the note being
 * narrowed, and a port that is REMOVED without the note being restored.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED: the port
 * artifact paths below are written out rather than derived from the guard or
 * from a manifest, so a registration deleted from both places still fails this.
 *
 * @module tests/unit/hooks/managed-file-guard-parity-note
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "..", "..", "..");

/** The guard whose header makes the parity claim. */
const CANONICAL = "plugins/src/base/hooks/block-managed-file-edits.sh";

/**
 * Every shipped copy that carries the same header, canonical and generated.
 *
 * Listed rather than globbed. A glob finds what exists, so a generated copy
 * that stopped being produced would silently leave this assertion checking
 * fewer files while still passing — the shape this repository has already paid
 * for once in `guard-behavioural-parity`.
 */
const COPIES: readonly string[] = [
  CANONICAL,
  "plugins/lisa/hooks/block-managed-file-edits.sh",
  "plugins/lisa-agy/hooks/block-managed-file-edits.sh",
  "plugins/lisa-cursor/hooks/block-managed-file-edits.sh",
  "plugins/lisa-copilot/hooks/block-managed-file-edits.sh",
  "all/copy-overwrite/scripts/lisa-hooks/block-managed-file-edits.sh",
];

/**
 * The three surfaces the stale note named, and the artifact that proves each.
 *
 * One artifact per surface, chosen to be the thing whose absence would actually
 * un-port that surface rather than a file that merely mentions it.
 */
const PORTS: readonly (readonly [string, string])[] = [
  ["Antigravity", "plugins/src/base/hooks/block-managed-file-edits.agy.sh"],
  [
    "OpenCode",
    "src/opencode/plugin-templates/lisa-block-managed-file-edits.ts",
  ],
  ["Codex", "plugins/lisa/.codex-plugin/hooks.json"],
];

/**
 * Read one repository file.
 * @param relative - Repository-relative path.
 * @returns The file's text.
 */
function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

describe("the managed-file guard is ported to every surface", () => {
  it.each(PORTS)("%s has its port artifact", (_surface, artifact) => {
    expect(existsSync(path.join(ROOT, artifact))).toBe(true);
  });

  it("Codex registers the guard rather than merely shipping a file", () => {
    // The Codex artifact above is a manifest, so its existence proves nothing
    // on its own — only that the file is there. This is the assertion that
    // makes the Codex row mean what the other two mean.
    expect(read("plugins/lisa/.codex-plugin/hooks.json")).toContain(
      "block-managed-file-edits.sh"
    );
  });

  it("the enforcement fallback also routes it, which is Codex's apply_patch path", () => {
    // Codex forwards `apply_patch` to the dispatcher, not to the plugin hook
    // matcher, so this is the registration that covers Codex's most common
    // write. Losing it would un-port Codex while the manifest above still read
    // as complete.
    expect(read("scripts/lisa-enforcement-fallback.sh")).toContain(
      "block-managed-file-edits"
    );
  });
});

describe("no shipped copy claims a port that exists is missing", () => {
  it.each(COPIES)("%s does not overstate the gap", relative => {
    // The load-bearing assertion. It fails against the note as it stood: three
    // ports present, and a header saying none of them were.
    const source = read(relative);
    for (const [surface] of PORTS) {
      expect(source).not.toMatch(
        new RegExp(`no ${surface}[^\\n]*port|has no [^\\n]*${surface}`, "iu")
      );
    }
  });

  it("keeps every copy in step, so the note cannot be fixed in one place", () => {
    // The canonical guard and its generated copies must carry the same header.
    // Editing the source without regenerating is how half the fleet would keep
    // reading the stale claim.
    const canonical = read(CANONICAL);
    const marker = "There is no parity gap left to record";
    expect(canonical).toContain(marker);
    for (const relative of COPIES) {
      expect(read(relative), relative).toContain(marker);
    }
  });
});
