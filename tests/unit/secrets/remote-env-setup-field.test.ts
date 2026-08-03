/**
 * Contract tests for the documented remote-environment setup field.
 *
 * That field is pasted into a vendor settings box: no review, no version
 * history, and — until this file — no test. It broke exactly the way untested
 * prose breaks, by being correct on the surface its author used and wrong on
 * the other one.
 *
 * The line under test is READ OUT OF `SKILL.md` rather than duplicated here, so
 * the documentation is the source of truth and editing it to something that
 * cannot find the entrypoint turns this red.
 * @module tests/unit/secrets/remote-env-setup-field
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SETUP_FIELD } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

const SKILL = "plugins/src/base/skills/lisa-setup-remote-env/SKILL.md";

/** Where the entrypoint lives inside a checkout. */
const ENTRYPOINT = "scripts/lisa-remote-env/setup.sh";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

/**
 * Pull the `setup:` line out of the skill's documented field block.
 * @returns The shell command an operator is told to paste.
 */
function documentedSetupField(): string {
  // A line scan rather than a regex: the field is long and shell-shaped, and a
  // pattern loose enough to capture it is exactly the kind that backtracks badly.
  const line = readFileSync(SKILL, "utf8")
    .split("\n")
    .find(candidate => candidate.startsWith("setup:"));
  if (!line) throw new Error(`no 'setup:' field found in ${SKILL}`);
  return line.slice("setup:".length).trim();
}

/**
 * Build a checkout containing a stub entrypoint that identifies itself.
 * @param root Directory to create the checkout in.
 * @param marker Text the stub prints when executed.
 */
function checkout(root: string, marker: string): void {
  const dir = path.join(root, path.dirname(ENTRYPOINT));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, ENTRYPOINT), `echo ${marker}\n`);
}

describe("emitted setup field", () => {
  it("is the same line the documentation tells operators to paste", () => {
    // Two copies of a shell one-liner — one emitted, one in prose — drift
    // silently: the emitter is what an operator actually pastes, SKILL.md is
    // what a reader believes, and only one of them got fixed the first time
    // this broke. Pinning them equal is what extends the tests below, which
    // execute the documented line, to cover the emitted one too.
    expect(SETUP_FIELD).toBe(documentedSetupField());
  });
});

describe("documented remote-env setup field", () => {
  let temporary: string;

  beforeEach(() => {
    temporary = mkdtempSync(path.join(tmpdir(), "lisa-setup-field-"));
  });

  afterEach(() => {
    rmSync(temporary, { recursive: true, force: true });
  });

  /**
   * Run the documented field with a given working directory.
   * @param cwd Directory the vendor would run the field from.
   * @returns Combined output of the field.
   */
  const runField = (cwd: string): string =>
    execFileSync(BASH, ["-c", documentedSetupField()], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  it("finds the entrypoint when the field runs FROM the checkout (Codex Cloud)", () => {
    checkout(temporary, "FOUND-codex");
    expect(runField(temporary)).toBe("FOUND-codex");
  });

  it("finds the entrypoint one level down (Claude Code web runs from $HOME)", () => {
    const home = path.join(temporary, "home");
    mkdirSync(home, { recursive: true });
    checkout(path.join(home, "frontend"), "FOUND-claude-web");
    expect(runField(home)).toBe("FOUND-claude-web");
  });

  it("never depends on $HOME containing the checkout", () => {
    // The field this replaced was `bash "$HOME"/*/scripts/...`, which is correct
    // on Claude Code web and wrong on Codex Cloud, where the checkout lives at
    // /workspace/<repo> and is not under $HOME at all.
    expect(documentedSetupField()).not.toContain("$HOME");
  });

  it("fails loudly when no entrypoint exists, rather than succeeding silently", () => {
    const empty = path.join(temporary, "empty");
    mkdirSync(empty, { recursive: true });
    expect(() => runField(empty)).toThrow();
  });
});
