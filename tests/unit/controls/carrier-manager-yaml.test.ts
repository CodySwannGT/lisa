/**
 * Adding the carriers to a hook manager's YAML file (CodySwannGT/lisa#4989).
 *
 * The file belongs to the repository, so two things are held for Lefthook
 * and for the pre-commit framework alike: every line that was there is still
 * there, in order, and the file means exactly what it meant plus the one
 * entry that was added. A file whose shape cannot be added to safely is left
 * alone, with a sentence saying what to add by hand.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEFTHOOK_COMMAND,
  lefthookCommand,
  lefthookWith,
} from "../../../src/controls/carrier-lefthook.js";
import {
  PRE_COMMIT_ENTRY,
  preCommitWith,
} from "../../../src/controls/carrier-pre-commit.js";
import { carrierMarkers } from "../../../src/controls/carrier-script.js";
import type { ManagerFileEdit } from "../../../src/controls/carrier-yaml-lines.js";
import { loadYaml } from "../../../src/utils/yaml.js";

/** The Lefthook configuration Lisa ships for one of its project types. */
const SHIPPED_LEFTHOOK = readFileSync(
  path.resolve(__dirname, "../../../rails/copy-overwrite/lefthook.yml"),
  "utf8"
);

const LEFTHOOK = [
  "# The repository's own hooks.",
  "pre-commit:",
  "  parallel: true",
  "  commands:",
  "    lint:",
  "      run: ruff check .",
  "    format:",
  "      run: >-",
  "        ruff format",
  "        --check .",
  "",
  "commit-msg:",
  "  commands:",
  "    subject:",
  "      run: head -1 {1}",
  "",
].join("\n");

const PRE_COMMIT = [
  "# The repository's own hooks.",
  "default_stages: [pre-commit]",
  "repos:",
  "  - repo: https://example.test/hooks",
  "    rev: v1.0.0",
  "    hooks:",
  "      - id: trailing-whitespace",
  "",
  "exclude: ^vendor/",
  "",
].join("\n");

/** A parsed YAML mapping. */
type Mapping = Record<string, unknown>;

/**
 * Unwrap an edit that was expected to succeed.
 * @param edit - The edit
 * @returns Its text and state
 */
function done(edit: ManagerFileEdit): { text: string; state: string } {
  if (edit.problem !== null) throw new Error(edit.problem);
  return edit;
}

/**
 * The lines of a text that are not in another, in order.
 * @param before - The earlier text
 * @param after - The later text
 * @returns The lines of `before` that `after` dropped or moved
 */
function lost(before: string, after: string): string[] {
  const remaining = after.split("\n");
  return before.split("\n").filter(line => {
    const at = remaining.indexOf(line);
    if (at === -1) return true;
    remaining.splice(0, at + 1);
    return false;
  });
}

/**
 * Add both moments to a Lefthook configuration.
 * @param text - The file's content
 * @returns The file with both commands added
 */
function lefthookBoth(text: string): string {
  return done(lefthookWith(done(lefthookWith(text, "commit")).text, "push"))
    .text;
}

