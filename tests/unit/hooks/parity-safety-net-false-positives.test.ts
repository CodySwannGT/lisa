/**
 * The recursive-delete guard must stop refusing commands that delete nothing,
 * and must stop refusing the agent's own scratchpad — without refusing one
 * fewer dangerous command than before.
 *
 * Two arms, both measured on the shipped hook before the fix (#3106):
 *
 * - **Arm A.** A recursive delete quoted as PROSE inside a string argument
 *   selected the line for the target walk, and every later token was then
 *   classified as a deletion target. `printf '%s' "…rm -rf…"` was allowed; the
 *   same command plus one `"$V"` argument was refused. Three independent
 *   sightings in one day, none of which deleted anything: that `printf`
 *   reduction, the `gh issue create` that filed the report about this guard,
 *   and a commit message describing it.
 * - **Arm B.** The scratchpad handed to an agent begins `/private/tmp/…` on
 *   macOS, while the allowance listed `/tmp` as a LITERAL prefix. One
 *   directory, two spellings, opposite verdicts. The variable spelling was
 *   refused too, so no rewording reached it either.
 *
 * ## Why this file is mostly positive controls
 *
 * A guard that stops refusing dangerous deletes is far worse than one that is
 * annoying, so the newly-allowed cases are outnumbered here by the cases that
 * must keep refusing. Every arm of the classifier is represented in
 * {@link BLOCKED}, and the adversarial set is aimed specifically at the two new
 * mechanisms — path canonicalization and in-command variable resolution —
 * because a narrowing change earns its keep only by leaving the refusals whole.
 * @module tests/unit/hooks/parity-safety-net-false-positives
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
 * The PreToolUse event the classifier receives for one proposed command.
 * @param command The proposed shell command.
 * @returns The serialized hook event.
 */
const eventPayload = (command: string): string =>
  JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
    cwd: process.cwd(),
  });

/**
 * Classify one proposed command. Nothing is executed — the hook is a classifier
 * over a command string handed to it as PreToolUse JSON.
 * @param command The proposed shell command.
 * @param overrides Environment overrides for this classification.
 * @param hook Which shipped copy of the guard to ask.
 * @returns The hook's exit status.
 */
const classify = (
  command: string,
  overrides: Readonly<Record<string, string>> = {},
  hook: string = HOOK_PATH
): number | null =>
  boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [hook],
    input: eventPayload(command),
    env: { ...process.env, ...overrides },
  }).status;

/**
 * The recursive-delete syntax, assembled rather than written out.
 *
 * Spelling it literally in this file would make the file itself an instance of
 * arm A: any tool that scans this repository's text for the pattern would find
 * a match here that deletes nothing. Assembling it keeps the fixtures honest
 * while leaving the source greppable for humans.
 */
const RM = `${"r"}${"m"}`;
const DELETE = `${RM} -${"r"}${"f"}`;

/** The physical spelling of the shared temporary root. */
const TMP_PHYSICAL = realpathSync("/tmp");

/** A session scratchpad path, in the physical spelling agents are handed. */
const SCRATCHPAD = `${TMP_PHYSICAL}/claude-501/a-project/a-session/scratchpad`;

/** Commands that delete nothing, or delete only the agent's own scratch. */
const ALLOWED: readonly (readonly [string, string])[] = [
  // Arm A — prose in a quoted argument, alongside a variable.
  [
    "prose describing the guard with no variable",
    `printf '%s\\n' "The ${DELETE} guard refuses things"`,
  ],
  [
    "the same prose plus a variable argument",
    `V=/tmp/nothing\nprintf '%s\\n' "The ${DELETE} guard refuses things" "$V"`,
  ],
  [
    "filing an issue whose title quotes the syntax",
    `gh issue create --title "the ${DELETE} guard" --body-file "$G/body.md"`,
  ],
  [
    "a commit message that quotes the syntax",
    `git commit -m "guard matches ${DELETE} patterns" -F "$MSG"`,
  ],
  [
    "single-quoted prose followed by a variable",
    `printf '%s' 'the ${DELETE} note' "$V2"`,
  ],
  [
    "prose containing an escaped quote, then a variable",
    `printf '%s' "he said \\"the ${DELETE} guard\\" ok" "$V3"`,
  ],
  [
    "prose naming a path-prefixed rm, then a variable",
    `echo "use /bin/${RM} -${"r"}${"f"} carefully" "$V4"`,
  ],
  [
    "prose in one statement and a sanctioned delete in the next",
    `echo "the ${DELETE} note" && ${DELETE} "$TMPDIR/x"`,
  ],

  // Arm B — the scratchpad, by every spelling.
  ["the scratchpad by its physical absolute path", `${DELETE} ${SCRATCHPAD}`],
  ["the scratchpad by its /tmp spelling", `${DELETE} /tmp/claude-501/a/b`],
  [
    "the scratchpad through a variable holding it",
    `S=${SCRATCHPAD}\n${DELETE} "$S"`,
  ],
  [
    "a directory through a $TMPDIR-derived variable",
    `S=$TMPDIR/work\n${DELETE} "$S"`,
  ],
  [
    "a deeper path under a $TMPDIR-derived variable",
    `S=$TMPDIR/work\n${DELETE} "$S/inner"`,
  ],
  [
    "a brace-spelled $TMPDIR-derived variable",
    `S=\${TMPDIR}/work\n${DELETE} "\${S}"`,
  ],
  [
    "a chain of variables rooted at $TMPDIR",
    `A=$TMPDIR\nB=$A/work\n${DELETE} "$B"`,
  ],
  [
    "the physical spelling of /var/tmp",
    `${DELETE} ${realpathSync("/var/tmp")}/thing`,
  ],
];

