/**
 * The Markdown-assertion test cull (CodySwannGT/lisa#4867): deleting WORDING
 * sites from a test file, and the containers and declarations they leave
 * empty, without touching anything else.
 * @module tests/unit/scripts/markdown-assertions-test-cull
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { exercisesCode } from "../../../scripts/lib/markdown-assertions/sites.mjs";
import { cullTestFiles } from "../../../scripts/lib/markdown-assertions/test-cull.mjs";

const FILE = "x.test.ts";

const SOURCE = `import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const doc = readFileSync("doc.md", "utf8");
const unusedAfter = doc.slice(0, 10);

const assertProse = (text: string): void => {
  expect(text).toContain("prose one");
};

describe("doc", () => {
  it("keeps a machine token", () => {
    expect(doc).toContain("[lisa-human-gate]");
    expect(doc).toContain("prose two");
  });

  it("loses everything", () => {
    const local = unusedAfter;
    expect(local).toContain("prose three");
    assertProse(doc);
  });
});
`;

let roots: string[] = [];

/**
 * A scratch repository holding one test file.
 * @param text - The test file's contents.
 * @returns The repository root.
 */
function scratch(text: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-md-cull-"));
  roots = [...roots, root];
  writeFileSync(path.join(root, FILE), text);
  return root;
}

/**
 * A WORDING site at the matcher of the first `expect` containing `needle`.
 * @param needle - Text on the assertion's line.
 * @returns The site.
 */
function siteAt(needle: string) {
  const lines = SOURCE.split("\n");
  const index = lines.findIndex(line => line.includes(needle));
  const column = (lines[index] ?? "").indexOf(".toContain") + 2;
  return {
    site: `${FILE}:${index + 1}:${column}`,
    file: FILE,
    line: index + 1,
    column,
    runs: 1,
    class: "WORDING",
    why: "prose no shipped code reads",
    sample: needle,
  };
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

describe("cullTestFiles", () => {
  it("deletes WORDING sites, emptied tests and helpers, and unused declarations", () => {
    const root = scratch(SOURCE);
    const result = cullTestFiles(root, [
      siteAt('"prose one"'),
      siteAt('"prose two"'),
      siteAt('"prose three"'),
    ]);
    const after = readFileSync(path.join(root, FILE), "utf8");

    expect(result.removedSites).toBe(3);
    expect(after).toContain('expect(doc).toContain("[lisa-human-gate]")');
    expect(after).not.toContain("prose");
    expect(after).not.toContain("loses everything");
    expect(after).not.toContain("assertProse");
    expect(after).not.toContain("unusedAfter");
  });

  it("deletes a file left with no test", () => {
    const root = scratch(SOURCE);
    const result = cullTestFiles(root, [
      siteAt('"prose one"'),
      siteAt('"[lisa-human-gate]"'),
      siteAt('"prose two"'),
      siteAt('"prose three"'),
    ]);

    expect(result.edits[0]?.deleted).toBe(true);
    expect(existsSync(path.join(root, FILE))).toBe(false);
  });
});

describe("exercisesCode", () => {
  const none = (): undefined => undefined;
  const TEST_FILE = "tests/unit/a.test.ts";

  it("is false for a test that only reads documents", () => {
    expect(
      exercisesCode(
        TEST_FILE,
        'import { readFileSync } from "node:fs";\nimport { it } from "vitest";\n',
        none
      )
    ).toBe(false);
  });

  it("is true for a test that imports code or spawns a process", () => {
    expect(
      exercisesCode(
        TEST_FILE,
        'import { run } from "../../src/run.js";\n',
        none
      )
    ).toBe(true);
    expect(
      exercisesCode(
        TEST_FILE,
        'import { execFileSync } from "node:child_process";\n',
        none
      )
    ).toBe(true);
  });
});
