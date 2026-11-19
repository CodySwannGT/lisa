/**
 * The pointwise three-way merge for Lisa's JSON generated artifacts
 * (CodySwannGT/lisa#4929).
 *
 * The manifest and the hash ledger moved from TypeScript modules to JSON data
 * so they need no lint waiver. JSON has no trailing commas, so a line-level
 * merge that appends after the last entry would write an invalid file; the
 * driver therefore merges a parsed model and re-renders it. These cases pin
 * that the semantics did not change in the move: disjoint additions merge,
 * append-only lists union, a removal or a contested scalar conflicts unless the
 * artifact resolves derived entries, and every merged file is valid JSON in
 * the generators' exact format. Expected values are hardcoded.
 * @module tests/unit/scripts/merge-generated-json
 */
import { describe, expect, it } from "vitest";

import {
  formatGeneratedJson,
  isJsonArtifact,
  mergeJsonArtifact,
  parseJsonArtifact,
  renderJsonArtifact,
} from "../../../scripts/lib/merge-generated-json.mjs";

/**
 * Render a document the way both generators do.
 * @param document - Records to render
 * @returns JSON text, newline-terminated
 */
const render = (document: unknown): string => formatGeneratedJson(document);

describe("mergeJsonArtifact", () => {
  it("merges entries each side added on its own, sorted, as valid JSON", () => {
    const base = render({ A: { m: "0" } });
    const ours = render({ A: { a: "1", m: "0" } });
    const theirs = render({ A: { m: "0", z: "2" } });

    const result = mergeJsonArtifact(base, ours, theirs, false);

    expect(result).toEqual({
      ok: true,
      text: render({ A: { a: "1", m: "0", z: "2" } }),
      resolved: [],
    });
  });

  it("unions append-only lists that both sides grew", () => {
    const result = mergeJsonArtifact(
      render({ L: { d: ["aa"] } }),
      render({ L: { d: ["aa", "e1"] } }),
      render({ L: { d: ["aa", "f1"] } }),
      false
    );

    expect(result).toEqual({
      ok: true,
      text: render({ L: { d: ["aa", "e1", "f1"] } }),
      resolved: [],
    });
  });

  it("conflicts when a side removed a list element instead of appending", () => {
    const result = mergeJsonArtifact(
      render({ L: { d: ["aa"] } }),
      render({ L: { d: ["e1"] } }),
      render({ L: { d: ["aa", "f1"] } }),
      false
    );

    expect(result).toEqual({
      ok: false,
      reason: "both sides changed the entry for d in incompatible ways",
    });
  });

  it("conflicts on a contested scalar in a strict artifact", () => {
    const result = mergeJsonArtifact(
      render({ A: { p: "0" } }),
      render({ A: { p: "1" } }),
      render({ A: { p: "2" } }),
      false
    );

    expect(result.ok).toBe(false);
  });

  it("takes our side of a contested scalar in a resolving artifact, and says so", () => {
    const result = mergeJsonArtifact(
      render({ A: { p: "0" } }),
      render({ A: { p: "1" } }),
      render({ A: { p: "2" } }),
      true
    );

    expect(result).toEqual({
      ok: true,
      text: render({ A: { p: "1" } }),
      resolved: ["p"],
    });
  });

  it("still conflicts when one side deleted what the other changed", () => {
    const result = mergeJsonArtifact(
      render({ A: { p: "0" } }),
      render({ A: { p: "1" } }),
      render({ A: {} }),
      true
    );

    expect(result.ok).toBe(false);
  });

  it("refuses two sides with different records", () => {
    const result = mergeJsonArtifact(
      "",
      render({ A: {} }),
      render({ B: {} }),
      false
    );

    expect(result).toEqual({
      ok: false,
      reason: "the two sides have different block structures",
    });
  });

  it("names the side that is not valid JSON", () => {
    const result = mergeJsonArtifact("", render({ A: {} }), "{oops", false);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/^theirs: not valid JSON/u);
  });
});

describe("parseJsonArtifact", () => {
  it("refuses a top-level scalar", () => {
    expect(parseJsonArtifact(render({ count: 3, A: {} }))).toEqual({
      ok: false,
      reason: "top-level value count is not a record of entries",
    });
  });

  it("refuses a nested entry", () => {
    expect(parseJsonArtifact(render({ A: { p: { q: 1 } } }))).toEqual({
      ok: false,
      reason: "entry A.p is nested, not a scalar or a list of scalars",
    });
  });

  it("round-trips the generators' format exactly", () => {
    const text = render({ A: { a: "1", b: ["x"] }, B: { c: true } });
    const parsed = parseJsonArtifact(text);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(renderJsonArtifact(parsed.records)).toBe(text);
  });
});

describe("isJsonArtifact", () => {
  it("tells a JSON artifact from a TypeScript module", () => {
    expect(isJsonArtifact('\n{"A": {}}')).toBe(true);
    expect(isJsonArtifact("export const A = Object.freeze({});")).toBe(false);
  });
});

describe("formatGeneratedJson", () => {
  const document = {
    MANIFEST: {
      "docs/readme.md": "digest-a",
      'path/with "quote".md': "abc",
    },
    SURFACE: { "src/a.ts": true },
    LEDGER: { "src/b.ts": ["h1", "h2"] },
  };

  it("puts a string value on its own line under its key", () => {
    expect(formatGeneratedJson(document)).toBe(
      [
        "{",
        '  "MANIFEST": {',
        '    "docs/readme.md":',
        '      "digest-a",',
        '    "path/with \\"quote\\".md":',
        '      "abc"',
        "  },",
        '  "SURFACE": {',
        '    "src/a.ts": true',
        "  },",
        '  "LEDGER": {',
        '    "src/b.ts": [',
        '      "h1",',
        '      "h2"',
        "    ]",
        "  }",
        "}",
        "",
      ].join("\n")
    );
  });

  it("stays plain JSON that parses back to the same document", () => {
    expect(JSON.parse(formatGeneratedJson(document))).toEqual(document);
  });
});
