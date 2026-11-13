/**
 * The phrase classes (CodySwannGT/lisa#4867) decide which Markdown phrase
 * assertions survive: a MACHINE-TOKEN a shipped parser reads, or a
 * STRUCTURAL frontmatter line. Everything else is WORDING and is culled, so
 * every doubt must resolve to WORDING, and every token row must stay tied to
 * the code that justifies it.
 * @module tests/unit/scripts/phrase-tests-token-classes
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TOKEN_CLASSES,
  classifyPhrase,
  literalOf,
} from "../../../scripts/lib/phrase-tests/token-classes.mjs";

const WORK_ITEM_CLI = "all/copy-overwrite/scripts/lisa-work-item.mjs";

describe("TOKEN_CLASSES", () => {
  it.each(TOKEN_CLASSES.flatMap(row => row.parser.map(file => [row.id, file])))(
    "%s: parser %s exists and still spells the token",
    (id, file) => {
      const row = TOKEN_CLASSES.find(candidate => candidate.id === id);
      const absolute = path.resolve(file);
      expect(existsSync(absolute), `${file} is gone`).toBe(true);
      expect(
        readFileSync(absolute, "utf8").includes(row?.needle ?? "\u0000"),
        `${file} no longer contains ${JSON.stringify(row?.needle)}; the ${id} row has lost its parser`
      ).toBe(true);
    }
  );

  it("has unique ids", () => {
    const ids = TOKEN_CLASSES.map(row => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("literalOf", () => {
  it("unescapes punctuation and drops anchors", () => {
    expect(literalOf(String.raw`\[lisa-pr-link\]`)).toBe("[lisa-pr-link]");
    expect(literalOf("^## Lisa Usage$")).toBe("## Lisa Usage");
  });

  it("refuses a source with real regex syntax", () => {
    expect(literalOf("never.guess")).toBeUndefined();
    expect(literalOf(String.raw`never\s+guess`)).toBeUndefined();
    expect(literalOf("a|b")).toBeUndefined();
    expect(literalOf("trailing\\")).toBeUndefined();
  });
});

describe("classifyPhrase", () => {
  it("names the parser for a bare machine token", () => {
    expect(classifyPhrase("[lisa-pr-link]")).toEqual({
      cls: "MACHINE-TOKEN",
      rule: "lisa-pr-link",
      parser: [WORK_ITEM_CLI],
    });
    expect(classifyPhrase("## Lisa Usage").cls).toBe("MACHINE-TOKEN");
    expect(classifyPhrase("Work-Item:").rule).toBe("work-item-trailer");
    expect(
      classifyPhrase("[EVIDENCE: cli-output: marker-count-one]").rule
    ).toBe("local-evidence-claim");
    expect(
      classifyPhrase("<!-- [lisa-human-gate] reason=needs-a-person -->").rule
    ).toBe("lisa-human-gate");
  });

  it("treats a sentence that merely mentions a token as WORDING", () => {
    expect(classifyPhrase("Post the [lisa-pr-link] comment first").cls).toBe(
      "WORDING"
    );
    expect(classifyPhrase("## Lisa Usage section").cls).toBe("WORDING");
  });

  it("treats a marker no shipped code parses as WORDING", () => {
    for (const marker of [
      "[lisa-ledger-saturated]",
      "[lisa-gardener]",
      "[lisa-rejection-candidate]",
      "[lisa-project-ideation]",
      "[EVIDENCE-REF: lisa#1 | cli-output: x]",
    ]) {
      expect(classifyPhrase(marker).cls, marker).toBe("WORDING");
    }
  });

  it("reduces an escaped regex to its literal before matching", () => {
    expect(
      classifyPhrase(String.raw`\[lisa-pr-link\]`, { isPattern: true }).rule
    ).toBe("lisa-pr-link");
  });

  it("classifies frontmatter shape as STRUCTURAL and its prose as WORDING", () => {
    expect(classifyPhrase("^---", { isPattern: true }).cls).toBe("STRUCTURAL");
    expect(
      classifyPhrase(String.raw`^description:\s*\S+`, { isPattern: true }).rule
    ).toBe("frontmatter-key");
    expect(classifyPhrase("argument-hint:").cls).toBe("STRUCTURAL");
    expect(classifyPhrase("name: lisa-implement").cls).toBe("STRUCTURAL");
    expect(classifyPhrase("description: Use when shipping a fix").cls).toBe(
      "WORDING"
    );
  });

  it("reports why prose is WORDING", () => {
    expect(classifyPhrase("Never guess")).toEqual({
      cls: "WORDING",
      rule: "prose",
      parser: [],
    });
    expect(
      classifyPhrase(String.raw`never\s+guess`, { isPattern: true }).rule
    ).toBe("regex-prose");
  });
});
