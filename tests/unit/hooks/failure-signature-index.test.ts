/**
 * Behavior of the failure-signature index — the mechanism that makes a hazard
 * reachable from its EFFECT rather than only from its cause
 * (CodySwannGT/lisa#3061).
 *
 * Every `--check` arm here is a way the index could otherwise report all-clear
 * while routing nothing: a pointer that rotted, a signature that can never
 * fire, and an index with no live rows at all. Wiring lives in
 * failure-signature-index-wiring.test.ts.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  anchorLine,
  formatReport,
  isSelfReferential,
  loadIndex,
  matchEntries,
  outputText,
  runCheck,
  validateIndex,
} from "../../../plugins/src/base/hooks/failure-signature-index.mjs";

/** Where an explanation already lives. */
interface Record {
  readonly file: string;
  readonly anchor: string;
}

/** One row of the routing table. */
interface Entry {
  readonly id: string;
  readonly symptom: string;
  readonly sample: string;
  readonly signature: string;
  readonly cause: string;
  readonly records: readonly Record[];
  readonly guard?: Record & { readonly name: string };
}

const ANCHOR = "leave water in the kettle";
const NOTE = `${ANCHOR}\n`;

const HEALTHY: Entry = {
  id: "kettle-boils-dry",
  symptom: "a scorched smell from the kitchen",
  sample: "kettle: thermal cutout tripped",
  signature: "thermal cutout tripped",
  cause: "the kettle was switched on empty",
  records: [{ file: "NOTES.md", anchor: ANCHOR }],
};

/**
 * A throwaway repository holding one index and one cited record.
 *
 * Realpath'd, because on macOS the temp directory is reached through a symlink
 * and a fixture path that disagrees with its own real path is exactly the
 * fail-open shape these tests exist to catch.
 * @param entries - Rows to write into the index
 * @param noteBody - Contents of the cited record file
 * @returns Absolute path to the fixture root
 */
function fixture(entries: readonly unknown[], noteBody: string): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "failure-signatures-"))
  );
  fs.writeFileSync(path.join(root, "NOTES.md"), noteBody);
  fs.writeFileSync(
    path.join(root, "failure-signatures.json"),
    JSON.stringify({ version: 1, entries })
  );
  return root;
}

describe("failure-signature index — matching", () => {
  it("matches an entry against the output a person actually sees", () => {
    expect(
      matchEntries("boom\nkettle: thermal cutout tripped\n", [HEALTHY])
    ).toHaveLength(1);
  });

  it("stays silent on output that matches nothing", () => {
    expect(matchEntries("all 812 tests passed", [HEALTHY])).toHaveLength(0);
  });

  it("names the record file and its line so the note is one click away", () => {
    const root = fixture([HEALTHY], `one\ntwo\n${NOTE}`);
    const report = formatReport([HEALTHY], root);
    expect(report).toContain("NOTES.md:3");
    expect(report).toContain("the kettle was switched on empty");
  });

  it("names an existing guard so nobody builds a second control for it", () => {
    const guarded = {
      ...HEALTHY,
      guard: {
        file: "NOTES.md",
        anchor: ANCHOR,
        name: 'the check "kettle has water?"',
      },
    };
    const root = fixture([guarded], NOTE);
    expect(formatReport([guarded], root)).toContain(
      'ALREADY GUARDED by the check "kettle has water?"'
    );
  });

  it("reads a Bash payload's stdout and stderr, and nothing nested", () => {
    expect(
      outputText({
        tool_response: { stdout: "out", stderr: "err", nested: { deep: "no" } },
      })
    ).toBe("out\nerr");
  });

  it("stays silent when the command is about the index itself", () => {
    expect(
      isSelfReferential({
        tool_input: { command: "cat failure-signatures.json" },
      })
    ).toBe(true);
  });
});

describe("failure-signature index — check refuses a decorative index", () => {
  it("fails when a cited record no longer contains its anchor", () => {
    const root = fixture([HEALTHY], "this note was rewritten\n");
    const { problems } = validateIndex([HEALTHY], root);
    expect(problems.join("\n")).toContain("the pointer rotted");
    expect(runCheck(root)).toBe(1);
  });

  it("fails when a cited record file is gone entirely", () => {
    const root = fixture([HEALTHY], NOTE);
    fs.rmSync(path.join(root, "NOTES.md"));
    expect(runCheck(root)).toBe(1);
  });

  it("fails when a signature cannot match its own sample", () => {
    const typo = { ...HEALTHY, signature: "thermal cutout tripepd" };
    const root = fixture([typo], NOTE);
    const { problems } = validateIndex([typo], root);
    expect(problems.join("\n")).toContain("can never fire");
    expect(runCheck(root)).toBe(1);
  });

  it("fails when a signature is not a valid regular expression", () => {
    const broken = { ...HEALTHY, signature: "thermal (cutout" };
    const root = fixture([broken], NOTE);
    expect(runCheck(root)).toBe(1);
  });

  it("fails when an entry points at no record at all", () => {
    const orphan = { ...HEALTHY, records: [] };
    const root = fixture([orphan], NOTE);
    const { problems } = validateIndex([orphan], root);
    expect(problems.join("\n")).toContain("points at no existing explanation");
  });

  it("fails when a guard pointer rotted, even though the records resolve", () => {
    const guarded = {
      ...HEALTHY,
      guard: { file: "NOTES.md", anchor: "descale it", name: "the descaler" },
    };
    const root = fixture([guarded], NOTE);
    expect(runCheck(root)).toBe(1);
  });

  it("fails on an index that resolves ZERO entries rather than reporting clean", () => {
    const root = fixture([], NOTE);
    const { problems, resolved } = validateIndex([], root);
    expect(resolved).toBe(0);
    expect(problems.join("\n")).toContain("resolves ZERO entries");
    expect(runCheck(root)).toBe(1);
  });

  it("fails when two entries share an id", () => {
    const root = fixture([HEALTHY, HEALTHY], NOTE);
    expect(
      validateIndex([HEALTHY, HEALTHY], root).problems.join("\n")
    ).toContain("duplicate id");
  });

  it("fails when the index file is absent", () => {
    const root = fixture([HEALTHY], NOTE);
    fs.rmSync(path.join(root, "failure-signatures.json"));
    expect(loadIndex(root).error).toContain("does not exist");
    expect(runCheck(root)).toBe(1);
  });

  it("passes when every pointer resolves and every signature can fire", () => {
    const root = fixture([HEALTHY], NOTE);
    expect(anchorLine(root, HEALTHY.records[0]!)).toBe(1);
    expect(runCheck(root)).toBe(0);
  });
});
