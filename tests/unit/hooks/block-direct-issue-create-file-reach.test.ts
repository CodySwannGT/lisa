/**
 * Reach coverage for `block-direct-issue-create.sh` — the half of the guard
 * that decides WHICH TEXT gets classified at all.
 *
 * The guard used to inspect argv and nothing else, so a creation one file away
 * was invisible: `bash /path/create.sh` showed the classifier two tokens,
 * `bash` and a path. The detection is a conjunction — a tracker endpoint AND a
 * creation verb in the same inspected command — so moving either half into a
 * file meant the conjunction never formed.
 *
 * That was not an exotic evasion. Lisa's own `parity-safety-net.sh` refuses
 * heredocs and instructs agents to "write the payload to a file with the Write
 * tool, then execute that file directly", and `block-shell-json-parsing.sh`
 * pushes JSON construction into `jq` scripts — so an agent following Lisa's
 * guidance landed in the uninspected path by default. Two individually
 * reasonable guards, jointly self-defeating.
 *
 * The tests are written against DECISION POINTS rather than command shapes,
 * which is the lesson this guard's own comments record: enumerating 21 shapes
 * scored 21/21 against code that a POSIX `nice` prefix defeated end to end.
 *
 * The first fix for that answered it by reading any file any ARGUMENT named,
 * which is not the same question and cost two false refusals in one session on
 * the exact work of investigating this guard — see
 * `block-direct-issue-create-follow-execution.test.ts`, which owns that
 * boundary. Reach is now decided by execution POSITION, so the decision points
 * this file pins are the wrapper space (unbounded, and still walked through)
 * and the indirection forms (a calling convention, and enumerable). One row
 * moved out as a result: an unenumerated RUNNER is no longer followed, and the
 * allow is asserted below rather than left implicit.
 * @module tests/unit/hooks/block-direct-issue-create-file-reach
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  GATE_MARKER,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

/** A Linear-tracked project, whose build-ready role is a workflow state. */
const LINEAR_CONFIG = {
  tracker: "linear",
  linear: { workflow: { ready: "Ready" } },
};

/** The GraphQL body a hand-rolled Linear creation submits. */
const LINEAR_MUTATION =
  '{"query":"mutation{issueCreate(input:{title:\\"x\\"}){success}}"}';

/**
 * Write a file into a throwaway project directory.
 * @param cwd - The project directory.
 * @param name - The file name.
 * @param body - The contents.
 * @returns The absolute path written.
 */
const fixture = (cwd: string, name: string, body: string): string => {
  const target = path.join(cwd, name);
  writeFileSync(target, body, "utf-8");
  return target;
};

/** The first line of every script fixture below. */
const SHEBANG = "#!/usr/bin/env bash";
/** The fixture name a payload-bearing case writes. */
const PAYLOAD_FILE = "payload.json";
/** The fixture name a script case writes. */
const SCRIPT_FILE = "create.sh";

/** A shell script that files a Linear issue and declares nothing. */
const UNDECLARED_SCRIPT = [
  SHEBANG,
  "set -euo pipefail",
  "curl -sS -X POST https://api.linear.app/graphql \\",
  `  -d '${LINEAR_MUTATION}'`,
  "",
].join("\n");

