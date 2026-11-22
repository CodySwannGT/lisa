/**
 * The comments a repository wrote in a settings file, when an entry is added
 * to it or taken out of it by position (CodySwannGT/lisa#4990).
 *
 * A comment belongs to the repository. Taking Lisa's older entry out removes
 * that entry and one comma, and a new entry goes after everything the
 * repository wrote in the list, its comments included. Each case states the
 * whole file before and after, because "the comment is still somewhere in the
 * file" is not the claim: it stays where it was.
 */
import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";

import {
  mergeHookEntry,
  type HookEntryMerge,
} from "../../../src/controls/carrier-agent-settings.js";
import {
  AGENT_SURFACES,
  type MergedRegistration,
} from "../../../src/controls/carrier-agent-surfaces.js";
import {
  withAppended,
  withoutItem,
} from "../../../src/controls/carrier-json-place.js";

const LIST = ["list"];
const ADDED = { added: true };
const HOST_ITEM = '    { "host": 1 }';

/**
 * Join the lines of a file.
 * @param lines - The lines
 * @returns The file's text, ending with a line break
 */
function file(...lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

/**
 * A file whose one key is a list written over lines.
 * @param lines - The lines between the list's brackets
 * @returns The file's text, ending with a line break
 */
function listFile(...lines: readonly string[]): string {
  return file("{", '  "list": [', ...lines, "  ]", "}");
}

describe("taking one item out of a list that holds comments", () => {
  it("keeps a comment line between the item and the one after it", () => {
    const text = listFile(
      '    { "lisa": 1 },',
      "    // ours: keep this one fast",
      HOST_ITEM
    );

    expect(withoutItem(text, [...LIST, 0])).toBe(
      listFile("    // ours: keep this one fast", HOST_ITEM)
    );
  });

  it("keeps a comment line between the item and the one before it", () => {
    const text = listFile(
      '    { "host": 1 },',
      "    // ours: runs last",
      '    { "lisa": 1 }'
    );

    expect(withoutItem(text, [...LIST, 1])).toBe(
      listFile(HOST_ITEM, "    // ours: runs last")
    );
  });

  it("keeps a comment that ends the line of the item before it", () => {
    const text = listFile('    { "host": 1 }, // ours', '    { "lisa": 1 }');

    expect(withoutItem(text, [...LIST, 1])).toBe(
      listFile('    { "host": 1 } // ours')
    );
  });

  it("keeps a comment that ends the item's own line", () => {
    const text = listFile(
      '    { "lisa": 1 }, // ours: about the next one',
      HOST_ITEM
    );

    expect(withoutItem(text, [...LIST, 0])).toBe(
      listFile("    // ours: about the next one", HOST_ITEM)
    );
  });

  it("keeps a comment written inside a list on one line", () => {
    expect(
      withoutItem('{ "list": [{ "lisa": 1 }, /* ours */ { "host": 1 }] }', [
        ...LIST,
        0,
      ])
    ).toBe('{ "list": [/* ours */ { "host": 1 }] }');
    expect(
      withoutItem('{ "list": [{ "host": 1 }, /* ours */ { "lisa": 1 }] }', [
        ...LIST,
        1,
      ])
    ).toBe('{ "list": [{ "host": 1 } /* ours */] }');
  });

  it("takes the comma after the only item with it", () => {
    const text = listFile('    { "lisa": 1 },');

    const without = withoutItem(text, [...LIST, 0]);

    expect(without).toBe(file("{", '  "list": []', "}"));
    expect(parse(without)).toEqual({ list: [] });
  });

  it("is not misled by a comma written inside a comment", () => {
    const text = listFile(
      '    { "host": 1 }, // one, two',
      '    { "lisa": 1 } // three, four'
    );

    expect(withoutItem(text, [...LIST, 1])).toBe(
      listFile('    { "host": 1 } // one, two', "    // three, four")
    );
  });
});

describe("adding a value after a last item that a comment follows", () => {
  it("goes after a comment that ends the last item's line", () => {
    const text = listFile('    { "host": 1 } // ours');

    expect(withAppended(text, LIST, ADDED)).toBe(
      listFile(
        '    { "host": 1 }, // ours',
        "    {",
        '      "added": true',
        "    }"
      )
    );
  });

  it("goes after a comment on a line of its own under the last item", () => {
    const text = listFile(
      HOST_ITEM,
      "    // ours: nothing else runs after this"
    );

    expect(withAppended(text, LIST, ADDED)).toBe(
      listFile(
        '    { "host": 1 },',
        "    // ours: nothing else runs after this",
        "    {",
        '      "added": true',
        "    }"
      )
    );
  });

  it("goes after a block comment, and a comment written before a trailing comma", () => {
    expect(withAppended(listFile("    1 /* ours */"), LIST, 2)).toBe(
      listFile("    1, /* ours */", "    2")
    );
    expect(withAppended(listFile("    1 /* ours */, // more"), LIST, 2)).toBe(
      listFile("    1 /* ours */, // more", "    2,")
    );
  });

  it("goes after a comment in a list written on one line", () => {
    expect(withAppended('{ "list": [1 /* ours */] }', LIST, 2)).toBe(
      '{ "list": [1, /* ours */ 2] }'
    );
  });

  it("goes after the comment in a list that holds nothing else", () => {
    const text = listFile("    // ours: none yet");

    expect(withAppended(text, LIST, 2)).toBe(
      listFile("    // ours: none yet", "    2")
    );
    expect(withAppended('{ "list": [/* ours */] }', LIST, 2)).toBe(
      '{ "list": [/* ours */ 2] }'
    );
  });

  it("puts a new key after a comment that follows the last key", () => {
    const text = file("{", '  "model": "opus" // ours', "}");

    expect(withAppended(text, LIST, 2)).toBe(
      file(
        "{",
        '  "model": "opus", // ours',
        '  "list": [',
        "    2",
        "  ]",
        "}"
      )
    );
  });

  it("is not misled by what looks like a comment inside a string", () => {
    const text = listFile('    "a // not a comment"');

    expect(withAppended(text, LIST, 2)).toBe(
      listFile('    "a // not a comment",', "    2")
    );
  });
});

describe("replacing Lisa's older entry in a settings file with comments", () => {
  const COMMAND = "sh .lisa/hooks/post-tool claude";
  const OLDER = "sh .lisa/hooks/post-tool-v0 claude";
  const HOST_ENTRY =
    '{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo ours" }] }';
  const OLDER_ENTRY = `{ "matcher": "Write", "hooks": [{ "type": "command", "command": "${OLDER}" }] }`;

  /**
   * The registration of the agent whose settings file is edited.
   * @returns Where its entry goes
   */
  function registration(): MergedRegistration {
    const surface = AGENT_SURFACES.claude;
    if (!surface.refuses || surface.registration.kind !== "merged") {
      throw new Error("claude is not merged into a settings file");
    }
    return surface.registration;
  }

  /**
   * The new text of a merge, failing the case when the file was refused.
   * @param merged - The merge
   * @returns The text
   */
  function written(merged: HookEntryMerge): string {
    if (merged.problem !== null) throw new Error(merged.problem);
    return merged.text;
  }

  it("leaves every comment of the repository's on the line it was on", () => {
    const before = [
      "{",
      "  // ours: settings for everyone",
      '  "hooks": {',
      '    "PostToolUse": [',
      `      ${OLDER_ENTRY},`,
      "      // ours: keep the formatter fast",
      `      ${HOST_ENTRY} // ours: the formatter`,
      "      // ours: nothing after this",
      "    ]",
      "  }",
      "}",
    ];

    const after = written(
      mergeHookEntry(file(...before), registration(), [COMMAND, OLDER])
    ).split("\n");

    // Lisa's older line is gone, one comma was added after the repository's
    // entry, and every other line of the repository's is where it was.
    expect(after.slice(0, 8)).toEqual([
      ...before.slice(0, 4),
      "      // ours: keep the formatter fast",
      `      ${HOST_ENTRY}, // ours: the formatter`,
      "      // ours: nothing after this",
      "      {",
    ]);
    expect(after.slice(-4)).toEqual(["    ]", "  }", "}", ""]);
    expect(after.join("\n")).not.toContain(OLDER);
    expect(after.join("\n")).toContain(COMMAND);
  });
});
