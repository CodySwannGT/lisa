/**
 * Adding the edit-time carrier's hook entry to a settings file a coding agent
 * reads, in whatever style the repository wrote that file
 * (CodySwannGT/lisa#4990).
 *
 * The file is added to and never rewritten, and that is held byte for byte:
 * what the repository wrote beside the place the entry goes stays exactly as
 * it was, an entry written on one line included. An editor that formats the
 * line it writes to reflows such an entry, and one that takes the last entry
 * out of a one-line list by position loses a bracket; both are cases here.
 */
import { describe, expect, it } from "vitest";

import {
  hookEntry,
  mergeHookEntry,
  type HookEntryMerge,
} from "../../../src/controls/carrier-agent-settings.js";
import {
  AGENT_SURFACES,
  type MergedRegistration,
} from "../../../src/controls/carrier-agent-surfaces.js";

const COMMAND = "sh .lisa/hooks/post-tool claude";
const OLDER_COMMAND = "sh .lisa/hooks/post-tool-v0 claude";

/**
 * The registration of an agent whose hooks are merged into a settings file.
 * @param agent - The agent
 * @returns Where its entry goes
 */
function registrationOf(agent: "claude" | "cursor"): MergedRegistration {
  const surface = AGENT_SURFACES[agent];
  if (!surface.refuses || surface.registration.kind !== "merged") {
    throw new Error(`${agent} is not merged into a settings file`);
  }
  return surface.registration;
}

const NESTED = registrationOf("claude");
const FLAT = registrationOf("cursor");

/**
 * The new text of a merge, failing the case when the file was refused.
 * @param merged - The merge
 * @returns The text and what changed
 */
function written(merged: HookEntryMerge): { text: string; state: string } {
  if (merged.problem !== null) throw new Error(merged.problem);
  return merged;
}

/**
 * Tell whether a text is another with one stretch of text put into it and
 * nothing else changed.
 * @param before - The file as the repository wrote it
 * @param after - The file after the entry was added
 * @returns Whether every byte of `before` is in `after`, in place
 */
function onlyGained(before: string, after: string): boolean {
  const limit = Math.min(before.length, after.length);
  const same = (offset: (index: number, text: string) => number): number =>
    Array.from({ length: limit }, (_, index) => index).findIndex(
      index =>
        before.charAt(offset(index, before)) !==
        after.charAt(offset(index, after))
    );
  const head = same(index => index);
  const tail = same((index, text) => text.length - 1 - index);
  return (
    after.length > before.length &&
    (head === -1 ? limit : head) + (tail === -1 ? limit : tail) >= before.length
  );
}

describe("a settings file written in a style of its own", () => {
  const ONE_LINE_ENTRY =
    '{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo ours" }] }';

  // Each of these has something written on one line beside the place the
  // entry goes. An editor that formats the line it writes to would reflow it.
  const STYLES: ReadonlyArray<readonly [string, string, MergedRegistration]> = [
    [
      "a list written on one line",
      `{\n  "hooks": {\n    "PostToolUse": [${ONE_LINE_ENTRY}]\n  }\n}\n`,
      NESTED,
    ],
    [
      "a one-line entry on a line of its own",
      `{\n  "hooks": {\n    "PostToolUse": [\n      ${ONE_LINE_ENTRY}\n    ]\n  }\n}\n`,
      NESTED,
    ],
    [
      "a whole file written on one line",
      `{"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[]}]},"model":"opus"}\n`,
      NESTED,
    ],
    [
      "an empty list beside other keys on its line",
      `{ "hooks": { "PostToolUse": [], "Stop": [{ "hooks": [] }] } }\n`,
      NESTED,
    ],
    [
      "no list yet, after a key written on one line",
      `{\n  "permissions": { "allow": ["Bash(ls:*)", "Read"], "deny": [] }\n}\n`,
      NESTED,
    ],
    [
      "no list yet, in a hooks object written on one line",
      `{\n  "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [] }] }\n}\n`,
      NESTED,
    ],
    [
      "a flat list written on one line",
      `{\n  "version": 1,\n  "hooks": { "postToolUse": [{ "command": "echo ours", "matcher": "Shell" }] }\n}\n`,
      FLAT,
    ],
    [
      "a one-line entry followed by a comment and a trailing comma",
      `{\n  "hooks": {\n    "PostToolUse": [\n      ${ONE_LINE_ENTRY}, // ours\n    ],\n  },\n}\n`,
      NESTED,
    ],
  ];

  it.each(STYLES)("keeps every byte of %s", (_name, text, registration) => {
    const merged = written(mergeHookEntry(text, registration, [COMMAND]));
    const again = written(mergeHookEntry(merged.text, registration, [COMMAND]));

    expect(merged.state).toBe("added");
    expect(onlyGained(text, merged.text)).toBe(true);
    expect(again).toEqual({
      problem: null,
      state: "present",
      text: merged.text,
    });
  });

  it("keeps a neighbour's one line as it was when an older entry of Lisa's is replaced", () => {
    const stale = written(
      mergeHookEntry(
        `{\n  "hooks": {\n    "PostToolUse": [\n      ${ONE_LINE_ENTRY}\n    ]\n  }\n}\n`,
        { ...NESTED, matcher: "Write" },
        [COMMAND]
      )
    );

    const merged = written(mergeHookEntry(stale.text, NESTED, [COMMAND]));

    expect(merged.state).toBe("replaced");
    expect(merged.text).toContain(`\n      ${ONE_LINE_ENTRY},\n`);
    expect(
      (JSON.parse(merged.text) as { hooks: { PostToolUse: unknown[] } }).hooks
        .PostToolUse
    ).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "echo ours" }] },
      hookEntry(NESTED, COMMAND),
    ]);
  });

  it("keeps a neighbour on the same line as it was when Lisa's entry is taken out of a one-line list", () => {
    const text = `{ "hooks": { "PostToolUse": [${ONE_LINE_ENTRY}, { "matcher": "Write", "hooks": [{ "type": "command", "command": "${OLDER_COMMAND}", "timeout": 150 }] }] } }\n`;

    const merged = written(
      mergeHookEntry(text, NESTED, [COMMAND, OLDER_COMMAND])
    );

    expect(merged.state).toBe("replaced");
    expect(
      merged.text.startsWith(`{ "hooks": { "PostToolUse": [${ONE_LINE_ENTRY}, `)
    ).toBe(true);
    expect(merged.text).not.toContain(OLDER_COMMAND);
    expect(
      (JSON.parse(merged.text) as { hooks: { PostToolUse: unknown[] } }).hooks
        .PostToolUse
    ).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "echo ours" }] },
      hookEntry(NESTED, COMMAND),
    ]);
  });
});
