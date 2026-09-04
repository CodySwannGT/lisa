/**
 * `block-direct-issue-create.sh` must not attribute a FILE's contents to a
 * command that merely NAMES it.
 *
 * The guard was taught to reach past argv, and it reached too far: it opened
 * any readable file any token named, then justified a refusal from that file's
 * text rather than from the command's behaviour. Read-only commands were
 * refused for naming a path — `git diff`, `grep -n`, `wc -l`, a `git grep`
 * PATHSPEC, and a test run. Refusing the test run is the worst of them: it can
 * prevent verification of a fix while reporting nothing about why.
 *
 * ## Provenance of these cases, which is not uniform
 *
 * The concrete refusals that motivated this suite were observed against the
 * guard EXECUTING on the developer machine, which is several minor versions
 * behind the source in this repository. A refusal observed there is evidence
 * about that older build, not about this one.
 *
 * So the defect is established from the SOURCE instead, and it is unambiguous
 * there: `file_operands` offered every token and its own docstring said
 * "Deciding WHICH programs execute their operands is the unbounded question
 * this file already refuses to ask, so it is not asked here either." The
 * observed refusals are illustrations of a defect read from current source,
 * never the specification for it.
 *
 * The rule restored here is already written down in the same directory, and
 * this guard was the one that declined to apply it — `parity-safety-net.sh`
 * (lines 337-346 and 704-705 at the time of writing): "Only a COMMAND POSITION
 * can execute something. A path anywhere else is an argument, and an argument
 * is data." `block-no-verify.sh`'s `strip_command_prefix` implements the same
 * split with a fail-closed third state.
 *
 * Every acceptance case below is paired with a rejection control, and the
 * controls are this suite's own rather than borrowed: the reach that #3484
 * added must survive intact, so an executed script, a non-shell interpreter,
 * and a request payload in a file all still have to be refused.
 * @module tests/unit/hooks/block-direct-issue-create-data-paths
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

/** A Linear-tracked project, whose build-ready role is a workflow state. */
const LINEAR_CONFIG = {
  tracker: "linear",
  linear: { workflow: { ready: "Ready" } },
};

/** The GraphQL body a hand-rolled Linear creation submits. */
const MUTATION =
  '{"query":"mutation{issueCreate(input:{title:\\"x\\"}){success}}"}';

const project = projectWithTracker(LINEAR_CONFIG);

/**
 * Write a fixture into the throwaway project.
 * @param name - The file name.
 * @param body - The contents.
 * @returns The absolute path written.
 */
const fixture = (name: string, body: string): string => {
  const target = path.join(project, name);
  writeFileSync(target, body, "utf-8");
  return target;
};

/**
 * Drive the guard with one shell command against the fixture project.
 * @param command - The command an agent is attempting.
 * @returns The exit status; 2 means refused.
 */
const run = (command: string): number | null =>
  runHook(bash(command), { cwd: project, env: { CLAUDE_PROJECT_DIR: project } })
    .status;

/** A script that really does file an issue. Executing it must still refuse. */
const CREATE_SCRIPT = fixture(
  "create.sh",
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "curl -sS -X POST https://api.linear.app/graphql \\",
    `  -d '${MUTATION}'`,
    "",
  ].join("\n")
);

/** A JS client that speaks HTTP directly — no shell anywhere in it. */
const CREATE_WRAPPER = fixture(
  "wrapper.mjs",
  [
    "const endpoint = 'https://api.linear.app/graphql';",
    "const query = 'mutation { issueCreate(input: {}) { success } }';",
    "await fetch(endpoint, { method: 'POST', body: JSON.stringify({ query }) });",
    "",
  ].join("\n")
);

/** A request body in a file, which the payload flags legitimately read. */
const PAYLOAD = fixture("payload.json", MUTATION);

/**
 * A file that does NOT lex as shell and whose prose reads as a creation.
 *
 * This is the exact shape behind the observed refusals: the guard opened a
 * guard's own source, `shlex` raised on an apostrophe in its prose, and the
 * unparseable-fallback recogniser then matched the documentation. Hence the
 * refusal text "an unparseable command that reads as a tracker creation inside
 * <file>" for commands that were only reading.
 */
const DOC_FILE = fixture(
  "guard-docs.sh",
  [
    "#!/usr/bin/env bash",
    "# This guard refuses `gh issue create --title x` when it isn't declared.",
    "# Don't file that way — it's an incomplete handoff.",
    "",
  ].join("\n")
);

