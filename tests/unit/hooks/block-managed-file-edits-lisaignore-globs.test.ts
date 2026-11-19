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

/**
 * Run one guard copy against a Write of the managed template.
 * @param guard - Repository-relative path of the guard copy
 * @returns Exit status; 2 means refused
 */
function verdict(guard: string): number {
  try {
    boundedExecFileSync({
      label: path.basename(guard),
      command: BASH,
      args: [path.join(REPO_ROOT, guard)],
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: MANAGED },
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
  ])("%s", (_label, line, expected) => {
    writeFileSync(path.join(project, ".lisaignore"), `${line}\n`, "utf8");
    expect(verdict(guard)).toBe(expected);
  });
});
