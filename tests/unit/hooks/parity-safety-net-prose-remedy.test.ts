/**
 * The destructive-operation refusal must name a remedy that can be performed.
 *
 * The guard's false-positive class — a destructive command quoted as PROSE
 * inside a display command, with its target in the same quoted run — is known,
 * documented in the guard's own source, and deliberately accepted: upstream
 * exempts those through an engine-only DISPLAY_COMMANDS list a grep hook cannot
 * replicate, and the #3106 scoping explicitly does not reach it. This suite
 * does not contest that judgement and moves no verdict.
 *
 * What it pins is the MESSAGE. The refusal used to end in "narrow the command
 * so it no longer matches the guard", which this class cannot follow: when the
 * destructive text is a commit message, an issue body or a results table, the
 * string IS the deliverable and there is no narrower spelling that still says
 * what it must say. Measured on CodySwannGT/lisa#3191: three refusals in about
 * twenty minutes of one session — a memory index line, a results table in an
 * issue comment, and a commit body — each costing a detour that always
 * succeeded. A gate routed around every time teaches that being blocked is a
 * formality, and a printed remedy that cannot be performed is worse than none,
 * because an operator acts on it.
 *
 * The remedy that works was already in this file, one surface over: the sibling
 * heredoc refusal teaches "write the payload to a file with the Write tool,
 * then execute that file directly". The same shape carries the prose class —
 * write the text with the Write tool, pass it by path — because the guards scan
 * the COMMAND and never the file.
 *
 * ## Why the remedy appears on every refusal
 *
 * `block()` prints one shared text with two named branches, so a genuinely
 * executing delete sees the prose branch too. That is deliberate rather than
 * sloppy: the guard is a text scan and cannot tell the two apart, which is the
 * exact reason the message must name both and let the reader pick. The suite
 * therefore asserts the remedy is PRESENT on the prose class and asserts
 * nothing about its absence elsewhere.
 *
 * ## Bite evidence
 *
 * Per CodySwannGT/lisa#3111 a shell guard cannot be mutation-tested, so a
 * payload table with a control on BOTH sides is the only bite evidence
 * available, and per CodySwannGT/lisa#3190 a suite that exercises one side
 * proves nothing. Both sides are here: the eight genuinely-executing forms are
 * negative controls that must stay refused, and a harmless command must stay
 * permitted with no refusal text at all.
 * @module tests/unit/hooks/parity-safety-net-prose-remedy
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
 * Every one of these writes text and deletes nothing. They stay refused — this
 * ticket does not widen the matcher — but the refusal must now hand them a
 * remedy they can actually perform.
 */
const PROSE: readonly (readonly [string, string])[] = [
  [
    "a note appended to a memory file",
    `printf '%s\\n' 'the ${DELETE} / guard fires here' >> notes.md`,
  ],
  [
    "an issue comment quoting the syntax",
    `gh issue comment 1 --body 'the ${DELETE} / guard fires here'`,
  ],
  [
    "a commit message quoting the syntax",
    `git commit -m 'fix: stop allowing ${DELETE} / when grep errors'`,
  ],
  ["prose echoed to the terminal", `echo 'a note about ${DELETE} / in docs'`],
  [
    "a markdown results table written to a file",
    `echo '| ${DELETE} / | BLOCKED |' > table.md`,
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
      // The matcher is not being widened. Stated as an assertion so a later
      // change that quietly permits one of these is caught here.
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
