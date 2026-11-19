/**
 * Writing down, in `.lisa.config.json`, that a coding agent cannot enforce
 * the moment after a file write.
 *
 * That file is written by people. These cases hold that the record is added
 * in place: nothing else in the file moves, what is written passes the gate
 * registry's own validation, and a second pass changes nothing
 * (CodySwannGT/lisa#4990).
 */
import { describe, expect, it } from "vitest";

import {
  recordUnenforceable,
  type GapRecord,
} from "../../../src/controls/carrier-unenforceable.js";
import { shippedGates } from "../../helpers/control-register.js";

const AGY = ["agy"] as const;

/** The line that opens the gates block in a two-space file. */
const GATES_OPEN = '  "gates": {';

/**
 * The record of a pass, failing the case when the file was refused.
 * @param record - The pass
 * @returns What it wrote
 */
function written(record: GapRecord): Exclude<GapRecord, { problem: string }> {
  if (record.problem !== null) throw new Error(record.problem);
  return record;
}

/** A declaration in a style of its own, with keys Lisa does not know. */
const HOST = [
  "{",
  '  "harness": "fleet",',
  '  "x-notes": { "why": ["kept"] },',
  GATES_OPEN,
  '    "runner": "npm run",',
  '    "x-lint": {',
  '      "run": "lint",',
  '      "post-tool": "required",',
  '      "commit": "required"',
  "    },",
  '    "x-format": {',
  '      "run": "format",',
  '      "post-tool": {',
  '        "level": "optional",',
  '        "failure_shape": ["would reformat"]',
  "      }",
  "    },",
  '    "x-inline": { "run": "inline", "post-tool": { "level": "required" } },',
  '    "x-off": { "run": "off", "post-tool": "off" },',
  '    "x-later": { "run": "later", "commit": "required" }',
  "  }",
  "}",
  "",
].join("\n");

describe("a declaration with checks after a file write", () => {
  it("names the agent on each of them, and on nothing else", () => {
    const record = written(recordUnenforceable(HOST, AGY));

    expect(record.gates).toEqual(["x-lint", "x-format", "x-inline"]);
    expect(record.added).toEqual(AGY);
    expect(JSON.parse(record.text)).toEqual({
      harness: "fleet",
      "x-notes": { why: ["kept"] },
      gates: {
        runner: "npm run",
        "x-lint": {
          run: "lint",
          "post-tool": { level: "required", unenforceable_on: ["agy"] },
          commit: "required",
        },
        "x-format": {
          run: "format",
          "post-tool": {
            level: "optional",
            failure_shape: ["would reformat"],
            unenforceable_on: ["agy"],
          },
        },
        "x-inline": {
          run: "inline",
          "post-tool": { level: "required", unenforceable_on: ["agy"] },
        },
        "x-off": { run: "off", "post-tool": "off" },
        "x-later": { run: "later", commit: "required" },
      },
    });
  });

  it("changes only the lines it has to, in the file's own style", () => {
    const record = written(recordUnenforceable(HOST, AGY));
    const before = HOST.split("\n");
    const after = record.text.split("\n");

    expect(after.filter(line => !before.includes(line))).toEqual([
      '      "post-tool": { "level": "required", "unenforceable_on": ["agy"] },',
      '        "failure_shape": ["would reformat"],',
      '        "unenforceable_on": ["agy"]',
      '    "x-inline": { "run": "inline", "post-tool": { "level": "required", "unenforceable_on": ["agy"] } },',
    ]);
    expect(before.filter(line => !after.includes(line))).toEqual([
      '      "post-tool": "required",',
      '        "failure_shape": ["would reformat"]',
      '    "x-inline": { "run": "inline", "post-tool": { "level": "required" } },',
    ]);
  });

  it("is not changed by a second pass", () => {
    const once = written(recordUnenforceable(HOST, AGY));
    const twice = written(recordUnenforceable(once.text, AGY));

    expect(twice.text).toBe(once.text);
    expect(twice.added).toEqual([]);
    expect(twice.gates).toEqual(once.gates);
  });

  it("writes what the gate registry accepts", async () => {
    const registry = await shippedGates();
    const record = written(recordUnenforceable(HOST, ["agy", "copilot"]));
    const { runner: _runner, ...gates } = (
      JSON.parse(record.text) as { gates: Record<string, unknown> }
    ).gates;

    expect(registry.validateGates(gates)).toEqual([]);
  });

  it("writes a short entry that would not fit on its line as an expanded one", () => {
    const text = [
      "{",
      GATES_OPEN,
      '    "a-gate-with-a-long-name": { "run": "lint", "tier": "advisory", "post-tool": "required" }',
      "  }",
      "}",
      "",
    ].join("\n");

    expect(written(recordUnenforceable(text, AGY)).text).toBe(
      [
        "{",
        GATES_OPEN,
        '    "a-gate-with-a-long-name": { "run": "lint", "tier": "advisory", "post-tool": {',
        '      "level": "required",',
        '      "unenforceable_on": ["agy"]',
        "    } }",
        "  }",
        "}",
        "",
      ].join("\n")
    );
  });
});

describe("a list the declaration already holds", () => {
  /**
   * A declaration whose one check names some agents already.
   * @param named - The list as written
   * @returns The file's content
   */
  const naming = (named: string): string =>
    `{ "gates": { "x-lint": { "run": "lint", "post-tool": { "level": "required", "unenforceable_on": ${named} } } } }\n`;

  it("gains the agent, in the order Lisa lists agents", () => {
    const record = written(recordUnenforceable(naming('["copilot"]'), AGY));

    expect(record.text).toBe(naming('["agy", "copilot"]'));
    expect(record.added).toEqual(AGY);
  });

  it("is left alone when it names the agent already", () => {
    const text = naming('[\n  "agy"\n]');
    const record = written(recordUnenforceable(text, AGY));

    expect(record.text).toBe(text);
    expect(record.added).toEqual([]);
    expect(record.gates).toEqual(["x-lint"]);
  });

  it("keeps an agent that is not on this run's roster", () => {
    expect(
      written(recordUnenforceable(naming('["devin", "agy"]'), AGY)).text
    ).toBe(naming('["devin", "agy"]'));
  });

  it("is refused, and nothing is written, when it is not a list", () => {
    const record = recordUnenforceable(naming('"agy"'), AGY);

    expect(record.problem).toContain(
      'gates."x-lint"."post-tool".unenforceable_on is not a list'
    );
    expect(record.problem).toContain("left untouched");
  });
});

describe("a declaration with nothing to record on", () => {
  it.each([
    ["there is no file", null],
    ["the file declares no gates", '{ "harness": "agy" }\n'],
    [
      "no gate is checked after a file write",
      '{ "gates": { "x-lint": { "run": "lint", "commit": "required" } } }\n',
    ],
    [
      "the only such check is off",
      '{ "gates": { "x-lint": { "run": "lint", "post-tool": { "level": "off" } } } }\n',
    ],
  ])("writes nothing when %s", (_name, text) => {
    const record = written(recordUnenforceable(text, AGY));

    expect(record.text).toBe(text ?? "");
    expect(record.gates).toEqual([]);
    expect(record.added).toEqual([]);
  });

  it.each([
    ["is not JSON", "{ broken"],
    ["holds a list", "[]\n"],
    ["holds gates that are not an object", '{ "gates": [] }\n'],
    ["has a comment in it", '{\n  // ours\n  "gates": {}\n}\n'],
  ])("is refused when the file %s", (_name, text) => {
    expect(recordUnenforceable(text, AGY).problem).toContain("left untouched");
  });
});
