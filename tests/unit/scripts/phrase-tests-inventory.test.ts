/**
 * The Markdown phrase inventory (CodySwannGT/lisa#4867): classifying every
 * required-phrases manifest entry, pruning the WORDING ones, and finding the
 * phrase assertions in test files that read Markdown. The assertion finder
 * must tell document text from script output, because a test that runs a
 * document's shell block and checks its stdout is a behaviour test that must
 * survive the cull.
 * @module tests/unit/scripts/phrase-tests-inventory
 */
import { describe, expect, it } from "vitest";

import {
  classifyAssertions,
  classifyCheck,
  classifyManifest,
  countBySource,
  phraseParts,
  pruneManifest,
} from "../../../scripts/lib/phrase-tests/inventory.mjs";
import {
  expectChains,
  parseSource,
} from "../../../scripts/lib/phrase-tests/ast.mjs";

const SKILL = "plugins/src/base/skills/x/SKILL.md";
const HOOK = "plugins/src/base/hooks/x.sh";
const TEST_FILE = "tests/unit/strategies/x.test.ts";
const PR_LINK = "[lisa-pr-link]";
const MACHINE_TOKEN = "MACHINE-TOKEN";

const manifest = {
  $comment: ["old"],
  files: {
    [SKILL]: {
      required: ["Never guess", PR_LINK],
      forbidden: ["TODO"],
      requiredPatterns: [{ source: "^---", flags: "" }],
      forbiddenPatterns: [{ source: "cannot\\s+verify", flags: "i" }],
      source: ["tests/old.test.ts › a > b"],
    },
    "plugins/src/base/rules/y.md": {
      required: ["only wording here"],
      forbidden: [],
      requiredPatterns: [],
      forbiddenPatterns: [],
      source: ["tests/old.test.ts › c > d"],
    },
    [HOOK]: {
      required: ["exit 2"],
      forbidden: [],
      requiredPatterns: [],
      forbiddenPatterns: [],
      source: ["tests/old.test.ts › e > f"],
    },
  },
};

describe("classifyCheck", () => {
  it("leaves a phrase pinned in a non-Markdown file out of scope", () => {
    expect(
      classifyCheck({
        file: HOOK,
        polarity: "required",
        kind: "string",
        value: "exit 2",
      }).cls
    ).toBe("NOT-MARKDOWN");
  });

  it("classifies a Markdown phrase by its token class", () => {
    expect(
      classifyCheck({
        file: SKILL,
        polarity: "required",
        kind: "pattern",
        value: { source: "\\[lisa-pr-link\\]", flags: "" },
      }).cls
    ).toBe(MACHINE_TOKEN);
  });
});

describe("classifyManifest", () => {
  it("counts every entry by class", () => {
    const report = classifyManifest(manifest);
    expect(report.files).toBe(3);
    expect(report.entries).toBe(7);
    expect(report.counts).toEqual({
      "MACHINE-TOKEN": 1,
      STRUCTURAL: 1,
      WORDING: 4,
      UNRESOLVED: 0,
      "NOT-MARKDOWN": 1,
    });
  });
});

describe("pruneManifest", () => {
  const { manifest: pruned, sourceGuards } = pruneManifest(manifest);

  it("keeps only MACHINE-TOKEN and STRUCTURAL phrases in the manifest", () => {
    expect(pruned.files[SKILL]).toEqual({
      required: [PR_LINK],
      forbidden: [],
      requiredPatterns: [{ source: "^---", flags: "" }],
      forbiddenPatterns: [],
      source: ["tests/old.test.ts › a > b"],
    });
    expect(Object.keys(pruned.files)).toEqual([SKILL]);
  });

  it("moves non-Markdown guards to the source-text guards", () => {
    expect(Object.keys(sourceGuards.files)).toEqual([HOOK]);
    expect(sourceGuards.files[HOOK]?.required).toEqual(["exit 2"]);
    expect(sourceGuards.$comment.join(" ")).toContain("NOT Markdown");
  });

  it("drops WORDING from both and explains the policy", () => {
    expect(pruned.$comment.join(" ")).toContain("classify-phrase-tests.mjs");
    expect(classifyManifest(pruned).counts).toMatchObject({
      WORDING: 0,
      "NOT-MARKDOWN": 0,
    });
    expect(classifyManifest(sourceGuards).counts.WORDING).toBe(0);
  });

  it("is a no-op when run again on its own output", () => {
    const again = pruneManifest(pruned, sourceGuards);
    expect(again.manifest).toEqual(pruned);
    expect(again.sourceGuards).toEqual(sourceGuards);
    expect(Object.keys(again.sourceGuards.files)).toEqual([HOOK]);
  });

  it("merges newly found guards into the existing file instead of replacing it", () => {
    const other = "plugins/src/base/hooks/other.sh";
    const { sourceGuards: merged } = pruneManifest(
      {
        $comment: [],
        files: {
          [HOOK]: {
            required: ["exit 2", "set -e"],
            forbidden: [],
            requiredPatterns: [],
            forbiddenPatterns: [],
            source: [],
          },
          [other]: {
            required: ["trap"],
            forbidden: [],
            requiredPatterns: [],
            forbiddenPatterns: [],
            source: [],
          },
        },
      },
      sourceGuards
    );
    expect(Object.keys(merged.files)).toEqual([other, HOOK]);
    expect(merged.files[HOOK]?.required).toEqual(["exit 2", "set -e"]);
    expect(merged.files[HOOK]?.source).toEqual(["tests/old.test.ts › e > f"]);
  });
});

