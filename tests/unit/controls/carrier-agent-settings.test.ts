/**
 * Adding the edit-time carrier's hook entry to a settings file a coding agent
 * reads.
 *
 * The file is the repository's. These cases hold the promise that it is added
 * to and never rewritten: every byte the repository wrote is still there, in
 * its own style, and a second pass changes nothing
 * (CodySwannGT/lisa#4990).
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
function registrationOf(
  agent: "claude" | "cursor" | "devin"
): MergedRegistration {
  const surface = AGENT_SURFACES[agent];
  if (!surface.refuses || surface.registration.kind !== "merged") {
    throw new Error(`${agent} is not merged into a settings file`);
  }
  return surface.registration;
}

const NESTED = registrationOf("claude");
const FLAT = registrationOf("cursor");
const ROOT_LEVEL = registrationOf("devin");

/**
 * The new text of a merge, failing the case when the file was refused.
 * @param merged - The merge
 * @returns The text and what changed
 */
function written(merged: HookEntryMerge): { text: string; state: string } {
  if (merged.problem !== null) throw new Error(merged.problem);
  return merged;
}

/** A settings file in a style of its own: four spaces, its own keys. */
const HOST = [
  "{",
  '    "model": "opus",',
  '    "x-team": { "owner": "platform", "tags": ["a", "b"] },',
  '    "hooks": {',
  '        "PreToolUse": [{ "matcher": "Bash", "hooks": [] }],',
  '        "PostToolUse": [',
  "            {",
  '                "matcher": "Bash",',
  '                "hooks": [{ "type": "command", "command": "echo ours" }]',
  "            }",
  "        ]",
  "    }",
  "}",
  "",
].join("\n");

describe("a repository with no settings file", () => {
  it("gets one holding the entry and nothing else", () => {
    const merged = written(mergeHookEntry(null, NESTED, [COMMAND]));

    expect(merged.state).toBe("added");
    expect(JSON.parse(merged.text)).toEqual({
      hooks: { PostToolUse: [hookEntry(NESTED, COMMAND)] },
    });
    expect(merged.text.endsWith("}\n")).toBe(true);
  });

  it("gets what the agent requires beside the hook", () => {
    expect(
      JSON.parse(written(mergeHookEntry("", FLAT, [COMMAND])).text)
    ).toEqual({
      version: 1,
      hooks: { postToolUse: [{ command: COMMAND, matcher: FLAT.matcher }] },
    });
  });

  it("gets the list at the top level for an agent whose file is the hooks object", () => {
    expect(
      JSON.parse(written(mergeHookEntry(null, ROOT_LEVEL, [COMMAND])).text)
    ).toEqual({ PostToolUse: [hookEntry(ROOT_LEVEL, COMMAND)] });
  });
});

describe("a settings file the repository wrote", () => {
  it("keeps every byte it had before the entry and after it", () => {
    const merged = written(mergeHookEntry(HOST, NESTED, [COMMAND]));
    const start = merged.text.indexOf(
      ',\n            {\n                "matcher": "Write'
    );
    const kept = HOST.indexOf("\n        ]\n    }\n}\n");

    expect(merged.state).toBe("added");
    expect(start).toBeGreaterThan(0);
    expect(merged.text.slice(0, start)).toBe(HOST.slice(0, kept));
    expect(merged.text.endsWith(HOST.slice(kept))).toBe(true);
  });

  it("puts the entry after the repository's own hooks, in the file's indentation", () => {
    const merged = written(mergeHookEntry(HOST, NESTED, [COMMAND]));
    const hooks = (
      JSON.parse(merged.text) as { hooks: { PostToolUse: unknown[] } }
    ).hooks.PostToolUse;

    expect(hooks).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "echo ours" }] },
      hookEntry(NESTED, COMMAND),
    ]);
    expect(merged.text).toContain(
      '\n                "matcher": "Write|Edit|MultiEdit|NotebookEdit",\n'
    );
  });

  it("is not changed by a second pass", () => {
    const once = written(mergeHookEntry(HOST, NESTED, [COMMAND]));
    const twice = written(mergeHookEntry(once.text, NESTED, [COMMAND]));

    expect(twice.state).toBe("present");
    expect(twice.text).toBe(once.text);
  });

  it("gains the list, and the keys leading to it, when it has neither", () => {
    const merged = written(
      mergeHookEntry('{\n  "model": "opus"\n}\n', NESTED, [COMMAND])
    );

    expect(JSON.parse(merged.text)).toEqual({
      model: "opus",
      hooks: { PostToolUse: [hookEntry(NESTED, COMMAND)] },
    });
    expect(merged.text.startsWith('{\n  "model": "opus",\n  "hooks": {')).toBe(
      true
    );
  });

  it("keeps comments and a trailing comma", () => {
    const text = '{\n  // ours\n  "model": "opus",\n}\n';
    const merged = written(mergeHookEntry(text, NESTED, [COMMAND]));

    expect(merged.text).toContain("// ours");
    expect(merged.text).toContain('"model": "opus",');
  });

  it("keeps a tab-indented file tab-indented", () => {
    const merged = written(
      mergeHookEntry('{\n\t"hooks": {\n\t\t"postToolUse": []\n\t}\n}\n', FLAT, [
        COMMAND,
      ])
    );

    expect(merged.text).toContain('\n\t\t\t{\n\t\t\t\t"command": ');
    expect(merged.text).not.toMatch(/^ +"/mu);
  });
});

