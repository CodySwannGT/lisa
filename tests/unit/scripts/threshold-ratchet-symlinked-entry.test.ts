/**
 * Proof that the threshold ratchet actually runs when reached via a symlink.
 *
 * The guard compared `fileURLToPath(import.meta.url)` against
 * `path.resolve(process.argv[1])`. `resolve` makes a path absolute without
 * following symlinks, so the two sides disagreed, `main()` never ran, and the
 * process exited 0 having done nothing.
 *
 * For a CHECK that is a fail-OPEN: no output, exit 0, the npm script
 * "succeeds", and a gate meant to block a merge quietly stops having an
 * opinion. Which is why every assertion here is on OUTPUT. Asserting on the
 * exit status would pass against the broken guard — a script that never ran
 * exits 0 exactly like one that ran and found nothing wrong.
 *
 * The link is to the containing DIRECTORY, not the file. Symlinking the file
 * alone works normally but fails under `--preserve-symlinks-main` with
 * ERR_MODULE_NOT_FOUND, because the entry is no longer realpath'd and its
 * sibling imports resolve beside the link instead of beside the real file. That
 * is a property of the fixture, not of the guard, and a directory link keeps
 * the siblings reachable so the flag case measures what it claims to.
 * @module tests/unit/scripts/threshold-ratchet-symlinked-entry
 */

import type { SpawnSyncReturns } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const LANES = [
  "typescript/copy-overwrite/scripts",
  "rails/copy-overwrite/scripts",
] as const;
const SCRIPT = "check-threshold-ratchet.mjs";
const HOOK_SOURCE = "plugins/src/base/hooks";
const HOOK_SCRIPT = "threshold-ratchet.mjs";
const GIT = resolveGit();

/** Text the body prints when invoked with no recognised argument. */
const USAGE = "usage: threshold-ratchet.mjs";

let temps: string[] = [];

afterEach(() => {
  for (const dir of temps) rmSync(dir, { force: true, recursive: true });
  temps = [];
});

/**
 * Invoke a shipped script through a symlink to its containing directory.
 * @param dir - Repository-relative directory holding the script
 * @param script - The script's filename
 * @param flags - Extra node flags to pass ahead of the entry path
 * @returns Combined stdout and stderr
 */
function throughSymlink(
  dir: string,
  script: string,
  flags: readonly string[] = []
): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-ratchet-link-"));
  const link = path.join(root, "scripts");
  const entry = path.join(link, script);
  temps.push(root);
  symlinkSync(path.resolve(dir), link);
  return output(
    boundedSpawnSync({
      label: `${script} through a symlink`,
      command: process.execPath,
      args: [...flags, entry],
    })
  );
}

/**
 * Everything a run wrote, on either stream.
 *
 * Both streams together, because which one carries the proof is not the point:
 * the question is whether the body produced anything at all.
 * @param result - A completed process
 * @returns stdout concatenated with stderr
 */
function output(result: SpawnSyncReturns<string>): string {
  return `${result.stdout}${result.stderr}`;
}

describe("threshold ratchet reached through a symlink", () => {
  useIoLatencyBudget();

  it.each(["--staged", "--hook"])(
    "actually compares both tightening and weakening through %s",
    mode => {
      const cwd = realpathSync(
        mkdtempSync(path.join(tmpdir(), "lisa-ratchet-cli-"))
      );
      temps.push(cwd);
      const threshold = path.join(cwd, "eslint.thresholds.json");
      for (const args of [
        ["init", "-q"],
        ["config", "user.name", "Ratchet Test"],
        ["config", "user.email", "ratchet@example.invalid"],
      ]) {
        expect(
          boundedSpawnSync({
            label: "ratchet git setup",
            command: GIT,
            args,
            cwd,
          }).status
        ).toBe(0);
      }
      writeFileSync(threshold, JSON.stringify({ maxWarnings: 10 }));
      for (const args of [
        ["add", "."],
        ["commit", "-qm", "baseline"],
      ]) {
        expect(
          boundedSpawnSync({
            label: "ratchet git baseline",
            command: GIT,
            args,
            cwd,
          }).status
        ).toBe(0);
      }
      for (const value of [5, 20]) {
        writeFileSync(threshold, JSON.stringify({ maxWarnings: value }));
        expect(
          boundedSpawnSync({
            label: "ratchet stage threshold",
            command: GIT,
            args: ["add", "."],
            cwd,
          }).status
        ).toBe(0);
        const result = boundedSpawnSync({
          label: "ratchet admitted caller mode",
          command: process.execPath,
          args: [path.resolve(HOOK_SOURCE, HOOK_SCRIPT), mode],
          cwd,
          ...(mode === "--hook"
            ? { input: JSON.stringify({ tool_name: "Bash" }) }
            : {}),
        });
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(value === 5 ? 0 : mode === "--hook" ? 2 : 1);
        if (value === 20)
          expect(output(result)).toContain("Quality gate weakened");
      }
    }
  );

  it.each([
    { args: [], status: 2 },
    { args: ["--stage"], status: 2 },
    { args: ["--base"], status: 1 },
  ])("refuses invalid CLI arguments $args", ({ args, status }) => {
    const result = boundedSpawnSync({
      label: "threshold ratchet invalid arguments",
      command: process.execPath,
      args: [path.resolve(HOOK_SOURCE, HOOK_SCRIPT), ...args],
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(status);
    expect(output(result)).toContain(status === 2 ? USAGE : "failing closed");
  });

  it.each(LANES)("runs its body when invoked via a symlink: %s", dir => {
    // Output, never exit status. A guard that no-ops prints nothing and exits
    // 0, which an exit-status assertion cannot tell apart from success.
    expect(throughSymlink(dir, SCRIPT)).toContain(USAGE);
  });

  it.each(LANES)("runs its body under --preserve-symlinks-main: %s", dir => {
    // The flag tells node NOT to realpath the main entry, so `import.meta.url`
    // stays symlinked too. A fix that normalized only `argv[1]` would compare a
    // real path against a symlinked one and reintroduce the no-op here — which
    // is why the shared helper realpaths both sides.
    expect(throughSymlink(dir, SCRIPT, ["--preserve-symlinks-main"])).toContain(
      USAGE
    );
  });

  it("covers the canonical hook source the lanes are materialized from", () => {
    expect(throughSymlink(HOOK_SOURCE, HOOK_SCRIPT)).toContain(USAGE);
    expect(
      throughSymlink(HOOK_SOURCE, HOOK_SCRIPT, ["--preserve-symlinks-main"])
    ).toContain(USAGE);
  });

  it("still runs when invoked directly, with no symlink involved", () => {
    // A control: the fix must not trade one no-op for another.
    expect(
      output(
        boundedSpawnSync({
          label: `${SCRIPT} invoked directly`,
          command: process.execPath,
          args: [path.resolve(LANES[0], SCRIPT)],
        })
      )
    ).toContain(USAGE);
  });
});
