/**
 * Reading the commands out of a hook's text (CodySwannGT/lisa#5000).
 *
 * `lisa controls reconcile` reports every command a hook runs that no
 * register entry declares. What it reports is only as good as this reader:
 * a line of shell structure reported as a command floods the operator, and
 * a command that is missed is a control nobody knows about. The reader never
 * runs anything; it is given text and returns text.
 */
import { describe, expect, it } from "vitest";

import {
  carrierCall,
  carrierMarkers,
  carrierScript,
} from "../../../src/controls/carrier-script.js";
import {
  readShellHook,
  type ShellCommand,
} from "../../../src/controls/reconcile-hook-lines.js";

const SHEBANG = "#!/bin/sh";
const LINT = "npm run lint";
const RUFF = "ruff check .";

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

describe("the commands a shell hook runs", () => {
  it("reports each command with the line it is on", () => {
    expect(commands([SHEBANG, "", LINT, RUFF])).toEqual([
      { command: LINT, line: 3, words: ["npm", "run", "lint"] },
      { command: RUFF, line: 4, words: ["ruff", "check", "."] },
    ]);
  });

  it("does not report comments, blank lines or the first line", () => {
    expect(texts([SHEBANG, "# npm run lint", "   ", "  # indented"])).toEqual(
      []
    );
  });

  it("does not report lines that only steer the shell", () => {
    expect(
      texts([
        "set -e",
        "export CI=1",
        "STAGED=staged.txt",
        "cd web",
        'if [ -f "package.json" ]; then',
        "fi",
        'echo "checking"',
        "exit 0",
        "check() {",
        "}",
        "command -v node >/dev/null 2>&1",
      ])
    ).toEqual([]);
  });

  it("finds the command behind the words shell puts in front of it", () => {
    expect(
      texts([
        `if ! ${LINT}; then`,
        "  exit 1",
        "fi",
        "CI=1 npm test",
        "exec ruff check .",
      ])
    ).toEqual([LINT, "npm test", RUFF]);
  });

  it("reports each command of a line that chains several", () => {
    expect(commands([`cd web && ${LINT} || exit 1; npm test`])).toEqual([
      { command: LINT, line: 1, words: ["npm", "run", "lint"] },
      { command: "npm test", line: 1, words: ["npm", "test"] },
    ]);
  });

  it("keeps a quoted argument whole, separators and all", () => {
    expect(commands([`sh -c "a && b" 'c d'`])).toEqual([
      {
        command: `sh -c "a && b" 'c d'`,
        line: 1,
        words: ["sh", "-c", "a && b", "c d"],
      },
    ]);
  });

  it("reads a command continued over several lines as one", () => {
    expect(commands([SHEBANG, "ruff check \\", "  src \\", "  tests"])).toEqual(
      [
        {
          command: "ruff check   src   tests",
          line: 2,
          words: ["ruff", "check", "src", "tests"],
        },
      ]
    );
  });

  it("leaves a comment at the end of a line out of the command", () => {
    expect(texts(["npm test # the quick ones"])).toEqual(["npm test"]);
  });

  it("reads the command after a case label", () => {
    expect(texts(['case "$1" in', "  *.py) ruff check . ;;", "esac"])).toEqual([
      RUFF,
    ]);
  });

  it("reports a call to a script as that call", () => {
    expect(
      texts(["./scripts/secret-scan.sh --staged", ". ./scripts/checks.sh"])
    ).toEqual(["./scripts/secret-scan.sh --staged", ". ./scripts/checks.sh"]);
  });

  it("does not report the line that starts Husky itself", () => {
    expect(texts(['. "$(dirname -- "$0")/_/husky.sh"', LINT])).toEqual([LINT]);
  });
});

