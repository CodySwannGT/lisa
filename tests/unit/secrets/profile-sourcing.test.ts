/**
 * Materialized secrets must actually be IN EFFECT, not merely on disk.
 *
 * Observed live: a Claude cloud session had a correct `secrets.env` (600, right
 * values, AWS pair derived) and every AWS call still failed with
 * `InvalidClientTokenId`. Nothing sourced the file, so the agent's shell kept
 * the container's own injected `AWS_ACCESS_KEY_ID` — and environment variables
 * outrank profile files in AWS's credential chain.
 *
 * Deriving the variables fixed precedence *within* the file. Something still has
 * to load the file, which is what this covers.
 * @module tests/unit/secrets/profile-sourcing
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installProfileSourcing } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

/**
 * An absolute bash, so the shell is never resolved through PATH.
 *
 * `sonarjs/no-os-command-from-path` guards against executing a command found on
 * an influenceable PATH; scanning the directories in JS to get an absolute path
 * avoids that entirely rather than suppressing the rule.
 * @returns The first bash found on PATH, falling back to the usual location.
 */
function locateBash(): string {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "bash");
    if (existsSync(candidate)) return candidate;
  }
  return "/bin/bash";
}

/** Resolved once — every shell in this file runs through it. */
const BASH = locateBash();

/** The project whose values the shell block loads. */
const OWNER = "acmeco";

/** Scratch homes to clean up. */
const homes: string[] = [];

/** The value the profile should make win. */
const CORRECT = "AKIA_CORRECT";

/** What the container injects, and what used to win. */
const AMBIENT = "AKIA_AMBIENT_WRONG";

/** The marker delimiting the managed block. */
/**
 * Counts managed blocks by FAMILY rather than by one literal marker.
 *
 * It was the literal `# >>> lisa secrets (managed) >>>`, which meant this
 * idempotence guard was pinned to one marker version and had to be edited on
 * every bump. Matching the family is what the module itself now does, and it
 * keeps the assertion about the property — one block, however it is spelled.
 */
const MARKER_FAMILY = /# >>> lisa secrets \(managed[^\n]*>>>/g;

/**
 * A home with a materialized values file.
 * @returns The home directory and the values file path.
 */
function scratchHome(): { home: string; values: string } {
  const home = mkdtempSync(path.join(tmpdir(), "lisa-profile-"));
  const values = path.join(home, "secrets.env");

  homes.push(home);
  writeFileSync(values, `export AWS_ACCESS_KEY_ID="${CORRECT}"\n`);

  return { home, values };
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop() as string, { recursive: true, force: true });
  }
});

describe("installProfileSourcing", () => {
  it("makes a real shell resolve the materialized value over the ambient one", () => {
    // The end-to-end claim. Asserting the file's TEXT would pass even if the
    // snippet did not work; only running a shell proves precedence.
    const { home, values } = scratchHome();
    installProfileSourcing(values, { home, owner: OWNER });

    const out = boundedExecFileSync({
      label: "bash sourcing .bashrc for AWS_ACCESS_KEY_ID",
      command: BASH,
      args: [
        "-c",
        `. "${path.join(home, ".bashrc")}"; printf '%s' "$AWS_ACCESS_KEY_ID"`,
      ],
      env: { PATH: process.env.PATH, HOME: home, AWS_ACCESS_KEY_ID: AMBIENT },
    });

    expect(out).toBe(CORRECT);
  });

  it("exports rather than merely setting, so child processes inherit it", () => {
    // `aws` is a child process. A shell variable that is not exported would
    // satisfy the previous test and still leave the CLI failing.
    const { home, values } = scratchHome();
    installProfileSourcing(values, { home, owner: OWNER });

    const out = boundedExecFileSync({
      label: "bash sourcing .bashrc, then a child bash",
      command: BASH,
      args: [
        "-c",
        `. "${path.join(home, ".bashrc")}"; bash -c 'printf "%s" "$AWS_ACCESS_KEY_ID"'`,
      ],
      env: { PATH: process.env.PATH, HOME: home },
    });

    expect(out).toBe(CORRECT);
  });

  it("preserves configuration it did not write", () => {
    const { home, values } = scratchHome();
    writeFileSync(path.join(home, ".bashrc"), "export KEEP=1\n");

    installProfileSourcing(values, { home, owner: OWNER });

    expect(readFileSync(path.join(home, ".bashrc"), "utf8")).toMatch(
      /export KEEP=1/
    );
  });

  it("replaces its block instead of appending on every session", () => {
    // This runs at every session start; an append-forever profile is its own bug.
    const { home, values } = scratchHome();

    installProfileSourcing(values, { home, owner: OWNER });
    installProfileSourcing(values, { home, owner: OWNER });
    installProfileSourcing(values, { home, owner: OWNER });

    const text = readFileSync(path.join(home, ".bashrc"), "utf8");
    expect((text.match(MARKER_FAMILY) ?? []).length).toBe(1);
  });

  it("writes both .bashrc and .profile", () => {
    // Which one a shell reads depends on interactive vs login, and an agent's
    // tool calls are not reliably either.
    const { home, values } = scratchHome();

    expect(
      installProfileSourcing(values, { home, owner: OWNER }).map(f =>
        path.basename(f)
      )
    ).toEqual([".bashrc", ".profile"]);
  });

  it("leaves a shell working when the values file is absent", () => {
    // Guarded on existence: a shell must still start before the first
    // materialization, or if the file is removed.
    const { home } = scratchHome();
    const missing = path.join(home, "not-written-yet.env");
    installProfileSourcing(missing, { home, owner: OWNER });

    const out = boundedExecFileSync({
      label: "bash sourcing .bashrc with no values file",
      command: BASH,
      args: ["-c", `. "${path.join(home, ".bashrc")}"; printf 'ok'`],
      env: { PATH: process.env.PATH, HOME: home },
    });

    expect(out).toBe("ok");
  });
});