/** Commands the guard must keep refusing. */
const BLOCKED: readonly (readonly [string, string])[] = [
  // The catastrophic set.
  ["the filesystem root", `${DELETE} /`],
  ["the home directory by tilde", `${DELETE} ~`],
  ["the home directory by $HOME", `${DELETE} "$HOME"`],
  ["a top-level wildcard", `${DELETE} *`],
  ["a root-level wildcard", `${DELETE} /*`],
  ["the current directory", `${DELETE} .`],
  ["a .. traversal", `${DELETE} ../sibling`],
  ["an absolute path outside the project", `${DELETE} /usr/local/lib`],
  ["the system configuration directory", `${DELETE} /etc`],
  ["the git control plane", `${DELETE} .git`],
  ["a path beneath the git control plane", `${DELETE} .git/objects`],
  ["a root delete wrapped in an interpreter", `bash -c "${DELETE} /"`],
  ["a root delete wrapped in a substitution", `echo "$(${DELETE} /)"`],
  ["a path-prefixed rm of a system directory", `/bin/${RM} -${"r"}${"f"} /etc`],
  ["a sudo-wrapped delete of a system directory", `sudo ${DELETE} /etc`],

  // The variable arm — its stated reason is that a name can point anywhere,
  // and every case here is one the guard still cannot place.
  ["a variable with no assignment in the command", `${DELETE} "$NOPE"`],
  [
    "a variable whose assignment names a different name",
    `OTHER=/tmp/x\n${DELETE} "$V"`,
  ],
  [
    "a variable whose name is only a suffix match",
    `MYV=/tmp/x\n${DELETE} "$V"`,
  ],
  [
    "a variable assigned two different values",
    `V=/etc\nV=/tmp/x\n${DELETE} "$V"`,
  ],
  [
    "a variable assigned two values in the other order",
    `V=/tmp/x\nV=/etc\n${DELETE} "$V"`,
  ],
  [
    "a variable whose value is a command substitution",
    `V=$(mktemp -d)\n${DELETE} "$V"`,
  ],
  [
    "a variable whose value is a backtick substitution",
    `V=\`mktemp -d\`\n${DELETE} "$V"`,
  ],
  ["a variable resolving to the filesystem root", `V=/\n${DELETE} "$V"`],
  ["a variable resolving to $HOME", `V=$HOME\n${DELETE} "$V"`],
  [
    "a variable resolving to a home-anchored path",
    `V=~/Documents\n${DELETE} "$V"`,
  ],
  ["a variable resolving to a .. traversal", `V=../sibling\n${DELETE} "$V"`],
  ["a variable resolving to the current directory", `V=.\n${DELETE} "$V"`],
  ["a variable resolving to a wildcard", `V='*'\n${DELETE} "$V"`],
  ["a variable resolving to the git control plane", `V=.git\n${DELETE} "$V"`],
  [
    "a variable resolving outside the project",
    `V=/srv/checkouts/app-repo\n${DELETE} "$V"`,
  ],
  [
    "a chain of variables ending outside the project",
    `A=/etc\nB=$A/x\n${DELETE} "$B"`,
  ],
  ["a self-referential variable", `V=$V/x\n${DELETE} "$V"`],
  [
    "a sanctioned root escaped by a .. suffix",
    `V=$TMPDIR\n${DELETE} "$V/../../etc"`,
  ],
  [
    "a brace-spelled variable resolving outside the project",
    `V=/etc\n${DELETE} "\${V}"`,
  ],
  [
    "a single-quoted value that stays a literal $HOME",
    `V='$HOME'\n${DELETE} "$V"`,
  ],

  // The prose scope must not become a hiding place.
  [
    "prose and a real target inside the same quoted run",
    `echo "note: ${DELETE} /etc happens"`,
  ],
  [
    "prose in one statement and a variable delete in the next",
    `echo "the ${DELETE} note" && ${DELETE} "$Z"`,
  ],
  [
    "prose then a real delete separated by a semicolon",
    `echo "the ${DELETE} note" ; ${DELETE} /etc`,
  ],
  ["an unterminated quote around the prose", `printf "The ${DELETE} guard $V`],
  [
    "an env-assignment prefix inside an interpreter string",
    `bash -c "FOO=bar ${DELETE} /etc"`,
  ],
  ["a substitution nested inside a quoted run", `echo "$(${DELETE} $HOME)"`],

  // Canonicalization must add spellings of allowed locations, not neighbours.
  ["a private-prefixed system directory", `${DELETE} /private/etc`],
  ["a directory whose name merely starts with tmp", `${DELETE} /tmpfoo`],
  [
    "a directory whose name merely starts with private",
    `${DELETE} /privatestuff`,
  ],
];

