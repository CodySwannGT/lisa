/**
 * The commands a hook line runs where the reader used to see none
 * (CodySwannGT/lisa#4994, on the reader of CodySwannGT/lisa#5000).
 *
 * `lisa controls reconcile` says a hook runs nothing the register does not
 * declare only when it can see every command the hook runs. A command
 * written inside another one, or behind a word that was taken for the whole
 * line, was passed over, and the run said "in step". Each case here is one
 * such line.
 */
import { describe, expect, it } from "vitest";

import {
  readShellHook,
  type ShellCommand,
} from "../../../src/controls/reconcile-hook-lines.js";

const LINT = "npm run lint";
const RUFF = "ruff check .";
const ESLINT = "npx eslint .";
const TESTS = "npm test";

/**
 * Read a hook that is expected to be readable.
 * @param lines - The hook, one item per line
 * @returns The commands it runs
 */
function commands(lines: readonly string[]): readonly ShellCommand[] {
  const read = readShellHook(lines.join("\n"));
  if (read.problem !== null) throw new Error(read.problem);
  return read.commands;
}

/**
 * The commands of a hook, as text.
 * @param lines - The hook, one item per line
 * @returns Each command as it is reported
 */
function texts(lines: readonly string[]): readonly string[] {
  return commands(lines).map(command => command.command);
}

describe("a command the shell runs inside another command", () => {
  it("reads the command a setting is filled from", () => {
    expect(
      commands([`OUTPUT=$(${ESLINT} 2>&1) || { echo "$OUTPUT"; exit 1; }`])
    ).toEqual([{ command: ESLINT, line: 1, words: ["npx", "eslint", "."] }]);
    expect(texts(["STAGED=$(git diff --cached --name-only)"])).toEqual([
      "git diff --cached --name-only",
    ]);
  });

  it("reads the command a condition captures, in either spelling", () => {
    expect(
      texts([`if ! out=$(${TESTS}); then`, `if ! out=\`${TESTS}\`; then`])
    ).toEqual([TESTS, TESTS]);
  });

  it.each([
    [`echo "$(${ESLINT})"`],
    [`export REPORT="$(${ESLINT})"`],
    [`[ -z "$(${ESLINT})" ] || exit 1`],
    [`[[ -z $(${ESLINT}) ]] || exit 1`],
    [`: "$(${ESLINT})"`],
    [`exit $(${ESLINT})`],
    [`read -r REPORT <<< "$(${ESLINT})"`],
    [`REPORT=$(printf %s "$(echo "$(${ESLINT})")")`],
    [`REPORT=\`echo \\\`${ESLINT}\\\`\``],
  ])("reads the command inside %s", line => {
    expect(texts([line])).toEqual([ESLINT]);
  });

  it("reports the command around a substitution as it is written, and the one inside it", () => {
    expect(commands([`$(npm bin)/eslint "$(git ls-files)"`])).toEqual([
      { command: "npm bin", line: 1, words: ["npm", "bin"] },
      {
        command: `$(npm bin)/eslint "$(git ls-files)"`,
        line: 1,
        words: ["$(npm bin)/eslint", "$(git ls-files)"],
      },
      { command: "git ls-files", line: 1, words: ["git", "ls-files"] },
    ]);
  });

  it("reads the command a file is made from on the fly", () => {
    expect(texts([`diff <(${ESLINT} -f json) expected.json`])).toEqual([
      `diff <(${ESLINT} -f json) expected.json`,
      `${ESLINT} -f json`,
    ]);
  });

  it.each([
    [`echo '$(${ESLINT})'`],
    [String.raw`echo \$(date)`],
    ["count=$((1 + 2))"],
    [`echo done # then $(${ESLINT})`],
  ])("does not take %s for a command that runs", line => {
    expect(texts([line])).toEqual([]);
  });

  it.each([
    [`count=$(( $(${ESLINT}) + 0 ))`],
    [`count=$(( 1 + $(( $(${ESLINT}) )) ))`],
    [`(( $(${ESLINT}) > 0 )) && exit 1`],
    [`echo "\${REPORT:-$(${ESLINT})}"`],
  ])("reads the command inside the sum or the setting in %s", line => {
    expect(texts([line])).toEqual([ESLINT]);
  });

  it("still does not report the line that starts Husky, or what it finds its own folder with", () => {
    expect(texts(['. "$(dirname -- "$0")/_/husky.sh"', LINT])).toEqual([LINT]);
  });
});

describe("a command behind a word that used to hide it", () => {
  it("reads the command after `command`, and still takes `command -v` for a test", () => {
    expect(
      texts([
        `command ${TESTS}`,
        `command -p ${TESTS}`,
        `command -- ${TESTS}`,
        "command -v node >/dev/null 2>&1",
        "command -V node",
        "command -pv node",
      ])
    ).toEqual([TESTS, TESTS, TESTS]);
  });

  it("reads the arms of a case written on one line", () => {
    expect(texts([`case "$1" in *.py) ${RUFF} ;; esac`])).toEqual([RUFF]);
    expect(
      texts([
        `case "$1" in *.py|*.pyi) ${RUFF} ;; *.js) ${ESLINT} ;; *) ;; esac`,
      ])
    ).toEqual([RUFF, ESLINT]);
    expect(texts([`if true; then case $x in a) ${LINT};; esac; fi`])).toEqual([
      LINT,
    ]);
  });

  it("reads the body of a function written on one line", () => {
    expect(
      texts([
        `check() { ${LINT}; }`,
        `check () { ${LINT}; }`,
        `function check { ${LINT}; }`,
        `function check() { ${LINT}; }`,
        "check() {",
      ])
    ).toEqual([LINT, LINT, LINT, LINT]);
  });

  it("reads what a trap is set to run", () => {
    expect(
      texts([
        "trap 'npm run cleanup' EXIT",
        'trap "rm -f $(mktemp)" EXIT INT',
        "trap - EXIT",
        "trap '' INT",
        "trap -p",
      ])
    ).toEqual(["npm run cleanup", "rm -f $(mktemp)", "mktemp"]);
  });
});
