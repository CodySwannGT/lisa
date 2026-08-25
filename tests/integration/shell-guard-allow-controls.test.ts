/**
 * The shipped shell scripts whose every case asserted a FAILURE
 * (CodySwannGT/lisa#3190, the same gap pointing the other way).
 *
 * CodySwannGT/lisa#3190 was filed about guards proved only to allow. Driving
 * the population turned up the mirror image and it is just as blind: every case
 * these two scripts have drives them onto an error path — a missing config, an
 * unset token, a `curl` that reports HTTP 000 — and asserts a non-zero status.
 * A script rewritten to `exit 1` unconditionally passes all of them. As
 * CodySwannGT/lisa#3111 put it about the same shape, such a suite "cannot tell
 * a guard that refuses correctly from one that refuses everything".
 *
 * WHAT THIS SUITE EXECUTES. The shipped scripts, unmodified, over their whole
 * success path, with every external service replaced by a stub on a PATH that
 * does NOT inherit the ambient one. That last part is deliberate: a developer
 * machine with the real `gh`, `curl` or `jira` installed would otherwise reach
 * the network from a case whose value depends on it not doing so, and the case
 * would pass locally for a reason that is untrue on CI.
 * @module tests/integration/shell-guard-allow-controls
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  BASH,
  PERMITTED,
  REPO_ROOT,
  SYSTEM_PATH,
  trackedCopies,
  writeStub,
} from "./support/shell-guard-refusal-fixture.js";

/** A JIRA ticket key the stubs answer for. */
const TICKET = "PROBE-1";

/** A pull request number the `gh` stub answers for. */
const PULL_REQUEST = "42";

const temporaryDirectories: string[] = [];

/**
 * Create and register a disposable directory.
 * @returns Absolute path to the directory.
 */
function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-guard-allow-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("post-evidence.sh completes when JIRA and GitHub answer", () => {
  const copies = trackedCopies("post-evidence.sh");

  /**
   * A project, an evidence directory, and stubs for every service it calls.
   * @returns The project directory, evidence directory, and stub PATH entry.
   */
  const prepare = (): {
    projectDir: string;
    evidenceDir: string;
    binDir: string;
  } => {
    const root = workspace();
    const projectDir = path.join(root, "project");
    const evidenceDir = path.join(root, "evidence");
    const binDir = path.join(root, "bin");
    mkdirSync(path.join(projectDir, ".lisa", "jira-cli"), { recursive: true });
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      path.join(projectDir, ".lisa", "jira-cli", ".config.yml"),
      "installation: cloud\nserver: https://example.invalid\nlogin: probe@example.invalid\n"
    );
    // BOTH kinds of evidence, and that is not tidiness. Under `set -u` on bash
    // 3.2 — which is what `/bin/bash` still is on macOS — expanding an EMPTY
    // array as `"${SCREENSHOTS[@]}"` is an unbound-variable error, so the
    // script dies at its own `ALL_EVIDENCE=(…)` line whenever one of the two
    // kinds is missing. That is a real defect in the shipped script and is
    // recorded here rather than worked around silently.
    writeFileSync(path.join(evidenceDir, "01-log.txt"), "evidence\n");
    writeFileSync(path.join(evidenceDir, "02-shot.png"), "not-really-a-png\n");
    writeFileSync(path.join(evidenceDir, "comment.md"), "## Evidence\nbody\n");
    writeFileSync(path.join(evidenceDir, "comment.txt"), "comment body\n");
    writeStub(
      binDir,
      "gh",
      'case "$1" in\n  repo) printf "org/repo\\n" ;;\n  pr) printf "existing body\\n" ;;\n  *) : ;;\nesac\nexit 0\n'
    );
    writeStub(binDir, "curl", 'printf "{}\\nHTTP_CODE:201"\nexit 0\n');
    writeStub(binDir, "jira", "exit 0\n");
    return { projectDir, evidenceDir, binDir };
  };

  it("has copies to assert about", () => {
    expect(copies.length).toBeGreaterThan(0);
  });

  it.each(copies)("%s exits 0 over its whole success path", copy => {
    const { projectDir, evidenceDir, binDir } = prepare();

    const result = boundedSpawnSync({
      label: `${copy} against stubbed services`,
      command: BASH,
      args: [path.join(REPO_ROOT, copy), TICKET, evidenceDir, PULL_REQUEST],
      cwd: projectDir,
      env: {
        CLAUDE_PROJECT_DIR: projectDir,
        HOME: projectDir,
        JIRA_API_TOKEN: "probe-token",
        PATH: `${binDir}:${SYSTEM_PATH}`,
      },
    });

    expect(result.status).toBe(PERMITTED);
    expect(result.stdout).toContain("JIRA comment posted");
    expect(result.stdout).toContain("Done!");
  });
});

describe("download-attachment.sh completes when the download succeeds", () => {
  const copies = trackedCopies("download-attachment.sh");

  it("has copies to assert about", () => {
    expect(copies.length).toBeGreaterThan(0);
  });

  it.each(copies)("%s exits 0 once curl reports HTTP 200", copy => {
    const root = workspace();
    const binDir = path.join(root, "bin");
    const output = path.join(root, "out", "attachment.png");
    mkdirSync(path.dirname(output), { recursive: true });
    // Writes the file it was asked to write and reports success, which is the
    // only behaviour the script reads from it.
    writeStub(
      binDir,
      "curl",
      'while [ "$#" -gt 0 ]; do\n  if [ "$1" = "-o" ]; then printf "" > "$2"; fi\n  shift\ndone\nprintf "200"\nexit 0\n'
    );

    const result = boundedSpawnSync({
      label: `${copy} against a curl that succeeds`,
      command: BASH,
      args: [path.join(REPO_ROOT, copy), "12345", output],
      cwd: root,
      env: {
        HOME: root,
        JIRA_API_TOKEN: "probe-token",
        JIRA_LOGIN: "probe@example.invalid",
        JIRA_SERVER: "https://example.invalid",
        PATH: `${binDir}:${SYSTEM_PATH}`,
      },
    });

    expect(result.status).toBe(PERMITTED);
    expect(result.stdout).toContain("Downloaded");
  });
});
