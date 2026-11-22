/**
 * Tests how block-generated-artifact-edits.sh matches its globs.
 *
 * The hook used to match a glob with an unquoted `case` pattern, which
 * ShellCheck reports as SC2254. It now matches through the anchored ERE that
 * `lisa_glob_ere` builds (the same helper block-managed-file-edits.sh uses), so
 * the ERE has to select exactly what the `case` pattern did. Each row writes
 * one allowlist line for a path the shipped globs block: a line that matches
 * lets the edit through (0), one that does not leaves it blocked (2). The rows
 * cover every branch of `matches_glob` — a starred base name with and without
 * a directory, and a wildcard-free glob matched whole or as a path suffix —
 * and ERE metacharacters that must stay literal.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const PLUGIN_ROOT = path.resolve("plugins/src/harper-fabric");
const SCRIPT_PATH = path.join(
  PLUGIN_ROOT,
  "hooks/block-generated-artifact-edits.sh"
);
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

/** Blocked by the shipped `harper-app/*.js` glob. */
const GENERATED = "harper-app/resources.js";

let project: string;

/**
 * Run the hook against a Write of one path.
 * @param filePath - Path the tool would write
 * @returns Exit status
 */
function runHook(filePath: string): number | null {
  return boundedSpawnSync({
    label: "block-generated-artifact-edits.sh",
    command: BASH_PATH,
    args: [SCRIPT_PATH],
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      CLAUDE_PROJECT_DIR: project,
    },
    input: JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: filePath },
    }),
  }).status;
}

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "lisa-harper-globs-"));
  mkdirSync(path.join(project, ".lisa"), { recursive: true });
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("block-generated-artifact-edits.sh glob matching", () => {
  it("blocks the generated path when nothing allowlists it", () => {
    expect(runHook(GENERATED)).toBe(EXIT_BLOCKED);
  });

  it.each([
    ["a starred base name in a directory", "harper-app/*.js", GENERATED],
    ["a starred base name with a prefix", "harper-app/res*.js", GENERATED],
    ["a starred base name only", "*.js", GENERATED],
    ["a globbed directory", "harp*/res*.js", GENERATED],
    ["a question mark", "harper-app/r?sources.js", GENERATED],
    ["a bracket member", "harper-app/[r]esources.js", GENERATED],
    ["a negated bracket", "harper-app/[!x]esources.js", GENERATED],
    ["a wildcard-free glob", "harper-app/resources.js", GENERATED],
    [
      "a wildcard-free glob as a suffix",
      "harper-app/r?sources.js",
      "/repo/harper-app/resources.js",
    ],
    [
      "a starred base name under a prefixed path",
      "harper-app/*.js",
      "/repo/harper-app/resources.js",
    ],
  ])("allowlists through %s", (_label, line, target) => {
    writeFileSync(
      path.join(project, ".lisa/harper-generated-artifact-allowlist.txt"),
      `${line}\n`
    );
    expect(runHook(target)).toBe(EXIT_ALLOWED);
  });

  it.each([
    ["a dot, which is not any character", "harper-app/resources.j."],
    ["a dot standing for the slash", "harper-app.resources.js"],
    ["a plus in a starred base name", "harper-app/*.j+s"],
    ["a group", "harper-app/(resources).js"],
    ["an alternation bar", "nothing|harper-app/*.js"],
    ["a bracket without the character", "harper-app/[xyz]esources.js"],
    ["an escaped star, which is literal", "harper-app/\\*.js"],
    ["an unterminated bracket", "harper-app/[resources.js"],
    ["a trailing backslash", "harper-app/resources.js\\"],
  ])("still blocks through %s", (_label, line) => {
    writeFileSync(
      path.join(project, ".lisa/harper-generated-artifact-allowlist.txt"),
      `${line}\n`
    );
    expect(runHook(GENERATED)).toBe(EXIT_BLOCKED);
  });
});
