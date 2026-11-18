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
        "STAGED=$(git diff --cached --name-only)",
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
