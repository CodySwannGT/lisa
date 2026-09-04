/**
 * A syntax check is not an execution — `parity-safety-net.sh`.
 *
 * The follow-execution walk resolves the file an invocation RUNS and hands its
 * contents to the destructive-command scan. That is correct and is the whole
 * point of the reach. But `-n` is **noexec**: the shell reads and parses its
 * operand, then exits without running a line. So `bash -n <file>` is the one
 * shape that puts a path at a command position while provably executing
 * nothing, and the walk adjudicated it anyway.
 *
 * ## Why this guard hit it on itself
 *
 * Its pattern list is destructive command literals, and that list lives inside
 * the guard. So `bash -n` on its own source was refused by its own patterns —
 * and so was a syntax check of any file that merely documents destructive
 * commands. That is the condition CodySwannGT/lisa#3803 records, and it is why
 * a guard whose job is recognising a shape cannot be syntax-checked while it
 * treats reading as running.
 *
 * ## Not a read-only exemption, and the controls are the proof
 *
 * `bash <file>` still executes and is still refused, as are `sh`, a `<`
 * redirect, an inline destructive command and a `-c` payload. Every acceptance
 * case below is paired with one of those. The distinction encoded is *noexec*,
 * not *which program*.
 *
 * ## The fixture bites, and an earlier one did not
 *
 * The destructive fixture deletes a **home-anchored** path. A `/tmp` target
 * makes this suite VACUOUS: the guard allows recursive deletes under `/tmp`,
 * `/var/tmp` and `$TMPDIR` by design, so a `/tmp` fixture returns ALLOW before
 * and after the fix and every rejection control below silently proves nothing.
 * The path does not exist, so the fixture stays harmless if anything ever ran
 * it — which nothing here does; the file is only ever named in a command
 * string handed to the guard.
 * @module tests/unit/hooks/parity-safety-net-noexec
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** The guard as it lives in the plugin source — the copy a fix edits. */
const GUARD = path.resolve("plugins/src/base/hooks/parity-safety-net.sh");
const BASH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

/** `it.each` titles, named because the same table shape recurs. */
const ALLOWS = "allows %s";
const REFUSES = "refuses %s";

const dir = mkdtempSync(path.join(tmpdir(), "lisa-safety-noexec-"));

/**
 * Write a script fixture.
 * @param name - The file name.
 * @param lines - The contents, one entry per line.
 * @returns The absolute path written.
 */
const script = (name: string, lines: readonly string[]): string => {
  const target = path.join(dir, name);
  writeFileSync(
    target,
    `${["#!/usr/bin/env bash", ...lines].join("\n")}\n`,
    "utf-8"
  );
  return target;
};

/**
 * A script that really performs a blocked delete. Home-anchored, not `/tmp` —
 * see the module header on why a `/tmp` target makes the controls vacuous.
 */
const DESTROY = script("destroy.sh", ["rm -rf ~/lisa-noexec-nonexistent"]);

/** A file that merely DOCUMENTS a destructive command, as this guard does. */
const DOCS = script("patterns.sh", ['echo "rm -rf /"']);

/**
 * Drive the guard with one shell command.
 * @param command - The command an agent is attempting.
 * @returns The exit status; 2 means refused.
 */
const run = (command: string): number | null =>
  boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: BASH,
    args: [GUARD],
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  }).status;

describe("parity-safety-net.sh noexec", () => {
  describe("allows a syntax check, which executes nothing", () => {
    it.each([
      ["bash -n on a script that really deletes", `bash -n ${DESTROY}`],
      ["bash -n on a file documenting a delete", `bash -n ${DOCS}`],
      ["sh -n", `sh -n ${DESTROY}`],
      ["zsh -n", `zsh -n ${DESTROY}`],
      ["dash -n", `dash -n ${DESTROY}`],
      ["-n in a cluster", `bash -en ${DESTROY}`],
      ["-n before another option", `bash -n -u ${DESTROY}`],
      ["the long spelling", `bash --noexec ${DESTROY}`],
      ["an absolute interpreter path", `/bin/bash -n ${DESTROY}`],
    ])(ALLOWS, (_label, command) => {
      expect(run(command)).toBe(EXIT_ALLOWED);
    });

    it("allows a syntax check of the guard's own source", () => {
      // The condition #3803 records: the guard's pattern list is destructive
      // literals living inside the guard, so it refused `bash -n` on itself.
      expect(run(`bash -n ${GUARD}`)).toBe(EXIT_ALLOWED);
    });
  });

  describe("still follows and refuses an execution", () => {
    // The rejection controls. Without these the group above is satisfied by a
    // guard that stopped following executed scripts at all — which would give
    // back the fail-open the follow-execution reach exists to close.
    it.each([
      ["bash <script that really deletes>", `bash ${DESTROY}`],
      ["sh", `sh ${DESTROY}`],
      ["an absolute interpreter path", `/bin/bash ${DESTROY}`],
      ["a stdin redirect", `bash < ${DESTROY}`],
      ["source", `source ${DESTROY}`],
      ["behind a wrapper", `nice -n 5 bash ${DESTROY}`],
    ])(REFUSES, (_label, command) => {
      expect(run(command)).toBe(EXIT_BLOCKED);
    });

    it.each([
      ["an inline destructive command", "rm -rf ~/lisa-noexec-nonexistent"],
      ["a -c payload", `bash -c 'rm -rf ~/lisa-noexec-nonexistent'`],
    ])(REFUSES, (_label, command) => {
      expect(run(command)).toBe(EXIT_BLOCKED);
    });
  });

  describe("leaves ordinary commands alone", () => {
    it.each([
      ["an ordinary command", "git status"],
      ["a non-recursive rm", "rm /tmp/lisa-noexec-nothing"],
      ["a read of the destructive script", `cat ${DESTROY}`],
      ["a grep over it", `grep -n rm ${DESTROY}`],
    ])(ALLOWS, (_label, command) => {
      expect(run(command)).toBe(EXIT_ALLOWED);
    });
  });
});