describe("block-direct-issue-create.sh reach", () => {
  describe("refuses a creation inside a file the command runs", () => {
    it.each([
      ["bash", "bash"],
      ["sh", "sh"],
      ["zsh", "zsh"],
      ["python3", "python3"],
      ["node", "node"],
      ["source", "source"],
      ["the dot builtin", "."],
      ["an absolute interpreter path", "/bin/bash"],
      ["an interpreter behind a wrapper", "nice -n 5 bash"],
      ["a wrapper whose flag takes a value", "sudo -u nobody bash"],
      ["an interpreter reading the script over stdin", "bash <"],
    ])("refuses %s running the script", (_label, runner) => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(cwd, SCRIPT_FILE, UNDECLARED_SCRIPT);

      const { status } = runHook(bash(`${runner} ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    // The residual the position rule buys, asserted rather than implied. A
    // runner outside the interpreter set is not followed, because the only way
    // to follow it is to follow every command's operands — which is what made
    // `grep -n x <a guard>.sh` a refusal. It is bounded by the two ordinary
    // spellings of the same intent, both pinned above and below: `bash <file>`
    // and the bare shebang path.
    it("does not follow an unenumerated runner — the stated residual", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(cwd, SCRIPT_FILE, UNDECLARED_SCRIPT);

      const { status } = runHook(bash(`unknown-runner ${script}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("refuses the script executed by bare path, with no interpreter at all", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(cwd, SCRIPT_FILE, UNDECLARED_SCRIPT);

      const { status } = runHook(bash(script), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a creation written in a language that is not shell", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(
        cwd,
        "wrapper.mjs",
        [
          'await fetch("https://api.linear.app/graphql", {',
          '  method: "POST",',
          '  body: JSON.stringify({ query: "mutation{issueCreate(input:{}){id}}" }),',
          "});",
          "",
        ].join("\n")
      );

      const { status } = runHook(bash(`node ${script} --state Ready`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("names the file in the refusal, so the operator knows what to fix", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(cwd, SCRIPT_FILE, UNDECLARED_SCRIPT);

      const { stderr } = runHook(bash(`bash ${script}`), { cwd });

      expect(stderr).toContain(script);
    });

    it("refuses a script whose unbalanced quote defeats the lexer", () => {
      const cwd = projectWithTracker();
      const script = fixture(
        cwd,
        SCRIPT_FILE,
        [SHEBANG, "gh issue create --title x #'", ""].join("\n")
      );

      const { status } = runHook(bash(`bash ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("refuses a creation whose payload is not in argv", () => {
    it("refuses a payload file passed with --data-binary @path", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const payload = fixture(cwd, PAYLOAD_FILE, LINEAR_MUTATION);

      const { status } = runHook(
        bash(
          "curl -X POST https://api.linear.app/graphql " +
            `--data-binary @${payload}`
        ),
        { cwd }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a payload file passed to gh api graphql --input", () => {
      const cwd = projectWithTracker();
      const payload = fixture(cwd, PAYLOAD_FILE, LINEAR_MUTATION);

      const { status } = runHook(bash(`gh api graphql --input ${payload}`), {
        cwd,
      });

      expect(status).toBe(EXIT_BLOCKED);
    });

    // `-d@file` is the ordinary curl spelling, not an exotic one, and a parser
    // that only reads `args[i + 1]` and `flag=value` sees neither half of it.
    it.each([
      ["a glued short flag", "-d@"],
      ["a glued long flag", "--data-binary@"],
    ])("refuses a payload file behind %s", (_label, flag) => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const payload = fixture(cwd, PAYLOAD_FILE, LINEAR_MUTATION);

      const { status } = runHook(
        bash(`curl -X POST https://api.linear.app/graphql ${flag}${payload}`),
        { cwd }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a payload piped in from the same pipeline over stdin", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);

      const { status } = runHook(
        bash(
          `jq -n '{query:"mutation{issueCreate(input:{}){id}}"}' | ` +
            "curl -X POST https://api.linear.app/graphql --data-binary @-"
        ),
        { cwd }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("allows what reaching further must not start refusing", () => {
    it("allows a script whose create carries the build-ready role", () => {
      const cwd = projectWithTracker();
      const script = fixture(
        cwd,
        "file.sh",
        [
          SHEBANG,
          "gh issue create --title x --body y --label status:ready",
          "",
        ].join("\n")
      );

      const { status } = runHook(bash(`bash ${script}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a script carrying the human-gate marker", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(
        cwd,
        "gated.sh",
        [`# ${GATE_MARKER}`, UNDECLARED_SCRIPT].join("\n")
      );

      const { status } = runHook(bash(`bash ${script}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a file that only writes ABOUT creations", () => {
      const cwd = projectWithTracker();
      const notes = fixture(
        cwd,
        "notes.md",
        [
          "# Notes",
          "The guard refuses `gh issue create`, and the GraphQL verb is",
          "`issueCreate`. Neither sentence files anything.",
          "",
        ].join("\n")
      );

      const { status } = runHook(bash(`cat ${notes}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    // A label belongs to the create it sits on. Letting it vouch for a second,
    // unlabelled create further down the same script would be a hole rather
    // than a convenience — the same asymmetry the argv check already makes.
    it("refuses a second, undeclared create in an otherwise declared script", () => {
      const cwd = projectWithTracker();
      const script = fixture(
        cwd,
        "two.sh",
        [
          SHEBANG,
          "gh issue create --title a --label status:ready",
          "gh issue create --title b",
          "",
        ].join("\n")
      );

      const { status } = runHook(bash(`bash ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    // The refusal advertises the ambient override. A code path that refuses
    // anyway is an escape hatch the message names and the code ignores.
    it("honors the operator's ambient override on a file-borne creation", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(cwd, SCRIPT_FILE, UNDECLARED_SCRIPT);

      const { status } = runHook(bash(`bash ${script}`), {
        cwd,
        env: { LISA_ALLOW_DIRECT_ISSUE_CREATE: "1" },
      });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a payload file with no endpoint to send it to", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const payload = fixture(cwd, PAYLOAD_FILE, LINEAR_MUTATION);

      const { status } = runHook(bash(`cat ${payload}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });
  });
});
