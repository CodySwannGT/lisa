/**
 * A refused prose command must name the working file-based remedy.
 *
 * Single literal printf/echo commands are recognized by the shared classifier
 * (#4106). Other command families retain the original scan, so issue bodies
 * and commit messages can still need --body-file or -F. Preserve that guidance
 * across shipped copies and retain the executing-command refusal controls.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** The BUILT hook, which is what consumers receive. */
const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");

/** Every shipped spelling of the same guard. All of them govern somewhere. */
const SHIPPED_COPIES: readonly string[] = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
  "plugins/lisa-agy/hooks/parity-safety-net.sh",
  "plugins/lisa-cursor/hooks/parity-safety-net.sh",
  "plugins/lisa-copilot/hooks/parity-safety-net.sh",
  "all/copy-overwrite/scripts/lisa-hooks/parity-safety-net.sh",
].map(relative => path.resolve(relative));

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

/**
 * The recursive-delete syntax, assembled rather than written out.
 *
 * Spelling it literally would make this file an instance of the very class it
 * describes: any tool scanning the repository's text would find a match here
 * that deletes nothing. Assembling keeps the fixtures honest while leaving the
 * source greppable for humans.
 */
const RM = `${"r"}${"m"}`;
const DELETE = `${RM} -${"r"}${"f"}`;

/** One classification: the hook's exit status and what it told the reader. */
interface Verdict {
  /** Exit status: 0 permitted, 2 refused. */
  readonly status: number | null;
  /** Everything the hook printed to stderr, which is what the model sees. */
  readonly stderr: string;
}

/**
 * Classify one proposed command. Nothing is executed — the hook is a classifier
 * over a command string handed to it as PreToolUse JSON.
 * @param command The proposed shell command.
 * @param hook Which shipped copy of the guard to ask.
 * @returns The hook's exit status and refusal text.
 */
const classify = (command: string, hook: string = HOOK_PATH): Verdict => {
  const outcome = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [hook],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: process.cwd(),
    }),
    env: process.env,
  });

  return { status: outcome.status, stderr: outcome.stderr ?? "" };
};

/**
 * The accepted false-positive class, as measured on CodySwannGT/lisa#3191.
 *
 * These command families remain outside the literal display grammar. Their
 * refusal must hand the operator a remedy they can perform.
 */
const PROSE: readonly (readonly [string, string])[] = [
  [
    "an issue comment quoting the syntax",
    `gh issue comment 1 --body 'the ${DELETE} / guard fires here'`,
  ],
  [
    "a commit message quoting the syntax",
    `git commit -m 'fix: stop allowing ${DELETE} / when grep errors'`,
  ],
];

/**
 * The eight genuinely-executing forms. These are the negative controls.
 *
 * This ticket changes a message. If any verdict here moves, the change is a
 * defect rather than a fix.
 */
const EXECUTING: readonly (readonly [string, string])[] = [
  ["a bare recursive delete of the root", `${DELETE} /`],
  ["a delete piped into an interpreter", `echo '${DELETE} /' | bash`],
  ["a delete handed to eval", `eval "${DELETE} /"`],
  ["a delete wrapped in bash -c", `bash -c "${DELETE} /"`],
  ["a delete wrapped in sh -c", `sh -c "${DELETE} /"`],
  ["a delete inside a subshell", `(${DELETE} /)`],
  ["a delete after a statement separator", `echo hi ; ${DELETE} /`],
  ["a delete driven by xargs", `echo / | xargs ${DELETE}`],
];

/** Fragments of the remedy the refusal must name. */
const REMEDY_FRAGMENTS: readonly string[] = [
  "Write tool",
  "--body-file",
  "git commit -F",
];

/** The advice this class cannot follow, which must no longer be printed. */
const IMPOSSIBLE_ADVICE = "narrow the command";

describe("parity-safety-net: the refusal names a workable remedy (#3191)", () => {
  describe("the accepted prose class keeps its verdict", () => {
    it.each(PROSE)("still refuses %s", (_label, command) => {
      // These are outside the single-printer grammar.
      expect(classify(command).status).toBe(EXIT_BLOCKED);
    });
  });

  describe("the accepted prose class is told the remedy that works", () => {
    it.each(PROSE)(
      "names writing the text to a file and passing it by path for %s",
      (_label, command) => {
        const { stderr } = classify(command);

        for (const fragment of REMEDY_FRAGMENTS) {
          expect(stderr).toContain(fragment);
        }
      }
    );

    it.each(PROSE)(
      "does not advise narrowing a command that cannot be narrowed for %s",
      (_label, command) => {
        expect(classify(command).stderr).not.toContain(IMPOSSIBLE_ADVICE);
      }
    );

    it("still says which kind of guard matched", () => {
      // The scan-failure path (#3054) distinguishes itself by NOT saying this,
      // and that discrimination only holds while the ordinary refusal does.
      expect(classify(`${DELETE} /`).stderr).toContain(
        "matched a destructive-operation guard"
      );
    });
  });

  describe("negative controls — no executing verdict moved", () => {
    it.each(EXECUTING)("still refuses %s", (_label, command) => {
      expect(classify(command).status).toBe(EXIT_BLOCKED);
    });
  });

  describe("both sides — the harness is not answering one way", () => {
    it("permits a harmless command and prints no refusal", () => {
      const { status, stderr } = classify("echo hello");

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).not.toContain("Blocked by safety-net");
    });

    it("produces both verdicts, so neither set is vacuous", () => {
      const verdicts = new Set([
        classify("git status --short").status,
        classify(`${DELETE} /`).status,
      ]);

      expect(verdicts).toEqual(new Set([EXIT_ALLOWED, EXIT_BLOCKED]));
    });
  });

  describe("every shipped copy carries the remedy", () => {
    // The guard resolves from six places: the source, four built plugin
    // variants, and the host guard directory a `lisa` run copies into a
    // project. A message fix that reaches only the source is a message nobody
    // is reading, and a built copy that drifts from source is a guard nobody
    // is reading either.
    it.each(SHIPPED_COPIES)("%s prints the remedy", copy => {
      const { status, stderr } = classify(PROSE[0]![1]!, copy);

      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("--body-file");
      expect(stderr).not.toContain(IMPOSSIBLE_ADVICE);
    });

    it.each(SHIPPED_COPIES)("%s still refuses an executing delete", copy => {
      expect(classify(`${DELETE} /`, copy).status).toBe(EXIT_BLOCKED);
    });
  });
});
