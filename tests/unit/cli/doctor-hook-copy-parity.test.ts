/**
 * Doctor coverage for sibling copies of one hook that disagree.
 *
 * The Lisa-owned artifact check compares one destination against the copies the
 * package ships for it. A second tracked copy at a DIFFERENT path, in a
 * directory the package does not ship, is outside that axis by construction —
 * which is how a third copy of the pre-push hook sat six commits behind with
 * every check green (CodySwannGT/lisa#2847). These tests pin the check that
 * asks the missing question, and pin that it stays silent where there is
 * nothing to ask.
 * @module tests/unit/cli/doctor-hook-copy-parity
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkHookCopyParity } from "../../../src/cli/doctor-hook-copy-parity.js";
import { cleanGitEnv, resolveGit } from "../../support/git-executable.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CHECK_NAME = "Hook copies agree?";
const ROOT_COPY = ".husky/pre-push";
const VENDOR_COPY = "vendor/.husky/pre-push";
const TRACEABILITY = "traceability";

const GIT = resolveGit();

/**
 * Run one git command inside a fixture repository.
 * @param cwd - Fixture repository path
 * @param args - Literal git arguments
 */
function git(cwd: string, args: readonly string[]): void {
  execFileSync(GIT, [...args], { cwd, env: cleanGitEnv(), stdio: "ignore" });
}

/**
 * A hook body declaring exactly the gate ids given.
 * @param gates - Gate ids the hook's built-in steps stand down for
 * @returns Hook source
 */
function hookDeclaring(...gates: readonly string[]): string {
  return [
    "#!/bin/sh",
    "lisa_gate_covers() {",
    '  grep -Fqx -- "$1" "$LISA_GATE_COVERAGE"',
    "}",
    ...gates.map(gate => `if lisa_gate_covers ${gate}; then :; fi`),
    "",
  ].join("\n");
}

let project = "";

beforeEach(async () => {
  project = await createTempDir();
  git(project, ["init", "--quiet"]);
});

afterEach(async () => {
  await cleanupTempDir(project);
});

/**
 * Write and track one hook copy.
 * @param relative - Repo-relative path of the copy
 * @param source - Hook source
 */
function trackHook(relative: string, source: string): void {
  const absolute = path.join(project, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, source, "utf8");
  git(project, ["add", "--", relative]);
}

describe("checkHookCopyParity", () => {
  it("fails and names both paths and the feature when copies disagree", async () => {
    trackHook(ROOT_COPY, hookDeclaring(TRACEABILITY));
    trackHook(VENDOR_COPY, hookDeclaring());

    const check = await checkHookCopyParity(project);

    expect(check.name).toBe(CHECK_NAME);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("gate:traceability");
    expect(check.detail).toContain(ROOT_COPY);
    expect(check.detail).toContain(VENDOR_COPY);
  });

  it("covers a copy added later without any roster being edited", async () => {
    trackHook(ROOT_COPY, hookDeclaring(TRACEABILITY));
    trackHook(VENDOR_COPY, hookDeclaring(TRACEABILITY));
    expect((await checkHookCopyParity(project)).status).toBe("ok");

    const thirdCopy = "third/.husky/pre-push";
    trackHook(thirdCopy, hookDeclaring());

    const check = await checkHookCopyParity(project);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain(thirdCopy);
  });

  it("stays quiet for a hook with exactly one tracked copy", async () => {
    trackHook(ROOT_COPY, hookDeclaring(TRACEABILITY));

    const check = await checkHookCopyParity(project);

    expect(check.status).toBe("ok");
    expect(check.detail).toBe("No hook has more than one tracked copy");
  });

  it("reports agreement rather than silence when copies match", async () => {
    trackHook(ROOT_COPY, hookDeclaring(TRACEABILITY));
    trackHook(VENDOR_COPY, hookDeclaring(TRACEABILITY));

    const check = await checkHookCopyParity(project);

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("2 tracked copies");
  });

  it("warns rather than passing when tracked files cannot be listed", async () => {
    const notARepo = await createTempDir();
    try {
      const check = await checkHookCopyParity(notARepo);
      expect(check.status).toBe("warn");
      expect(check.detail).toContain("not a pass");
    } finally {
      await cleanupTempDir(notARepo);
    }
  });
});
