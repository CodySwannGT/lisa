/**
 * The Markdown-assertion classifier (CodySwannGT/lisa#4867): which pinned
 * phrases are STRUCTURAL, MACHINE-TOKEN or WORDING.
 * @module tests/unit/scripts/markdown-assertions-classify
 */
import { describe, expect, it } from "vitest";

import { classifyCheck } from "../../../scripts/lib/markdown-assertions/classify.mjs";
import {
  isCodePath,
  searchableText,
} from "../../../scripts/lib/markdown-assertions/corpus.mjs";
import {
  patternLiteral,
  tokenCandidates,
} from "../../../scripts/lib/markdown-assertions/tokens.mjs";

const DOC = "plugins/src/base/skills/example/SKILL.md";
const DOC_TEXT = "---\nname: example\ndescription: An example.\n---\n\nBody.\n";

/**
 * A classifier context over a fake code corpus.
 * @param code - The only code file's literal text.
 * @param declared - Names that file declares.
 * @returns The context.
 */
function context(code: string, declared: readonly string[] = []) {
  return {
    root: "/nonexistent-root",
    names: new Set(["lisa-tracker-write", "lisa:intake"]),
    corpus: {
      find: (needle: string): string | undefined =>
        code.includes(needle) ? "scripts/parser.mjs" : undefined,
      count: (needle: string): number => (code.includes(needle) ? 1 : 0),
      declares: (name: string): string | undefined =>
        declared.includes(name) ? "src/api.ts" : undefined,
      files: 1,
    },
    readText: (file: string): string | undefined =>
      file === DOC ? DOC_TEXT : undefined,
  };
}

describe("tokenCandidates", () => {
  it("finds markers, trailers, identifiers and flags", () => {
    expect(tokenCandidates("[lisa-human-gate] marker")).toContain(
      "[lisa-human-gate"
    );
    expect(tokenCandidates("<!-- lisa:review-substitute -->")).toContain(
      "<!-- lisa:review-substitute"
    );
    expect(tokenCandidates("Work-Item: owner/repo#1")).toContain("Work-Item:");
    expect(tokenCandidates("set REVIEW_REQUIRED and --dry-run")).toEqual(
      expect.arrayContaining(["REVIEW_REQUIRED", "--dry-run"])
    );
  });

  it("finds nothing in plain prose, kebab-case words or emphasis capitals", () => {
    expect(
      tokenCandidates('NEVER re-request a review to "refresh" it')
    ).toStrictEqual([]);
  });
});

describe("patternLiteral", () => {
  it("unescapes, folds case classes and breaks on regex syntax", () => {
    expect(patternLiteral(String.raw`\[lisa-human-gate\]`)).toBe(
      "[lisa-human-gate]"
    );
    expect(patternLiteral("[Ee]scalate now")).toBe("Escalate now");
    expect(patternLiteral(String.raw`a\s+b.*c|d`)).toBe("a b\nc\nd");
  });
});

describe("corpus", () => {
  it("keeps shipped code and drops tests, generated copies and prose", () => {
    expect(isCodePath("scripts/lisa-work-item.mjs")).toBe(true);
    expect(isCodePath("plugins/src/base/hooks/guard.sh")).toBe(true);
    expect(isCodePath("tests/unit/x.test.ts")).toBe(false);
    expect(isCodePath("plugins/lisa/hooks/guard.sh")).toBe(false);
    expect(isCodePath("plugins/src/base/skills/x/SKILL.md")).toBe(false);
  });

  it("reads only literals from scripts, not comments", () => {
    const text = searchableText(
      "a.mjs",
      '// "[commented-marker]"\nconst m = "[lisa-human-gate]";\nconst r = /\\[x-y\\]/u;\n'
    );
    expect(text).toContain("[lisa-human-gate]");
    expect(text).toContain("[x-y]");
    expect(text).not.toContain("commented-marker");
  });
});

describe("classifyCheck", () => {
  const check = (
    value: string,
    polarity: "required" | "forbidden" = "required"
  ) => ({ file: DOC, polarity, kind: "string", value }) as const;

  it("is STRUCTURAL for a frontmatter key", () => {
    expect(classifyCheck(check("name: example"), context("")).class).toBe(
      "STRUCTURAL"
    );
  });

  it("is STRUCTURAL for a reference to a skill that exists", () => {
    expect(
      classifyCheck(check("`/lisa-tracker-write`"), context("")).class
    ).toBe("STRUCTURAL");
  });

  it("is STRUCTURAL for a forbidden reference to something that does not exist", () => {
    expect(
      classifyCheck(check("/lisa-removed-skill", "forbidden"), context(""))
        .class
    ).toBe("STRUCTURAL");
  });

  it("is MACHINE-TOKEN, naming the parser, when code reads a token in it", () => {
    const verdict = classifyCheck(
      check("Post the [lisa-human-gate] marker first"),
      context("const MARKER = '[lisa-human-gate]';")
    );
    expect(verdict).toMatchObject({
      class: "MACHINE-TOKEN",
      parser: "scripts/parser.mjs",
    });
  });

  it("is WORDING for prose no code reads", () => {
    expect(
      classifyCheck(
        check("Never re-request a review to refresh it"),
        context("unrelated")
      ).class
    ).toBe("WORDING");
  });

  it("is WORDING for a token-shaped phrase no code reads", () => {
    expect(
      classifyCheck(check("[lisa-unparsed-marker]"), context("other")).class
    ).toBe("WORDING");
  });

  it("is STRUCTURAL when it names an identifier shipped code declares", () => {
    expect(
      classifyCheck(
        check("call parseLearningsFile first"),
        context("", ["parseLearningsFile"])
      )
    ).toMatchObject({ class: "STRUCTURAL", parser: "src/api.ts" });
  });
});
