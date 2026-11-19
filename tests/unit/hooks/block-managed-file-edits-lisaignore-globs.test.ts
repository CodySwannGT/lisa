/**
 * Tests how the managed-file guard matches `.lisaignore` glob lines.
 *
 * The guard used to match a line with an unquoted `case` pattern, which needed
 * a `# shellcheck disable=SC2254` beside it. It now builds an anchored ERE from
 * the line (`lisaignore_glob_ere`) and matches with `[[ =~ ]]`, so the ERE has
 * to select exactly what the `case` pattern did. These cases pin that: glob
 * metacharacters still act as globs, ERE metacharacters in a line are matched
 * literally rather than obeyed, and an escape or an unterminated bracket reads
 * the way the shell reads it.
 *
 * Each row is a verdict for one shipped template: 0 means the line claimed it
 * (the edit is allowed), 2 means it did not (the edit is refused).
 * @module tests/unit/hooks/block-managed-file-edits-lisaignore-globs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Both shipped copies of the guard; they must give the same verdicts. */
const GUARDS = [
  "plugins/src/base/hooks/block-managed-file-edits.sh",
  "all/copy-overwrite/scripts/lisa-hooks/block-managed-file-edits.sh",
];

/** Absolute interpreter path; resolving `bash` through PATH is not permitted. */
const BASH = "/bin/bash";

/** The hash-tracked copy-overwrite template every row is asked about. */
const MANAGED = "scripts/classify-maestro-failures.mjs";

/** Claimed: the guard allows the edit. */
const CLAIMED = 0;

/** Not claimed: the guard refuses the edit. */
const REFUSED = 2;

let project: string;

/** Shipped templates whose names hold a space and a non-ASCII letter. */
const SPACED = "scripts/with space.mjs";
const ACCENTED = "scripts/café.mjs";

/**
 * Run one guard copy against a Write of a shipped template.
 * @param guard - Repository-relative path of the guard copy
 * @param target - Template the tool would write
 * @returns Exit status; 2 means refused
 */
function verdict(guard: string, target: string = MANAGED): number {
  try {
    boundedExecFileSync({
      label: path.basename(guard),
      command: BASH,
      args: [path.join(REPO_ROOT, guard)],
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: target },
      }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      stdio: "pipe",
    });
    return 0;
  } catch (error) {
    return (error as { exitCode?: number | null }).exitCode ?? -1;
  }
}

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "lisa-guard-globs-"));
  const shipped = path.join(
    project,
    "node_modules/@codyswann/lisa/all/copy-overwrite/scripts"
  );
  mkdirSync(shipped, { recursive: true });
  writeFileSync(path.join(shipped, "classify-maestro-failures.mjs"), "x");
  writeFileSync(path.join(shipped, path.basename(SPACED)), "s");
  writeFileSync(path.join(shipped, path.basename(ACCENTED)), "a");
  const ledgerDir = path.join(
    project,
    "node_modules/@codyswann/lisa/dist/core"
  );
  mkdirSync(ledgerDir, { recursive: true });
  writeFileSync(
    path.join(ledgerDir, "lisa-owned-hash-ledger.json"),
    `${JSON.stringify({ LISA_OWNED_HASH_LEDGER: { [MANAGED]: [] } }, null, 2)}\n`
  );
  writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ name: "host-project" })
  );
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe.each(GUARDS)("%s matches .lisaignore globs", guard => {
  it.each([
    ["a star across the slash", "scr*mjs", CLAIMED],
    ["a star within the name", "scripts/classify-*.mjs", CLAIMED],
    ["a question mark", "scripts/classify-maestro-failures.?js", CLAIMED],
    ["a bracket member", "scripts/[c]lassify-maestro-failures.mjs", CLAIMED],
    ["a negated bracket", "scripts/[!x]lassify-maestro-failures.mjs", CLAIMED],
    ["a caret-negated bracket", "[^x]cripts/classify-*", CLAIMED],
    ["a character class", "scripts/[[:lower:]]lassify-*", CLAIMED],
    ["a range", "scripts/[a-d]lassify-*", CLAIMED],
    ["an escaped ordinary character", "scripts/classify\\-maestro-*", CLAIMED],
    ["a basename glob", "classify-*.mjs", CLAIMED],
    ["a bracket that excludes the character", "scripts/[!c]lassify-*", REFUSED],
    ["a bracket without the character", "scripts/[xyz]lassify-*", REFUSED],
    ["a range without the character", "scripts/[d-z]lassify-*", REFUSED],
    ["an escaped star, which is literal", "scripts/\\*", REFUSED],
    [
      "an unterminated bracket, which is literal",
      "scripts/[classify*",
      REFUSED,
    ],
    ["a trailing backslash, which matches nothing", "scripts/*\\", REFUSED],
    ["a dot, which is not any character", "scripts.classify-*", REFUSED],
    ["a plus, which is not repetition", "scripts/cl+assify-*", REFUSED],
    ["an alternation bar", "nothing|scripts/*", REFUSED],
    ["a group", "scripts/(classify)-*", REFUSED],
    ["a leading caret", "^scripts/*", REFUSED],
    ["a trailing dollar", "scripts/*.mjs$", REFUSED],
    ["an interval", "scripts/c{1}lassify-*", REFUSED],
    // The shell reads a second dash after a range as a literal, where an ERE
    // would reject `x-z-c` outright; the `c` must still be a member.
    ["a dash straight after a range", "scripts/[x-z-c]lassify-*", CLAIMED],
    ["a range followed by more members", "scripts/[a-c-e]lassify-*", CLAIMED],
    // An unterminated `[:` opens no class: the shell drops its `[` and keeps
    // the rest, where an ERE would reject the bracket outright.
    ["an unterminated class opener", "scripts/[[:c]lassify-*", CLAIMED],
    ["an unterminated class opener alone", "scripts/[[:]lassify-*", REFUSED],
  ])("%s", (_label, line, expected) => {
    writeFileSync(path.join(project, ".lisaignore"), `${line}\n`, "utf8");
    expect(verdict(guard)).toBe(expected);
  });

  it.each([
    ["a name with a space, exactly", SPACED, "scripts/with space.mjs", CLAIMED],
    ["a name with a space, by glob", SPACED, "scripts/with *.mjs", CLAIMED],
    ["a name with a space, by basename", SPACED, "with space.mjs", CLAIMED],
    ["a space the name lacks", SPACED, "scripts/with  space.mjs", REFUSED],
    ["a non-ASCII name, exactly", ACCENTED, "scripts/café.mjs", CLAIMED],
    ["a non-ASCII name, by glob", ACCENTED, "scripts/caf*.mjs", CLAIMED],
    [
      "a non-ASCII letter the name lacks",
      ACCENTED,
      "scripts/cafe.mjs",
      REFUSED,
    ],
  ])("%s", (_label, target, line, expected) => {
    writeFileSync(path.join(project, ".lisaignore"), `${line}\n`, "utf8");
    expect(verdict(guard, target)).toBe(expected);
  });
});
