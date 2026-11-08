/**
 * The phrase recorder (CodySwannGT/lisa#4609) runs a phrase-only test file
 * under a stub runner and translates each phrase assertion into a manifest
 * entry. An assertion translates only when its subject is exactly the full
 * text of one file the test read; anything else (a section, a normalised
 * copy) makes the whole file untranslatable, so it is kept rather than lost.
 * @module tests/unit/scripts/phrase-tests-record
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recordTestFile } from "../../../scripts/lib/phrase-tests/record.mjs";

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop()!, { force: true, recursive: true });
  }
});

/**
 * Write a scratch repository and record one test file inside it.
 * @param files - Repository-relative path to text
 * @param testFile - The test to record
 * @returns The recording
 */
async function record(files: Record<string, string>, testFile: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-test-phrase-record-"));
  created.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return recordTestFile(testFile, {
    root,
    readSource: (file: string) => files[file],
  });
}

const HEADER = [
  'import { readFileSync } from "node:fs";',
  'import { readFile } from "node:fs/promises";',
  'import { describe, expect, it } from "vitest";',
].join("\n");

const TEST = "tests/a.test.ts";
const DOC = "alpha beta\ngamma\n";

describe("recordTestFile", () => {
  it("translates every phrase form on a whole file's text", async () => {
    const test = [
      HEADER,
      'describe.each(["docs/a.md", "docs/b.md"])("%s", file => {',
      '  const text = readFileSync(file, "utf8");',
      '  it("pins", () => {',
      '    expect(text).toContain("alpha");',
      '    expect(text).not.toContain("omega");',
      "    expect(text).toMatch(/^gamma$/mu);",
      '    expect(text).toMatch("beta");',
      '    expect(text.includes("gamma")).toBe(true);',
      '    expect(text.includes("zeta")).toBe(false);',
      "  });",
      "});",
    ].join("\n");
    const result = await record(
      { "docs/a.md": DOC, "docs/b.md": `${DOC}b\n`, [TEST]: test },
      TEST
    );
    expect(result.reasons).toEqual([]);
    expect(result.raw).toBe(12);
    expect(result.entries).toContainEqual({
      file: "docs/a.md",
      polarity: "required",
      kind: "pattern",
      value: { source: "^gamma$", flags: "mu" },
      source: `${TEST} › docs/a.md > pins`,
    });
    expect(result.entries).toContainEqual({
      file: "docs/b.md",
      polarity: "forbidden",
      kind: "string",
      value: "zeta",
      source: `${TEST} › docs/b.md > pins`,
    });
    expect(
      result.entries.filter(entry => entry.file === "docs/a.md")
    ).toHaveLength(6);
  });

  it("records reads made with the promise API and helpers inside tests/", async () => {
    const helper = [
      'import { readFileSync } from "node:fs";',
      'export const read = (rel: string): string => readFileSync(rel, "utf8");',
    ].join("\n");
    const test = [
      HEADER,
      'import { read } from "./helper.js";',
      'it("a", async () => {',
      '  expect(await readFile("docs/a.md", "utf8")).toContain("alpha");',
      '  expect(read("docs/a.md")).not.toContain("omega");',
      "});",
    ].join("\n");
    const result = await record(
      {
        "docs/a.md": DOC,
        "tests/helper.ts": helper,
        [TEST]: test,
      },
      TEST
    );
    expect(result.reasons).toEqual([]);
    expect(result.entries.map(entry => entry.value)).toEqual([
      "alpha",
      "omega",
    ]);
  });

  it("marks the file untranslatable when a subject is a section, not a whole file", async () => {
    const test = [
      HEADER,
      'const text = readFileSync("docs/a.md", "utf8");',
      'it("whole", () => { expect(text).toContain("alpha"); });',
      'it("section", () => { expect(text.slice(6)).toContain("beta"); });',
    ].join("\n");
    const result = await record({ "docs/a.md": DOC, [TEST]: test }, TEST);
    expect(result.raw).toBe(2);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("section");
    expect(result.reasons[0]).toContain("not the full text");
  });

  it("marks the file untranslatable when an assertion fails on the current tree", async () => {
    const test = [
      HEADER,
      'it("a", () => { expect(readFileSync("docs/a.md", "utf8")).toContain("omega"); });',
    ].join("\n");
    const result = await record({ "docs/a.md": DOC, [TEST]: test }, TEST);
    expect(result.reasons.join("\n")).toContain("fails");
  });

  it("marks the file untranslatable when it records no runtime assertion", async () => {
    const test = [
      HEADER,
      'it.skip("a", () => { expect("x").toContain("x"); });',
    ].join("\n");
    const result = await record({ [TEST]: test }, TEST);
    expect(result.raw).toBe(0);
    expect(result.reasons).toContain("no runtime phrase assertions");
  });

  it("resolves import.meta.url to the test file's own location", async () => {
    const test = [
      HEADER,
      'import path from "node:path";',
      'import { fileURLToPath } from "node:url";',
      "const here = path.dirname(fileURLToPath(import.meta.url));",
      'it("a", () => { expect(readFileSync(path.join(here, "../docs/a.md"), "utf8")).toContain("alpha"); });',
    ].join("\n");
    const result = await record({ "docs/a.md": DOC, [TEST]: test }, TEST);
    expect(result.reasons).toEqual([]);
    expect(result.entries[0]?.file).toBe("docs/a.md");
  });

  it("exposes only the read members of the file-system modules", async () => {
    const test = [
      'import fs from "node:fs";',
      'import { describe, expect, it } from "vitest";',
      'it("a", () => { fs.statSync("docs/a.md"); expect("t").toContain("t"); });',
    ].join("\n");
    const result = await record({ "docs/a.md": DOC, [TEST]: test }, TEST);
    expect(result.reasons.join("\n")).toContain("statSync");
  });

  it("provides __dirname like vitest, and lets a file declare its own", async () => {
    const uses = [
      HEADER,
      'import path from "node:path";',
      'it("a", () => { expect(readFileSync(path.join(__dirname, "../docs/a.md"), "utf8")).toContain("alpha"); });',
    ].join("\n");
    const declares = [
      HEADER,
      'const __dirname = "docs";',
      'it("a", () => { expect(readFileSync(`${__dirname}/a.md`, "utf8")).toContain("alpha"); });',
    ].join("\n");
    const files = {
      "docs/a.md": DOC,
      "tests/uses.test.ts": uses,
      "tests/declares.test.ts": declares,
    };
    expect((await record(files, "tests/uses.test.ts")).reasons).toEqual([]);
    expect((await record(files, "tests/declares.test.ts")).reasons).toEqual([]);
  });

  it("attributes each assertion to its own file when two files hold identical text", async () => {
    const test = [
      HEADER,
      'const a = readFileSync("docs/a.md", "utf8");',
      'const b = readFileSync("docs/b.md", "utf8");',
      'it("a", () => { expect(a).toContain("alpha"); expect(b).toContain("beta"); });',
    ].join("\n");
    const result = await record(
      { "docs/a.md": DOC, "docs/b.md": DOC, [TEST]: test },
      TEST
    );
    expect(result.reasons).toEqual([]);
    expect(result.entries.map(entry => [entry.file, entry.value])).toEqual([
      ["docs/a.md", "alpha"],
      ["docs/b.md", "beta"],
    ]);
  });
});