describe("a command inside a group, a pipeline or a redirect", () => {
  it("reads the command inside braces", () => {
    expect(commands(["{ npm test; } || exit 1"])).toEqual([
      { command: "npm test", line: 1, words: ["npm", "test"] },
    ]);
  });

  it("reads the command inside a subshell, spaced or not", () => {
    expect(commands(["( npx eslint . )", "(npx eslint .)"])).toEqual([
      { command: "npx eslint .", line: 1, words: ["npx", "eslint", "."] },
      { command: "npx eslint .", line: 2, words: ["npx", "eslint", "."] },
    ]);
  });

  it("takes the closing bracket of a group off the command before it", () => {
    expect(commands([`( cd api && ${RUFF} )`, `(cd api && ${RUFF})`])).toEqual([
      { command: RUFF, line: 1, words: ["ruff", "check", "."] },
      { command: RUFF, line: 2, words: ["ruff", "check", "."] },
    ]);
  });

  it("reads a one-word command inside a subshell", () => {
    expect(texts(["(shellcheck)", "( shellcheck )"])).toEqual([
      "shellcheck",
      "shellcheck",
    ]);
  });

  it("reads a group that spans several lines", () => {
    expect(texts(["{", `  ${LINT}`, "}", "(", `  ${RUFF}`, ")"])).toEqual([
      LINT,
      RUFF,
    ]);
  });

  it("reads each command of a pipeline", () => {
    expect(commands([`${RUFF} | tee ruff.log`])).toEqual([
      { command: RUFF, line: 1, words: ["ruff", "check", "."] },
      { command: "tee ruff.log", line: 1, words: ["tee", "ruff.log"] },
    ]);
  });

  it("leaves a redirect out of the command's words", () => {
    expect(
      commands([
        "npx lint-staged 2>&1",
        `${RUFF} >/dev/null 2>&1`,
        `${LINT} > lint.log`,
        "npm test 2>> errors.log < /dev/null",
      ])
    ).toEqual([
      { command: "npx lint-staged", line: 1, words: ["npx", "lint-staged"] },
      { command: RUFF, line: 2, words: ["ruff", "check", "."] },
      { command: LINT, line: 3, words: ["npm", "run", "lint"] },
      { command: "npm test", line: 4, words: ["npm", "test"] },
    ]);
  });

  it("reads a command left running in the background", () => {
    expect(texts([`${LINT} &`, "wait"])).toEqual([LINT]);
  });

  it("does not take a pattern of a case label for a command", () => {
    expect(
      texts([
        'case "$1" in',
        `  *.py|*.pyi) ${RUFF} ;;`,
        "  *.md | *.txt)",
        "    ;;",
        "esac",
      ])
    ).toEqual([RUFF]);
  });

  it("does not take a test between double brackets for a command", () => {
    expect(
      texts([
        'if [[ "$branch" =~ ^(main|master)$ ]]; then',
        "fi",
        "[[ -f a.txt && -f b.txt ]] || exit 0",
      ])
    ).toEqual([]);
  });

  it("keeps a pipe inside a quote in its word, and reads a pipe inside a substitution as that substitution's own", () => {
    expect(
      commands(['grep -E "a|b" notes.txt', "CHANGED=$(git diff | wc -l)"])
    ).toEqual([
      {
        command: 'grep -E "a|b" notes.txt',
        line: 1,
        words: ["grep", "-E", "a|b", "notes.txt"],
      },
      { command: "git diff", line: 2, words: ["git", "diff"] },
      { command: "wc -l", line: 2, words: ["wc", "-l"] },
    ]);
  });
});

describe("a line that cannot be read as shell", () => {
  it("is read in bounded time when a quote holding many substitutions never closes", () => {
    const line = `echo "${"$(date) ".repeat(40)}`;
    const started = performance.now();

    const read = readShellHook([SHEBANG, line, LINT].join("\n"));

    expect(performance.now() - started).toBeLessThan(2000);
    expect(read).toMatchObject({ problem: null });
    expect(texts([SHEBANG, line, LINT])).toContain(LINT);
  });

  it("still reads a quote that holds an unfinished substitution", () => {
    expect(commands(['npm run "$(lint"'])).toEqual([
      { command: 'npm run "$(lint"', line: 1, words: ["npm", "run", "$(lint"] },
    ]);
  });
});

describe("what Lisa wrote in a hook", () => {
  it("leaves out the marked lines that call the carrier", () => {
    const { begin, end } = carrierMarkers("commit");

    expect(
      commands([SHEBANG, LINT, "", begin, ...carrierCall("commit"), end])
    ).toEqual([{ command: LINT, line: 2, words: ["npm", "run", "lint"] }]);
  });

  it("finds nothing in a carrier script nobody added to", () => {
    const read = readShellHook(carrierScript("push"));

    expect(read).toMatchObject({ commands: [], problem: null });
  });

  it("reports a line added to a carrier script outside the markers", () => {
    expect(
      texts([...carrierScript("commit").split("\n"), "npm audit"])
    ).toEqual(["npm audit"]);
  });

  it("does not report a call to the carrier written by hand", () => {
    expect(
      texts([
        'sh .lisa/hooks/pre-commit "$@" || exit $?',
        "node scripts/lisa-run-gates.mjs --moment=commit --builtins=none",
      ])
    ).toEqual([]);
  });

  it("leaves out the block a Lisa project type manages, and says what it held", () => {
    const read = readShellHook(
      [
        "# BEGIN: AI GUARDRAILS",
        "gitleaks protect --staged",
        ". .husky/pre-push.local",
        "# END: AI GUARDRAILS",
        "npm run docs:check",
      ].join("\n")
    );

    expect(read).toEqual({
      commands: [
        {
          command: "npm run docs:check",
          line: 5,
          words: ["npm", "run", "docs:check"],
        },
      ],
      lisaText: "gitleaks protect --staged\n. .husky/pre-push.local",
      problem: null,
    });
  });

  it("refuses a hook whose markers cannot be trusted", () => {
    const { begin } = carrierMarkers("commit");

    const read = readShellHook([SHEBANG, begin, LINT].join("\n"));

    expect(read.problem).toContain(begin);
  });

  it("refuses a hook whose managed block never ends", () => {
    const read = readShellHook(["# BEGIN: AI GUARDRAILS", LINT].join("\n"));

    expect(read.problem).toContain("# END: AI GUARDRAILS");
  });
});