describe("the carrier in a Lefthook configuration", () => {
  it("is one more command under the hook's existing commands", () => {
    const edit = done(lefthookWith(LEFTHOOK, "commit"));
    const parsed = loadYaml(edit.text) as Record<string, Mapping>;
    const before = loadYaml(LEFTHOOK) as Record<string, Mapping>;

    expect(edit.state).toBe("added");
    expect(lost(LEFTHOOK, edit.text)).toEqual([]);
    expect(parsed["pre-commit"]?.commands).toEqual({
      ...(before["pre-commit"]?.commands as Mapping),
      [LEFTHOOK_COMMAND]: { run: "sh .lisa/hooks/pre-commit" },
    });
    expect(parsed["commit-msg"]).toEqual(before["commit-msg"]);
  });

  it("opens the hook when the file has none, and asks for stdin at push", () => {
    const edit = done(lefthookWith(LEFTHOOK, "push"));
    const parsed = loadYaml(edit.text) as Record<string, Mapping>;

    expect(lost(LEFTHOOK, edit.text)).toEqual([]);
    expect(parsed["pre-push"]).toEqual({
      commands: {
        [LEFTHOOK_COMMAND]: { run: "sh .lisa/hooks/pre-push", use_stdin: true },
      },
    });
    expect(lefthookCommand("push")).toEqual({
      run: "sh .lisa/hooks/pre-push",
      use_stdin: true,
    });
  });

  it("adds commands to a hook that only has other settings", () => {
    const text = "pre-commit:\n  parallel: true\n";

    const parsed = loadYaml(done(lefthookWith(text, "commit")).text);

    expect(parsed).toEqual({
      "pre-commit": {
        commands: { [LEFTHOOK_COMMAND]: lefthookCommand("commit") },
        parallel: true,
      },
    });
  });

  it("keeps every line of the configuration Lisa ships for a stack", () => {
    const both = lefthookBoth(SHIPPED_LEFTHOOK);
    const parsed = loadYaml(both) as Record<string, Record<string, Mapping>>;

    expect(lost(SHIPPED_LEFTHOOK, both)).toEqual([]);
    expect(parsed["pre-push"]?.commands?.[LEFTHOOK_COMMAND]).toEqual(
      lefthookCommand("push")
    );
    expect(Object.keys(parsed["pre-commit"]?.commands ?? {})).toContain(
      "rubocop"
    );
  });

  it("changes nothing the second time", () => {
    const both = lefthookBoth(LEFTHOOK);

    expect(lefthookWith(both, "commit")).toEqual({
      problem: null,
      state: "present",
      text: both,
    });
    expect(done(lefthookWith(both, "push")).state).toBe("present");
  });

  it("replaces its own marked lines in place when they have changed", () => {
    const stale = lefthookBoth(LEFTHOOK).replace(
      "run: sh .lisa/hooks/pre-commit",
      "run: sh an-older-carrier"
    );

    const edit = done(lefthookWith(stale, "commit"));

    expect(edit.state).toBe("replaced");
    expect(edit.text).toBe(lefthookBoth(LEFTHOOK));
  });

  it.each([
    ["a hook written on one line", "pre-commit: { parallel: true }\n"],
    ["a JSON configuration", '{ "pre-commit": { "parallel": true } }\n'],
    ["text that is not a mapping", "- one\n- two\n"],
  ])("leaves %s alone and says what to add by hand", (_, text) => {
    const edit = lefthookWith(text, "commit");

    expect(edit.problem).toMatch(/by hand, with these settings: \{"run":/u);
  });

  it("refuses a command of the same name it did not write", () => {
    const text = `pre-commit:\n  commands:\n    ${LEFTHOOK_COMMAND}:\n      run: something else\n`;

    expect(lefthookWith(text, "commit").problem).toMatch(
      /already has a command named "lisa-gates" that this command did not write/u
    );
  });
});

describe("the carriers in a pre-commit framework configuration", () => {
  it("are one local entry at the end of repos, after every other hook", () => {
    const edit = done(preCommitWith(PRE_COMMIT, "commit"));
    const parsed = loadYaml(edit.text) as { repos: unknown[] } & Mapping;
    const before = loadYaml(PRE_COMMIT) as { repos: unknown[] } & Mapping;

    expect(edit.state).toBe("added");
    expect(lost(PRE_COMMIT, edit.text)).toEqual([]);
    expect(parsed.repos).toEqual([...before.repos, PRE_COMMIT_ENTRY]);
    expect(parsed.exclude).toBe(before.exclude);
    expect(PRE_COMMIT_ENTRY.hooks).toEqual(
      ["commit", "push"].map(moment => ({
        always_run: true,
        entry: `sh .lisa/hooks/pre-${moment}`,
        id: `lisa-gates-${moment}`,
        language: "system",
        name: `Checks this repository requires before a ${moment}`,
        pass_filenames: false,
        stages: [`pre-${moment}`],
      }))
    );
  });

  it("finds both moments there once the entry is written", () => {
    const { text } = done(preCommitWith(PRE_COMMIT, "commit"));

    expect(preCommitWith(text, "push")).toEqual({
      problem: null,
      state: "present",
      text,
    });
    expect(done(preCommitWith(text, "commit")).state).toBe("present");
  });

  it("adds to a list written without indentation", () => {
    const text = "repos:\n- repo: https://example.test/hooks\n  rev: v1\n";

    const edit = done(preCommitWith(text, "commit"));

    expect(lost(text, edit.text)).toEqual([]);
    expect((loadYaml(edit.text) as { repos: unknown[] }).repos).toHaveLength(2);
    expect(edit.text).toContain(`\n${carrierMarkers("hooks").begin}\n`);
  });

  it("replaces its own marked lines in place when they have changed", () => {
    const fresh = done(preCommitWith(PRE_COMMIT, "commit")).text;
    const stale = fresh.replace("always_run: true", "always_run: false");

    const edit = done(preCommitWith(stale, "commit"));

    expect(edit.state).toBe("replaced");
    expect(edit.text).toBe(fresh);
  });

  it.each([
    ["an empty list of repos", "repos: []\n"],
    ["a file with no repos", "exclude: ^vendor/\n"],
  ])("leaves %s alone and says what to add by hand", (_, text) => {
    expect(preCommitWith(text, "commit").problem).toMatch(
      /Add this entry to "repos" by hand: \{"repo":"local"/u
    );
  });

  it("refuses a hook id of its own that it did not write", () => {
    const text =
      "repos:\n  - repo: local\n    hooks:\n      - id: lisa-gates-commit\n        entry: something else\n";

    expect(preCommitWith(text, "commit").problem).toMatch(
      /already has a hook whose id starts with "lisa-gates-"/u
    );
  });
});
