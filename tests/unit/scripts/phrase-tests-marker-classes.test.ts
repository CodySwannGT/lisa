/**
 * The phrase classes (CodySwannGT/lisa#4867) decide which Markdown phrase
 * assertions survive: a MACHINE-TOKEN a shipped parser reads, or a
 * STRUCTURAL frontmatter line. Everything else is WORDING and is culled, so
 * every doubt must resolve to WORDING, and every token row must stay tied to
 * the code that justifies it.
 * @module tests/unit/scripts/phrase-tests-marker-classes
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MARKER_CLASSES,
  classifyPhrase,
  literalOf,
  needlesOf,
} from "../../../scripts/lib/phrase-tests/marker-classes.mjs";
import {
  classifyDesignSource,
  DESIGN_SOURCE_NONE_MARKER,
} from "../../../plugins/src/base/scripts/design-source-gate.mjs";

const WORK_ITEM_CLI = "all/copy-overwrite/scripts/lisa-work-item.mjs";
const MACHINE_TOKEN = "MACHINE-TOKEN";
const NONE_RULE = "design-source-none";
const FIGMA_RULE = "design-source-figma";
const FIGMA_URL = "https://www.figma.com/design/abc/x?node-id=1";
const DESIGN_SOURCE_GATE = "plugins/src/base/scripts/design-source-gate.mjs";

describe("MARKER_CLASSES", () => {
  it.each(
    MARKER_CLASSES.flatMap(row =>
      row.parser.flatMap(file =>
        needlesOf(row).map(needle => [row.id, file, needle] as const)
      )
    )
  )("%s: parser %s still spells %j", (id, file, needle) => {
    const absolute = path.resolve(file);
    expect(existsSync(absolute), `${file} is gone`).toBe(true);
    expect(
      readFileSync(absolute, "utf8").includes(needle),
      `${file} no longer contains ${JSON.stringify(needle)}; the ${id} row has lost its parser`
    ).toBe(true);
  });

  it("uses needles specific enough that losing one means the parser changed", () => {
    const vague = MARKER_CLASSES.flatMap(row =>
      needlesOf(row)
        .filter(needle => needle.length < 8)
        .map(needle => `${row.id}: ${JSON.stringify(needle)}`)
    );
    expect(vague).toEqual([]);
  });

  it("ties the npm filing row to both markers it accepts", () => {
    const row = MARKER_CLASSES.find(
      candidate => candidate.id === "lisa-npm-filing"
    );
    const needles = row ? needlesOf(row).join(" ") : "";
    expect(needles).toContain("[lisa-npm-filing]");
    expect(needles).toContain("[lisa-npm-proposal]");
  });

  it("has unique ids", () => {
    const ids = MARKER_CLASSES.map(row => row.id);
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
      cls: MACHINE_TOKEN,
      rule: "lisa-pr-link",
      parser: [WORK_ITEM_CLI],
    });
    expect(classifyPhrase("## Lisa Usage").cls).toBe(MACHINE_TOKEN);
    expect(classifyPhrase("Work-Item:").rule).toBe("work-item-trailer");
    expect(
      classifyPhrase("[EVIDENCE: cli-output: marker-count-one]").rule
    ).toBe("local-evidence-claim");
    expect(
      classifyPhrase("<!-- [lisa-human-gate] reason=needs-a-person -->").rule
    ).toBe("lisa-human-gate");
  });

  it("classifies the DESIGN-SOURCE annotations the gate parses", () => {
    for (const [phrase, rule] of [
      [DESIGN_SOURCE_NONE_MARKER, NONE_RULE],
      [`${DESIGN_SOURCE_NONE_MARKER} — legacy screen`, NONE_RULE],
      [`<!-- ${DESIGN_SOURCE_NONE_MARKER} -->`, NONE_RULE],
      ["DESIGN-SOURCE: <figma-url>", FIGMA_RULE],
      [`DESIGN-SOURCE: ${FIGMA_URL}`, FIGMA_RULE],
      ["DESIGN-SOURCE:", FIGMA_RULE],
    ] as const) {
      expect(classifyPhrase(phrase), phrase).toEqual({
        cls: MACHINE_TOKEN,
        rule,
        parser: [DESIGN_SOURCE_GATE],
      });
    }
    for (const sentence of [
      "Annotate DESIGN-SOURCE: none when not in Figma",
      `Annotate the file with ${DESIGN_SOURCE_NONE_MARKER}`,
      `Point at DESIGN-SOURCE: ${FIGMA_URL}`,
      "DESIGN-SOURCE: <figma-url> on every screen",
    ]) {
      expect(classifyPhrase(sentence).cls, sentence).toBe("WORDING");
    }
  });

  it("matches DESIGN-SOURCE spellings the gate itself accepts", () => {
    const status = (line: string): string =>
      classifyDesignSource({ path: "src/App.tsx", content: `// ${line}\n` })
        .status;
    expect(status(DESIGN_SOURCE_NONE_MARKER)).toBe("marked-exception");
    expect(status(`DESIGN-SOURCE: ${FIGMA_URL}`)).toBe("figma-source");
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
