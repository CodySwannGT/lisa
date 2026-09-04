/**
 * The detector reaches every existing consumer through `copy-overwrite`, so the
 * property that matters most about it is that it CANNOT fail closed on arrival.
 *
 * A consumer's seeded workflows carry mutable refs today — that is the defect
 * #3588 migrates away. A detector that hard-failed on arrival would redden the
 * whole installed base at once, for a condition those repositories did not
 * introduce and could not yet have fixed, because the migration that fixes it
 * ships in the same update.
 *
 * That is not a hypothetical risk. A guard added to a workflow consumed at
 * `@main` failed closed on a pre-existing consumer misconfiguration and took
 * four repositories' releases down for five hours; the repair was to keep it
 * loud and stop it blocking (#3755, #3757). These tests are what stop somebody
 * "finishing" this by dropping `--warn`.
 *
 * The blocking case is asserted alongside every warn case on the SAME fixture.
 * Without that pairing, "exit 0 under --warn" is satisfied by a detector that
 * finds nothing at all, which is the vacuous-check failure this repository
 * keeps meeting.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/third-party-action-pins-warn-mode
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");

/**
 * Git, by absolute path, as the bounded-spawn helper requires.
 *
 * Resolved rather than hardcoded: on macOS `/usr/bin/git` is the xcrun
 * dispatcher, not a binary, and a tracked file that prefers it is a finding in
 * its own right (#2898).
 */
const GIT = resolveGit();

/** The detector as Lisa runs it. */
const LISA_COPY = path.join(
  ROOT,
  "scripts",
  "check-third-party-action-pins.mjs"
);

/** The detector as it ships to every existing consumer. */
const SHIPPED_COPY = path.join(
  ROOT,
  "all/copy-overwrite/scripts/check-third-party-action-pins.mjs"
);

/** The consumer-facing script entry, which must carry `--warn`. */
const PACKAGE_LISA = path.join(
  ROOT,
  "typescript/package-lisa/package.lisa.json"
);

/** A workflow with one exempt reference and one mutable third-party one. */
const WORKFLOW = [
  "name: Deploy",
  "jobs:",
  "  deploy:",
  "    steps:",
  "      - uses: actions/checkout@v6",
  "      - uses: noliran/branch-based-secrets@v1",
  "",
].join("\n");

describe("check-third-party-action-pins --warn", () => {
  let fixture: string;

  /**
   * Run the shipped detector against the fixture.
   * @param args - Extra CLI arguments
   * @returns Exit status and combined output
   */
  const run = (
    args: readonly string[]
  ): { readonly status: number; readonly stdout: string } => {
    const outcome = boundedSpawnSync({
      label: "check-third-party-action-pins",
      command: process.execPath,
      args: [SHIPPED_COPY, "--root", fixture, ...args],
    });
    return { status: outcome.status ?? -1, stdout: outcome.stdout };
  };

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-pinwarn-"));
    fs.mkdirSync(path.join(fixture, ".github", "workflows"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(fixture, ".github/workflows/deploy.yml"),
      WORKFLOW
    );
    boundedSpawnSync({
      label: "git init",
      command: GIT,
      args: ["-C", fixture, "init", "-q"],
    });
    boundedSpawnSync({
      label: "git add",
      command: GIT,
      args: ["-C", fixture, "add", "-A"],
    });
  });

  afterEach(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it("fails without --warn, so the fixture really does carry a finding", () => {
    // The control. Without it, every assertion below is satisfied by a
    // detector that reports nothing at all.
    expect(run([]).status).toBe(1);
  });

  it("exits 0 on the same finding under --warn", () => {
    expect(run(["--warn"]).status).toBe(0);
  });

  it("still names the mutable reference it found", () => {
    expect(run(["--warn"]).stdout).toContain("noliran/branch-based-secrets");
  });

  it("tells the reader it is not blocking and what to do", () => {
    const { stdout } = run(["--warn"]);
    expect(stdout).toContain("Reporting only");
    expect(stdout).toContain("npx @codyswann/lisa@latest .");
  });

  it("does not fail a consumer that has no workflows at all", () => {
    fs.rmSync(path.join(fixture, ".github"), { recursive: true, force: true });
    boundedSpawnSync({
      label: "git add",
      command: GIT,
      args: ["-C", fixture, "add", "-A"],
    });
    expect(run(["--warn"]).status).toBe(0);
  });

  it("keeps a misspelled flag a hard error even under --warn", () => {
    // That mistake is the caller's, not the repository's condition.
    expect(run(["--warn", "--bogus"]).status).toBe(2);
  });
});

describe("the shipped detector", () => {
  it("is identical to the copy Lisa runs, apart from its ownership header", () => {
    // Two copies of one gate drift silently; this is what stops that. The
    // shipped copy carries the managed-file header and Lisa's own does not,
    // because only one of them is replaced on a `lisa` run — so the header is
    // removed before comparing rather than the comparison being abandoned.
    const shipped = fs
      .readFileSync(SHIPPED_COPY, "utf8")
      .replace(
        "// This file is managed by Lisa and IS replaced on each `lisa` run.\n" +
          "// Do not edit directly — durable changes belong upstream in Lisa.\n",
        ""
      );

    expect(shipped).toBe(fs.readFileSync(LISA_COPY, "utf8"));
  });

  it("is wired into consumers in the non-blocking mode", () => {
    const manifest = JSON.parse(fs.readFileSync(PACKAGE_LISA, "utf8")) as {
      force: { scripts: Record<string, string> };
    };
    expect(manifest.force.scripts["check:third-party-action-pins"]).toBe(
      "node scripts/check-third-party-action-pins.mjs --warn"
    );
  });
});
