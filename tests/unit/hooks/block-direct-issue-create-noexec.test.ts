/**
 * `bash -n` is the seam between reading a file and running it.
 *
 * Reach follows a path that sits at a COMMAND POSITION, which is right — but
 * `-n` is noexec: the shell reads and parses its operand and exits without
 * executing a line. So `bash -n <file>` is the one shape that puts a path at a
 * command position while provably running nothing, and the walk adjudicated it
 * anyway.
 *
 * ## It was wrong in both directions, and the silent one is worse
 *
 * Measured against `origin/main` before this change, on two files that differ
 * only by a human-gate marker:
 *
 *     REFUSE   bash -n <creation-shaped file>    false refusal
 *     ALLOW    bash -n <marker-bearing file>     false ALLOW
 *
 * One mechanism, opposite signs. The refusal is loud — an operator hits it and
 * says so. The allow is silent: a command that filed nothing was adjudicated
 * as *declared*, on the strength of a file it merely handed to a syntax check.
 * After the fix both answer ALLOW for the same reason — nothing executes — so
 * the asymmetry is gone rather than rebalanced.
 *
 * ## What this is NOT
 *
 * Not a read-only-command exemption. `bash <file>` still executes the file and
 * is still refused; every case below is paired with that control. The
 * distinction encoded here is *noexec*, not *which program*.
 *
 * The wider "reading a doc about filing is refused" defect this ticket opens
 * with no longer reproduces — `cat`, `head`, `wc`, `grep`, `stat` and `sed` on
 * a creation-shaped file are all allowed on current source, closed by the
 * command-position narrowing. Those rows are pinned here anyway so a future
 * widening of reach cannot quietly reintroduce them.
 * @module tests/unit/hooks/block-direct-issue-create-noexec
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

const project = projectWithTracker();

/** `it.each` titles, named because the same table shape recurs. */
const ALLOWS = "allows %s";
const REFUSES = "refuses %s";

/**
 * Write a fixture into the throwaway project.
 * @param name - The file name.
 * @param lines - The contents, one entry per line.
 * @returns The absolute path written.
 */
const fixture = (name: string, lines: readonly string[]): string => {
  const target = path.join(project, name);
  writeFileSync(target, `${lines.join("\n")}\n`, "utf-8");
  return target;
};

/**
 * A runbook DOCUMENTING the filing contract: creation-shaped, no marker.
 *
 * The example sits in a FENCED block, unbackticked, which is what makes it
 * read as a creation. An inline-code example does not: a leading backtick
 * glues to the CLI name, so `` `gh `` is not `gh` and the recogniser never
 * fires. My first version of this fixture used inline code and was therefore
 * VACUOUS — it passed before and after the fix, proving only that the test
 * ran. Worth keeping in mind when judging how much real documentation this
 * defect actually reached.
 */
const RUNBOOK = fixture("runbook.md", [
  "# How to file a ticket",
  "",
  "```bash",
  'gh issue create --title "Something that needs building"',
  "```",
  "",
  "That is refused unless you declare readiness.",
]);

/** The same shape PLUS a human-gate marker — the false-ALLOW half. */
const MARKED = fixture("marked.md", [
  "# Held work",
  "",
  "```bash",
  'gh issue create --title "Something that needs building"',
  "```",
  "",
  "Held for a human product call: pricing.",
  "<!-- [lisa-human-gate] reason=pricing -->",
]);

/** A script that really files, undeclared — the rejection control. */
const CREATE = fixture("create.sh", [
  "#!/usr/bin/env bash",
  'gh issue create --title "x"',
]);

/**
 * Drive the guard against the fixture project.
 * @param command - The command an agent is attempting.
 * @returns The exit status; 2 means refused.
 */
const run = (command: string): number | null =>
  runHook(bash(command), { cwd: project }).status;