const HEADER = [
  'import { readFileSync } from "node:fs";',
  'import { spawnSync } from "node:child_process";',
  'import path from "node:path";',
  'import { describe, expect, it } from "vitest";',
  'import { runThing } from "../../../scripts/thing.mjs";',
].join("\n");

/**
 * Classify the assertions of a synthetic test file.
 * @param body - Statements after the imports
 * @returns The verdicts, reduced to the fields these tests read
 */
const sites = (body: string) =>
  classifyAssertions(TEST_FILE, `${HEADER}\n${body}`).map(site => ({
    line: site.line,
    matcher: site.matcher,
    source: site.source,
    cls: site.cls,
    value: site.value,
  }));

describe("classifyAssertions", () => {
  it("ignores a test file that reads no Markdown", () => {
    expect(
      sites(
        'const text = readFileSync("package.json", "utf8");\nexpect(text).toContain("x");'
      )
    ).toEqual([]);
  });

  it("classifies each phrase assertion on a document, with its line", () => {
    expect(
      sites(
        [
          `const doc = readFileSync("${SKILL}", "utf8");`,
          `expect(doc).toContain("${PR_LINK}");`,
          "expect(doc).toMatch(/never guess/i);",
          'expect(doc).not.toContain("TODO");',
          'expect(doc.includes("x")).toBe(false);',
        ].join("\n")
      )
    ).toEqual([
      {
        line: 7,
        matcher: "toContain",
        source: "markdown",
        cls: MACHINE_TOKEN,
        value: PR_LINK,
      },
      {
        line: 8,
        matcher: "toMatch",
        source: "markdown",
        cls: "WORDING",
        value: { source: "never guess", flags: "i" },
      },
      {
        line: 9,
        matcher: "not.toContain",
        source: "markdown",
        cls: "WORDING",
        value: "TODO",
      },
      {
        line: 10,
        matcher: "not.includes",
        source: "markdown",
        cls: "WORDING",
        value: "x",
      },
    ]);
  });

  it("resolves a constant argument and flags a computed one", () => {
    const found = sites(
      [
        `const doc = readFileSync("${SKILL}", "utf8");`,
        'const MARKER = "## Lisa Usage";',
        "expect(doc).toContain(MARKER);",
        "expect(doc).toContain(`${MARKER}!`);",
      ].join("\n")
    );
    expect(found.map(site => site.cls)).toEqual([MACHINE_TOKEN, "UNRESOLVED"]);
  });

  it("refuses to resolve a constant name declared more than once", () => {
    const found = sites(
      [
        `const doc = readFileSync("${SKILL}", "utf8");`,
        'describe("a", () => { const MARKER = "## Lisa Usage"; it("x", () => expect(doc).toContain(MARKER)); });',
        'describe("b", () => { const MARKER = "Never guess"; it("y", () => expect(doc).toContain(MARKER)); });',
      ].join("\n")
    );
    expect(found.map(site => site.cls)).toEqual(["UNRESOLVED", "UNRESOLVED"]);
  });

  it("leaves an includes() check UNRESOLVED when toBe gets no boolean literal", () => {
    const source = parseSource(
      TEST_FILE,
      'const expected = true;\nexpect(doc.includes("x")).toBe(expected);'
    );
    const [chain] = expectChains(source);
    expect(chain).toBeDefined();
    expect(phraseParts(chain!).argument).toBeUndefined();
    const literal = expectChains(
      parseSource(TEST_FILE, 'expect(doc.includes("x")).toBe(false);')
    )[0];
    expect(phraseParts(literal!)).toMatchObject({
      negated: true,
      matcher: "includes",
    });
  });

  it("follows a reader helper and an assertion helper to the document", () => {
    const found = sites(
      [
        'const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"];',
        "const readSkill = (root: string, slug: string): string =>",
        '  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");',
        "const expectGate = (section: string): void => {",
        "  expect(section).toMatch(/arm gate/);",
        "};",
        'describe.each(ROOTS)("%s", root => {',
        '  const content = readSkill(root, "lisa-drive");',
        '  it("x", () => { expectGate(content.slice(0, 10)); });',
        "});",
      ].join("\n")
    );
    expect(found.map(site => site.source)).toEqual(["markdown"]);
  });

  it("does not count the output of a document's block run as document text", () => {
    const found = sites(
      [
        `const doc = readFileSync("${SKILL}", "utf8");`,
        "const block = doc.slice(0, 10);",
        'const result = spawnSync("bash", ["-c", block], { encoding: "utf8" });',
        'expect(result.stdout).toContain("stop.");',
        'expect(block).toContain("set -e");',
      ].join("\n")
    );
    expect(found.map(site => site.source)).toEqual(["other", "markdown"]);
  });

  it("does not count Markdown a script writes outside the document roots", () => {
    const found = sites(
      [
        `const doc = readFileSync("${SKILL}", "utf8");`,
        'const summaryFile = path.join("/tmp/run", "summary.md");',
        'const summary = readFileSync(summaryFile, "utf8");',
        'expect(summary).toContain("Nothing new was deployed");',
      ].join("\n")
    );
    expect(found.map(site => site.source)).toEqual(["other"]);
  });

  it("marks text from imported code as unknown, never as other", () => {
    const found = sites(
      [
        `const doc = readFileSync("${SKILL}", "utf8");`,
        'expect(runThing("x")).toContain("y");',
      ].join("\n")
    );
    expect(found.map(site => site.source)).toEqual(["unknown"]);
    expect(countBySource(found)).toEqual({ markdown: 0, other: 0, unknown: 1 });
  });
});