describe("an entry Lisa wrote earlier", () => {
  it("is replaced, once, when its matcher is out of date", () => {
    const stale = written(
      mergeHookEntry(HOST, { ...NESTED, matcher: "Write" }, [COMMAND])
    );

    const merged = written(mergeHookEntry(stale.text, NESTED, [COMMAND]));
    const hooks = (
      JSON.parse(merged.text) as { hooks: { PostToolUse: unknown[] } }
    ).hooks.PostToolUse;

    expect(merged.state).toBe("replaced");
    expect(hooks).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "echo ours" }] },
      hookEntry(NESTED, COMMAND),
    ]);
  });

  it("is replaced when it runs a command Lisa used to write", () => {
    const old = written(mergeHookEntry(HOST, NESTED, [OLDER_COMMAND]));

    const merged = written(
      mergeHookEntry(old.text, NESTED, [COMMAND, OLDER_COMMAND])
    );

    expect(merged.state).toBe("replaced");
    expect(merged.text).not.toContain(OLDER_COMMAND);
    expect(merged.text.split(COMMAND)).toHaveLength(2);
  });

  it("is written once when the file holds it twice", () => {
    const once = written(mergeHookEntry(null, FLAT, [COMMAND]));
    const doubled = JSON.parse(once.text) as {
      hooks: { postToolUse: unknown[] };
    };
    const twice = `${JSON.stringify(
      {
        ...doubled,
        hooks: {
          postToolUse: [
            ...doubled.hooks.postToolUse,
            ...doubled.hooks.postToolUse,
          ],
        },
      },
      null,
      2
    )}\n`;

    const merged = written(mergeHookEntry(twice, FLAT, [COMMAND]));

    expect(merged.state).toBe("replaced");
    expect(JSON.parse(merged.text)).toEqual(JSON.parse(once.text));
  });

  it("is taken out from beside a handler of the repository's, which stays", () => {
    const shared = `${JSON.stringify(
      {
        hooks: {
          PostToolUse: [
            {
              matcher: "Write",
              hooks: [
                { type: "command", command: "echo ours" },
                { type: "command", command: COMMAND },
              ],
            },
          ],
        },
      },
      null,
      2
    )}\n`;

    const merged = written(mergeHookEntry(shared, NESTED, [COMMAND]));

    expect(
      (JSON.parse(merged.text) as { hooks: { PostToolUse: unknown[] } }).hooks
        .PostToolUse
    ).toEqual([
      { matcher: "Write", hooks: [{ type: "command", command: "echo ours" }] },
      hookEntry(NESTED, COMMAND),
    ]);
  });

  it("is not taken for a command of the repository's that starts the same script", () => {
    const theirs = `${JSON.stringify(
      {
        hooks: {
          PostToolUse: [
            {
              matcher: "Write",
              hooks: [{ type: "command", command: `${COMMAND} && echo ours` }],
            },
          ],
        },
      },
      null,
      2
    )}\n`;

    const merged = written(mergeHookEntry(theirs, NESTED, [COMMAND]));

    expect(merged.state).toBe("added");
    expect(merged.text).toContain(`${COMMAND} && echo ours`);
  });
});

describe("a settings file that cannot be added to", () => {
  it.each([
    ["is not JSON", "{ broken"],
    ["holds a list", "[]\n"],
    ["holds text", '"hooks"\n'],
  ])("is refused when it %s", (_name, text) => {
    const merged = mergeHookEntry(text, NESTED, [COMMAND]);

    expect(merged.problem).toContain(NESTED.file);
    expect(merged.problem).toContain("left untouched");
  });

  it.each([
    [
      "the list is an object",
      '{ "hooks": { "PostToolUse": {} } }',
      "hooks.PostToolUse",
    ],
    ["the key above the list is a list", '{ "hooks": [] }', "hooks"],
    ["the key above the list is text", '{ "hooks": "none" }', "hooks"],
  ])("is refused when %s, naming the key", (_name, text, key) => {
    const merged = mergeHookEntry(text, NESTED, [COMMAND]);

    expect(merged.problem).toContain(`"${key}"`);
  });
});