describe("block-direct-issue-create.sh noexec", () => {
  describe("allows a syntax check, which executes nothing", () => {
    it.each([
      ["bash -n on a creation-shaped file", `bash -n ${RUNBOOK}`],
      ["bash -n on a script that really files", `bash -n ${CREATE}`],
      ["sh -n", `sh -n ${CREATE}`],
      ["zsh -n", `zsh -n ${CREATE}`],
      ["dash -n", `dash -n ${CREATE}`],
      ["-n in a cluster", `bash -en ${CREATE}`],
      ["-n before other options", `bash -n -u ${CREATE}`],
      ["the long spelling", `bash --noexec ${CREATE}`],
      ["an absolute interpreter path", `/bin/bash -n ${CREATE}`],
      ["behind a wrapper", `nice -n 5 bash -n ${CREATE}`],
    ])(ALLOWS, (_label, command) => {
      expect(run(command)).toBe(EXIT_ALLOWED);
    });

    it("answers the same for a marker-bearing file as for a bare one", () => {
      // The asymmetry is the defect, not either verdict on its own: before the
      // fix these two disagreed, so a file's contents decided the verdict of a
      // command that ran nothing. They must now agree, and agree on ALLOW.
      expect(run(`bash -n ${RUNBOOK}`)).toBe(run(`bash -n ${MARKED}`));
      expect(run(`bash -n ${MARKED}`)).toBe(EXIT_ALLOWED);
    });
  });

  describe("still refuses the executing form", () => {
    // Without this group the group above is satisfied by a guard that stopped
    // following executed scripts at all — which would give back the fail-open
    // that reach was added to close.
    it.each([
      ["bash <script that files>", `bash ${CREATE}`],
      ["sh", `sh ${CREATE}`],
      ["source", `source ${CREATE}`],
      ["the dot builtin", `. ${CREATE}`],
      ["an absolute interpreter path", `/bin/bash ${CREATE}`],
      ["behind a wrapper", `nice -n 5 bash ${CREATE}`],
      ["a nested command string", `bash -c 'gh issue create --title "x"'`],
    ])(REFUSES, (_label, command) => {
      expect(run(command)).toBe(EXIT_BLOCKED);
    });

    it("refuses an inline undeclared creation", () => {
      expect(run('gh issue create --title "x"')).toBe(EXIT_BLOCKED);
    });
  });

  describe("keeps read-only commands allowed", () => {
    // Pinned regressions: the ticket's headline no longer reproduces, and a
    // future widening of reach must not bring it back.
    it.each([
      ["head", `head -1 ${RUNBOOK}`],
      ["cat", `cat ${RUNBOOK}`],
      ["wc -l", `wc -l ${RUNBOOK}`],
      ["grep -n", `grep -n title ${RUNBOOK}`],
      ["stat", `stat ${RUNBOOK}`],
      ["sed -n", `sed -n '1,5p' ${RUNBOOK}`],
      [
        "a plain file, unrelated to filing",
        `head -1 ${project}/.lisa.config.json`,
      ],
    ])(ALLOWS, (_label, command) => {
      expect(run(command)).toBe(EXIT_ALLOWED);
    });
  });

  describe("leaves the declaration contract alone", () => {
    it("allows a declared creation", () => {
      expect(
        run('gh issue create --title "x" --label status:ready --repo o/r')
      ).toBe(EXIT_ALLOWED);
    });

    it("allows a creation whose submitted body carries the marker", () => {
      // Not a defect and deliberately pinned: a --body-file IS the body being
      // submitted, and the guard's own refusal names a human-gate marker in
      // that body as a valid declaration.
      expect(run(`gh issue create --title "x" --body-file ${MARKED}`)).toBe(
        EXIT_ALLOWED
      );
    });

    it("refuses a creation whose marker sits in a file it never submits", () => {
      expect(
        run(`gh issue create --title "x" --body "y" ; cat ${MARKED}`)
      ).toBe(EXIT_BLOCKED);
    });
  });
});