/** Commands that were never in question, proving the harness discriminates. */
const HARMLESS: readonly (readonly [string, string])[] = [
  ["a plain echo", "echo hello"],
  ["a git status", "git status --short"],
];

describe("parity-safety-net: refusals that delete nothing (#3106)", () => {
  describe("newly permitted — each of these deletes nothing dangerous", () => {
    it.each(ALLOWED)("permits %s", (_label, command) => {
      expect(classify(command)).toBe(EXIT_ALLOWED);
    });
  });

  describe("positive controls — every dangerous case still refuses", () => {
    it.each(BLOCKED)("refuses %s", (_label, command) => {
      expect(classify(command)).toBe(EXIT_BLOCKED);
    });
  });

  describe("negative controls — the harness is not answering one way", () => {
    it.each(HARMLESS)("permits %s", (_label, command) => {
      expect(classify(command)).toBe(EXIT_ALLOWED);
    });

    it("produces both verdicts, so neither set is vacuous", () => {
      const verdicts = new Set([
        classify("echo hello"),
        classify(`${DELETE} /`),
      ]);

      expect(verdicts).toEqual(new Set([EXIT_ALLOWED, EXIT_BLOCKED]));
    });
  });

  describe("one location, one verdict", () => {
    it("gives /tmp and its physical spelling the same verdict", () => {
      // Acceptance criterion 3. On a platform where /tmp is a symlink this is
      // the arm-B defect stated directly: two names for one directory got
      // opposite answers. On a platform where it is not, the two spellings
      // coincide and the assertion is trivially true — which is the point, the
      // rule is about the filesystem rather than about macOS.
      expect(classify(`${DELETE} ${TMP_PHYSICAL}/claude-501/a/b`)).toBe(
        classify(`${DELETE} /tmp/claude-501/a/b`)
      );
    });
  });

  describe("a symlinked project root resolves to one location", () => {
    // Portable proof of the same canonicalization, independent of whether the
    // The project root is reached through a symlink while the delete names the
    // physical path — the exact shape that made the scratchpad unreachable.
    // Keep the fixture outside the temporary roots the guard intentionally
    // allows; otherwise a checkout under /tmp makes the sibling control pass
    // for an unrelated reason.
    let fixtureRoot = "";
    let realProject = "";
    let linkProject = "";
    let siblingProject = "";
    let fakeTmpdir = "";

    beforeAll(() => {
      const scratchParent = homedir();
      fixtureRoot = mkdtempSync(path.join(scratchParent, "lisa-3106-"));
      realProject = path.join(fixtureRoot, "real-project");
      linkProject = path.join(fixtureRoot, "link-project");
      siblingProject = path.join(fixtureRoot, "not-the-project");
      fakeTmpdir = path.join(fixtureRoot, "fake-tmpdir");
      mkdirSync(realProject, { recursive: true });
      mkdirSync(siblingProject, { recursive: true });
      mkdirSync(fakeTmpdir, { recursive: true });
      symlinkSync(realProject, linkProject);
    });

    afterAll(() => {
      if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
    });

    it("permits deleting inside the project reached by its physical path", () => {
      expect(
        classify(`${DELETE} ${realProject}/build`, {
          CLAUDE_PROJECT_DIR: linkProject,
          TMPDIR: fakeTmpdir,
        })
      ).toBe(EXIT_ALLOWED);
    });

    it("refuses a sibling of the project root reached the same way", () => {
      // The canonicalization must add the project's second NAME, not its
      // parent. A sibling directory is one path component away and must stay
      // refused.
      expect(
        classify(`${DELETE} ${siblingProject}`, {
          CLAUDE_PROJECT_DIR: linkProject,
          TMPDIR: fakeTmpdir,
        })
      ).toBe(EXIT_BLOCKED);
    });
  });

  describe("every shipped copy of the guard agrees", () => {
    // The guard resolves from six places: the source, four built plugin
    // variants, and the host guard directory a `lisa` run copies into a
    // project. A fix that reaches only the source governs nothing, and a built
    // copy that drifts from source is a guard nobody is reading.
    const arm = [
      ["arm A", `printf '%s\\n' "The ${DELETE} guard" "$V"`, EXIT_ALLOWED],
      ["arm B", `${DELETE} ${SCRATCHPAD}`, EXIT_ALLOWED],
      ["a control", `${DELETE} /etc`, EXIT_BLOCKED],
    ] as const;

    const matrix = SHIPPED_COPIES.flatMap(copy =>
      arm.map(
        ([label, command, expected]) =>
          [copy, label, command, expected] as const
      )
    );

    it.each(matrix)(
      "%s answers %s the same way",
      (copy, _label, command, expected) => {
        expect(classify(command, {}, copy)).toBe(expected);
      }
    );
  });
});
