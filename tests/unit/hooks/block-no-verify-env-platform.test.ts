/**
 * Platform coverage for `block-no-verify.sh`'s `env` option tables.
 *
 * The tables began as GNU's. An option in neither set falls through to
 * `ambiguous`, which the guard treats as suspicious — correct, because an
 * unknown option could take a value and swallow the command name. The defect
 * was a WELL-KNOWN option being unknown: BSD's `-P altpath`, which on a macOS
 * fleet refuses every ordinary command it prefixes.
 *
 * ## Why this suite asserts by execution, and what it refuses to assert
 *
 * The originating ticket's sharpest warning is that a fix which widens the
 * option set until the false positives stop will satisfy the acceptance cases
 * while quietly admitting real bypasses — and that no source reading catches
 * it, because the table will look reasonable. So nothing here inspects the
 * tables. Every case drives the guard through its real PreToolUse stdin
 * contract and asserts the exit status.
 *
 * The load-bearing group is `refuses a bypass routed through -P`. Widening a
 * table is a weakening, and the only thing that makes one safe is proving the
 * refusals survive it. A suite that asserted only the two fixed false
 * positives would be satisfied by deleting the guard.
 *
 * ## The population is one letter, not a class
 *
 * The ticket predicted the same refusal for every BSD-only option. Measured
 * one option at a time, BSD's complete short set is `0 i v u C P S` and the
 * GNU-derived tables already covered every one except `-P`. Each of those is
 * pinned below, so a later "simplification" of the tables cannot quietly drop
 * one, and so the claim in this file is checkable rather than remembered.
 * @module tests/unit/hooks/block-no-verify-env-platform
 */
import path from "path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/**
 * The guard as it lives in the plugin SOURCE — the copy a fix edits. The
 * shipped copies are regenerated from it, and pointing a suite at a generated
 * one lets a source fix pass while the shipped guard stays broken.
 */
const GUARD = path.resolve("plugins/src/base/hooks/block-no-verify.sh");
const BASH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

/** `it.each` titles, named because the same table shape recurs below. */
const ALLOWS = "allows %s";
const REFUSES = "refuses %s";

/** The long-flag bypass, and the path BSD `-P` is given. */
const BYPASS = 'git commit --no-verify -m "wip"';
const ALTPATH = "/usr/bin";

/**
 * Drive the guard with one shell command.
 * @param command - The command an agent is attempting.
 * @returns The exit status; 2 means refused.
 */
const run = (command: string): number | null =>
  boundedSpawnSync({
    label: "block-no-verify.sh",
    command: BASH,
    args: [GUARD],
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  }).status;

describe("block-no-verify.sh env option tables", () => {
  describe("allows every BSD short option ahead of an ordinary command", () => {
    // BSD's complete short set, from env(1) on macOS:
    //   env [-0iv] [-u name] [name=value ...]
    //   env [-iv] [-C altwd] [-P altpath] [-S string] [-u name] ... utility
    // `-S` is absent on purpose — see the split-string group below.
    it.each([
      ["-0", "env -0 git status"],
      ["-i", "env -i git status"],
      ["-v", "env -v git status"],
      ["-u with a separate value", "env -u FOO git status"],
      ["-C with a separate value", "env -C /tmp git status"],
      ["-P with a separate value", `env -P ${ALTPATH} git status`],
      ["-P with an attached value", `env -P${ALTPATH} git status`],
      ["a cluster of value-less options", "env -iv git status"],
      ["another cluster", "env -0i git status"],
    ])(ALLOWS, (_label, command) => {
      expect(run(command)).toBe(EXIT_ALLOWED);
    });

    it("allows -P ahead of a command that merely searches for the flag", () => {
      expect(run(`env -P ${ALTPATH} grep -- --no-verify README.md`)).toBe(
        EXIT_ALLOWED
      );
    });
  });

  describe("refuses a bypass routed through the newly recognised option", () => {
    // The anti-widening group. Every one of these was refused BEFORE `-P` was
    // added, and adding a letter must not change that. Without this group the
    // suite above is satisfied by a guard that allows everything.
    it.each([
      ["the long flag behind -P", `env -P ${ALTPATH} ${BYPASS}`],
      ["the long flag behind an attached -P", `env -P${ALTPATH} ${BYPASS}`],
      ["the short cluster behind -P", `env -P ${ALTPATH} git commit -nm x`],
      [
        "an abbreviation behind -P",
        `env -P ${ALTPATH} git commit --no-veri -m x`,
      ],
      ["an assignment after -P", `env -P ${ALTPATH} FOO=1 ${BYPASS}`],
      [
        "the husky escape behind -P",
        `env -P ${ALTPATH} HUSKY=0 git commit -m x`,
      ],
      [
        "a hooksPath disable behind -P",
        `env -P ${ALTPATH} git -c core.hooksPath=/dev/null commit -m x`,
      ],
      ["a nested shell behind -P", `env -P ${ALTPATH} bash -c '${BYPASS}'`],
      // `-P` consuming the command word is the shape a value-taking option is
      // added to handle; the bypass must still be seen past it.
      ["-P swallowing the command word", `env -P ${BYPASS}`],
    ])(REFUSES, (_label, command) => {
      expect(run(command)).toBe(EXIT_BLOCKED);
    });
  });

  describe("keeps ambiguous meaning suspicious", () => {
    // The ticket names this as the criterion that stops the fix trading false
    // positives for false negatives. An option in NO platform's table could
    // take a value and swallow the command name, so it is refused.
    it.each([
      ["an option in no platform's table", "env -Z /usr/bin git status"],
      ["another unknown option", "env -Q git status"],
      ["an unknown option in a cluster", "env -iZ git status"],
      ["an unknown long option", "env --frobnicate git status"],
    ])(REFUSES, (_label, command) => {
      expect(run(command)).toBe(EXIT_BLOCKED);
    });

    it("still refuses split-string, whose payload cannot be proven", () => {
      // `-S` reparses one opaque argv value as shell words. Inspecting the
      // outer command cannot prove what that second parse produces, so the
      // ambiguous form is refused — a deliberate refusal, not a gap in the
      // table, and it must survive the table growing.
      expect(run(`env -S '${BYPASS}'`)).toBe(EXIT_BLOCKED);
    });

    it.each([
      ["the -S abbreviation family", `env --split-string '${BYPASS}'`],
      ["a short abbreviation", `env --s '${BYPASS}'`],
      ["-S inside a cluster", `env -vS '${BYPASS}'`],
    ])(REFUSES, (_label, command) => {
      expect(run(command)).toBe(EXIT_BLOCKED);
    });
  });

  describe("controls", () => {
    // Without these, a BLOCKED verdict above proves nothing: a broken harness
    // blocks everything, and a dead one allows everything.
    it("refuses the real bypass with no env involved", () => {
      expect(run(BYPASS)).toBe(EXIT_BLOCKED);
    });

    it("allows an ordinary command with no env involved", () => {
      expect(run("git status")).toBe(EXIT_ALLOWED);
    });

    it("allows an unexpanded variable in a commit message", () => {
      // Reported alongside the two real defects and confirmed NOT one, on both
      // the working-tree and origin/main copies. Pinned so it is not
      // re-derived as a defect a third time.
      expect(run('git commit -m "$MSG"')).toBe(EXIT_ALLOWED);
    });
  });
});