describe("block-direct-issue-create.sh data paths", () => {
  describe("allows a read-only command that only NAMES a tainted file", () => {
    // Each command names a file that genuinely contains a creation, and each
    // one only reads it. The path is an argument, and an argument is data.
    it.each([
      ["grep -n", `grep -n curl ${CREATE_SCRIPT}`],
      ["wc -l", `wc -l ${CREATE_SCRIPT}`],
      ["cat", `cat ${CREATE_SCRIPT}`],
      ["git diff", `git diff ${CREATE_SCRIPT}`],
      ["a git grep pathspec", `git grep -n curl -- ${CREATE_SCRIPT}`],
      ["a test run", `vitest ${CREATE_SCRIPT}`],
      ["a line-range read", `sed -n '1,50p' ${CREATE_SCRIPT}`],
      ["head", `head -50 ${CREATE_SCRIPT}`],
      ["shellcheck", `shellcheck ${CREATE_SCRIPT}`],
      ["a diff of two tainted files", `diff ${CREATE_SCRIPT} ${DOC_FILE}`],
    ])("allows %s", (_label, command) => {
      expect(run(command)).toBe(EXIT_ALLOWED);
    });

    it("allows reading a file whose PROSE reads as a creation", () => {
      // The unparseable-fallback case. The file does not lex as shell and its
      // comments discuss filing; reading it is still reading.
      expect(run(`wc -l ${DOC_FILE}`)).toBe(EXIT_ALLOWED);
    });

    it("allows naming several tainted files at once", () => {
      expect(run(`wc -l ${CREATE_SCRIPT} ${DOC_FILE} ${CREATE_WRAPPER}`)).toBe(
        EXIT_ALLOWED
      );
    });

    it("allows a recursive search over a directory of guards", () => {
      // A control that passed before this change too: a directory is not a
      // readable regular file, so it was never opened. Kept so a future fix
      // that starts walking directories is caught.
      expect(run(`grep -rn issueCreate ${project}/`)).toBe(EXIT_ALLOWED);
    });

    it("allows a body-file that merely quotes a path", () => {
      const body = fixture(
        "report.md",
        `See \`${CREATE_SCRIPT}\` for the reproduction.\n`
      );
      expect(run(`gh pr create --body-file ${body}`)).toBe(EXIT_ALLOWED);
    });
  });

  describe("still refuses a creation the command actually runs", () => {
    // The reach added for #3484 has to survive intact. Without these controls
    // this suite is satisfied by a guard that allows everything, which is the
    // failure mode that produced the fail-open in the first place.
    it.each([
      ["an executed script", `bash ${CREATE_SCRIPT}`],
      ["sh", `sh ${CREATE_SCRIPT}`],
      ["source", `source ${CREATE_SCRIPT}`],
      ["the dot builtin", `. ${CREATE_SCRIPT}`],
      ["an absolute interpreter path", `/bin/bash ${CREATE_SCRIPT}`],
      ["stdin redirection", `bash < ${CREATE_SCRIPT}`],
      ["a wrapper with its own operand", `nice -n 5 bash ${CREATE_SCRIPT}`],
      ["a timeout wrapper", `timeout 5 bash ${CREATE_SCRIPT}`],
      ["an env prefix", `env bash ${CREATE_SCRIPT}`],
      ["a non-shell interpreter", `node ${CREATE_WRAPPER}`],
    ])("refuses %s", (_label, command) => {
      expect(run(command)).toBe(EXIT_BLOCKED);
    });

    it("refuses an inline creation that declares nothing", () => {
      expect(run('gh issue create --title "x"')).toBe(EXIT_BLOCKED);
    });

    it("refuses a creation whose payload lives in a file", () => {
      // Read by flag NAME through the payload path, which this change does not
      // touch — narrowing the executed-file walk must not blind the guard to a
      // request body.
      expect(
        run(
          `curl -sS -X POST https://api.linear.app/graphql --data-binary @${PAYLOAD}`
        )
      ).toBe(EXIT_BLOCKED);
    });

    it("refuses a nested shell payload", () => {
      expect(run(`bash -c 'gh issue create --title "x"'`)).toBe(EXIT_BLOCKED);
    });
  });

  describe("still allows what it correctly allowed before", () => {
    it("allows a declared creation", () => {
      expect(
        run('gh issue create --title "x" --label status:ready --repo o/r')
      ).toBe(EXIT_ALLOWED);
    });

    it("allows an update, which is not a creation", () => {
      expect(
        run(
          `curl -sS -X POST https://api.linear.app/graphql -d '{"query":"mutation{issueUpdate(input:{}){success}}"}'`
        )
      ).toBe(EXIT_ALLOWED);
    });
  });

  describe("derives the refusal from the command, not from a named file", () => {
    it("names the executed script when it refuses one", () => {
      const { stderr } = runHook(bash(`bash ${CREATE_SCRIPT}`), {
        cwd: project,
        env: { CLAUDE_PROJECT_DIR: project },
      });
      expect(stderr).toContain(CREATE_SCRIPT);
    });

    it("does not cite a merely-named file in any refusal", () => {
      // Collect every offender and report them together. Asserting inside the
      // loop would stop at the first, proving one case while claiming ten.
      const readOnly = [
        `grep -n curl ${CREATE_SCRIPT}`,
        `wc -l ${CREATE_SCRIPT}`,
        `git diff ${CREATE_SCRIPT}`,
        `vitest ${CREATE_SCRIPT}`,
        `sed -n '1,50p' ${DOC_FILE}`,
      ];
      const offenders = readOnly.filter(
        command =>
          runHook(bash(command), {
            cwd: project,
            env: { CLAUDE_PROJECT_DIR: project },
          }).status === EXIT_BLOCKED
      );
      expect(offenders).toEqual([]);
    });
  });
});
