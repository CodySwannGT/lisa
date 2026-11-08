/**
 * The phrase-only classifier (CodySwannGT/lisa#4609) decides which test files
 * may be folded into the required-phrases manifest. Every doubt must resolve
 * to "not phrase-only", because a file it accepts is deleted once its
 * assertions are translated.
 * @module tests/unit/scripts/phrase-tests-classify
 */
import { describe, expect, it } from "vitest";

import {
  classifyTestSource,
  resolveTestImport,
} from "../../../scripts/lib/phrase-tests/classify.mjs";

const TOP_TEST = "tests/a.test.ts";
const UNIT_TEST = "tests/unit/a.test.ts";
const HELPER_TS = "tests/unit/h.ts";

const HEADER = [
  'import { readFileSync } from "node:fs";',
  'import { describe, expect, it } from "vitest";',
].join("\n");

/**
 * Build a test source from a header and a body.
 * @param body - Statements after the imports
 * @param header - Import lines
 * @returns The test file text
 */
const source = (body: string, header = HEADER): string =>
  `${header}\n${body}\n`;

/**
 * A helper reader over an in-memory file map.
 * @param files - Repository-relative path to text
 * @returns A readSource callback
 */
const reader =
  (files: Record<string, string>) =>
  (file: string): string | undefined =>
    files[file];

const PHRASE_BODY = [
  'const text = readFileSync("docs/a.md", "utf8");',
  'describe("a", () => {',
  '  it("pins", () => {',
  '    expect(text).toContain("alpha");',
  '    expect(text).not.toContain("beta");',
  "    expect(text).toMatch(/gamma/u);",
  '    expect(text.includes("delta")).toBe(true);',
  "  });",
  "});",
].join("\n");

describe("classifyTestSource", () => {
  it("accepts a file whose only I/O is reading text and whose every assertion is a phrase", () => {
    const verdict = classifyTestSource(TOP_TEST, source(PHRASE_BODY));
    expect(verdict.reasons).toEqual([]);
    expect(verdict.phraseOnly).toBe(true);
    expect(verdict.assertions).toBe(4);
  });

  it("rejects a file that imports code under test from src/", () => {
    const verdict = classifyTestSource(
      UNIT_TEST,
      source(PHRASE_BODY, `${HEADER}\nimport { run } from "../../src/run.js";`),
      reader({ "src/run.ts": "export const run = 1;" })
    );
    expect(verdict.phraseOnly).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("../../src/run.js");
  });

  it("accepts a relative helper inside tests/ that itself only reads text", () => {
    const helper = [
      'import { readFileSync } from "node:fs";',
      'import path from "node:path";',
      "export const read = (rel: string): string =>",
      '  readFileSync(path.resolve(rel), "utf8");',
    ].join("\n");
    const verdict = classifyTestSource(
      UNIT_TEST,
      source(
        'describe("a", () => { it("b", () => { expect(read("x.md")).toContain("y"); }); });',
        `${HEADER}\nimport { read } from "./helpers.js";`
      ),
      reader({ "tests/unit/helpers.ts": helper })
    );
    expect(verdict.reasons).toEqual([]);
    expect(verdict.phraseOnly).toBe(true);
    expect(verdict.helpers).toEqual(["tests/unit/helpers.ts"]);
  });

  it("rejects a helper that itself imports from scripts/, transitively", () => {
    const inner =
      'import { x } from "../../scripts/x.mjs";\nexport const y = x;';
    const outer = 'export { y } from "./inner.js";\nimport "./inner.js";';
    const verdict = classifyTestSource(
      UNIT_TEST,
      source(
        'describe("a", () => { it("b", () => { expect("t").toContain("y"); }); });',
        `${HEADER}\nimport "./outer.js";`
      ),
      reader({
        "tests/unit/outer.ts": outer,
        "tests/unit/inner.ts": inner,
        "scripts/x.mjs": "export const x = 1;",
      })
    );
    expect(verdict.phraseOnly).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("../../scripts/x.mjs");
  });

  it("rejects a relative import that resolves outside tests/ or cannot be read", () => {
    const verdict = classifyTestSource(
      UNIT_TEST,
      source(PHRASE_BODY, `${HEADER}\nimport { a } from "./missing.js";`),
      reader({})
    );
    expect(verdict.phraseOnly).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("./missing.js");
  });

  it.each([
    ["spawning a process", 'import { execSync } from "node:child_process";'],
    ["writing a file", 'import { writeFileSync } from "node:fs";'],
    ["mocking", 'import { vi } from "vitest";'],
  ])("rejects %s", (_label, extra) => {
    const verdict = classifyTestSource(
      TOP_TEST,
      source(PHRASE_BODY, `${HEADER}\n${extra}`)
    );
    expect(verdict.phraseOnly).toBe(false);
  });

  it("rejects process access other than process.cwd()", () => {
    const verdict = classifyTestSource(
      TOP_TEST,
      source(`${PHRASE_BODY}\nconst e = process.env.X;`)
    );
    expect(verdict.reasons).toContain("process.env");
  });

  it("rejects a file with a non-phrase assertion", () => {
    const verdict = classifyTestSource(
      TOP_TEST,
      source(`${PHRASE_BODY}\nit("n", () => { expect(1).toEqual(1); });`)
    );
    expect(verdict.phraseOnly).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("non-phrase");
  });

  it("rejects a file with no assertions at all", () => {
    const verdict = classifyTestSource(TOP_TEST, source(""));
    expect(verdict.reasons).toContain("no assertions");
  });
});

describe("resolveTestImport", () => {
  const exists = (file: string): boolean =>
    [HELPER_TS, "tests/unit/dir/index.ts", "src/a.ts"].includes(file);

  it.each([
    ["./h.js", HELPER_TS],
    ["./h", HELPER_TS],
    ["./dir", "tests/unit/dir/index.ts"],
  ])("resolves %s to %s", (specifier, expected) => {
    expect(resolveTestImport(UNIT_TEST, specifier, exists)).toBe(expected);
  });

  it("refuses a target outside tests/", () => {
    expect(
      resolveTestImport(UNIT_TEST, "../../src/a.js", exists)
    ).toBeUndefined();
  });
});
