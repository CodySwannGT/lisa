/**
 * One way to write a JSON value: object keys in code-unit order at every
 * depth, whatever the keys look like.
 *
 * A JavaScript object lists keys that look like array indexes first, in
 * numeric order, whatever order they were put in. Text written from such an
 * object by the language's own writer is therefore not in code-unit order
 * when a key is `"9"` and another is `"10"`. The canonical text does not
 * depend on that: it is written key by key.
 */
import { describe, expect, it } from "vitest";

import {
  canonicalFileText,
  canonicalText,
  compareCodeUnits,
} from "../../../src/controls/canonical-json.js";

/** A value with nothing unusual about its keys. */
const ORDINARY = {
  schema_version: 1,
  records: [
    { id: "b", empty: {}, none: [], nested: { z: null, a: [1, "two", false] } },
    { id: "a", text: 'quoted "word" and a\nline', number: -1.5e-7 },
  ],
  Zebra: true,
  apple: "é",
};

describe("the canonical text of a JSON value", () => {
  it("orders keys that look like array indexes by code unit, like any other key", () => {
    expect(canonicalText({ b: 1, "10": 2, "9": 3, a: 4 })).toBe(
      '{"10":2,"9":3,"a":4,"b":1}'
    );
  });

  it("does so at every depth, inside lists too", () => {
    expect(
      canonicalText({ outer: [{ "2": "two", "11": "eleven", "1": "one" }] })
    ).toBe('{"outer":[{"1":"one","11":"eleven","2":"two"}]}');
  });

  it("gives the same text however the value was built", () => {
    const one = { "10": { y: 1, x: 2 }, "9": [3], a: null };
    const other = { a: null, "9": [3], "10": { x: 2, y: 1 } };

    expect(canonicalText(one)).toBe(canonicalText(other));
  });

  it("keeps a list in its own order", () => {
    expect(canonicalText([3, 1, 2])).toBe("[3,1,2]");
  });

  it("orders capitals before small letters, as code units do", () => {
    expect(canonicalText({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
    expect(compareCodeUnits("B", "a")).toBeLessThan(0);
  });

  it("is what the language's own writer gives for a value with ordinary keys in order", () => {
    const sorted = {
      Zebra: true,
      apple: "é",
      records: [
        {
          empty: {},
          id: "b",
          nested: { a: [1, "two", false], z: null },
          none: [],
        },
        { id: "a", number: -1.5e-7, text: 'quoted "word" and a\nline' },
      ],
      schema_version: 1,
    };

    expect(canonicalText(ORDINARY)).toBe(JSON.stringify(sorted));
    expect(canonicalFileText(ORDINARY)).toBe(
      `${JSON.stringify(sorted, null, 2)}\n`
    );
  });

  it("leaves out a member that has no value, as the language's own writer does", () => {
    expect(canonicalText({ kept: 1, dropped: undefined })).toBe('{"kept":1}');
    expect(canonicalText([undefined])).toBe("[null]");
  });

  it("tells a missing value from null", () => {
    expect(canonicalText(undefined)).not.toBe(canonicalText(null));
  });
});

describe("the text of a generated file", () => {
  it("is indented by two spaces, ends with one line end, and orders index-like keys by code unit", () => {
    expect(
      canonicalFileText({ "9": [1], "10": {}, a: { "2": 0, "11": 0 } })
    ).toBe(
      [
        "{",
        '  "10": {},',
        '  "9": [',
        "    1",
        "  ],",
        '  "a": {',
        '    "11": 0,',
        '    "2": 0',
        "  }",
        "}",
        "",
      ].join("\n")
    );
  });
});
