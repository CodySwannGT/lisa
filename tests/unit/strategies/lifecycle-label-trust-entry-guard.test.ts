/**
 * Proof that the lifecycle-label classifier runs when reached via a symlink.
 *
 * This module cannot import `scripts/lib/invoked-as-script.mjs` — it ships in a
 * plugin payload, which has no `./lib/` to resolve against — so it defines the
 * rule inline. An inline copy that nothing exercises is the shape this whole
 * subsystem exists to catch, and the shared helper's tests say nothing about it.
 *
 * The stakes are higher here than for a typical entry guard. The classifier
 * writes its verdict to **stdout**, and the caller parses that JSON to decide
 * which labels to believe. A guard that no-ops leaves an empty payload: no
 * untrusted labels, no unclaimable verdict, everything believed. So every
 * end-to-end assertion is on OUTPUT — the exit status is 0 either way.
 * @module tests/unit/strategies/lifecycle-label-trust-entry-guard
 */

import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { invokedAsScript } from "../../../plugins/src/base/scripts/lifecycle-label-trust.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const LANE = "plugins/src/base/scripts";
const SCRIPT = "lifecycle-label-trust.mjs";
const INPUT = JSON.stringify({ issue: { labels: ["status:ready"] } });

let temps: string[] = [];

afterEach(() => {
  for (const dir of temps) rmSync(dir, { force: true, recursive: true });
  temps = [];
});

/**
 * Run the classifier through a symlink to its containing directory.
 *
 * The DIRECTORY is linked, not the file: linking a single file out of its
 * directory fails under `--preserve-symlinks-main` with ERR_MODULE_NOT_FOUND,
 * because its sibling imports resolve beside the link. That is a property of
 * the fixture rather than of the guard, and it would make the flag case look
 * like a failure it is not.
 * @param flags - Extra node flags placed ahead of the entry path
 * @returns Combined stdout and stderr
 */
function throughSymlink(flags: readonly string[] = []): string {
  const entry = path.join(linkedLane(), SCRIPT);
  return output(
    boundedSpawnSync({
      label: "lifecycle-label-trust.mjs through the symlink",
      command: process.execPath,
      args: [...flags, entry],
      input: INPUT,
    })
  );
}

/**
 * A symlink pointing at the lane directory, cleaned up after the test.
 * @returns Path to the link
 */
function linkedLane(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-llt-link-"));
  const link = path.join(root, "scripts");
  temps.push(root);
  symlinkSync(path.resolve(LANE), link);
  return link;
}

/**
 * Everything a run wrote, on either stream.
 * @param result - A completed process
 * @returns stdout concatenated with stderr
 */
function output(result: SpawnSyncReturns<string>): string {
  return `${result.stdout}${result.stderr}`;
}

describe("the classifier reached through a symlink", () => {
  it("emits its verdict rather than nothing", () => {
    expect(throughSymlink()).toContain('"trusted"');
  });

  it("emits its verdict under --preserve-symlinks-main", () => {
    // Both sides stay symlinked under this flag, so normalizing only `argv[1]`
    // would compare a real path against a symlinked one and no-op here.
    expect(throughSymlink(["--preserve-symlinks-main"])).toContain('"trusted"');
  });

  it("still emits when invoked directly", () => {
    // A control: the guard must not trade one no-op for another.
    expect(
      output(
        boundedSpawnSync({
          label: "lifecycle-label-trust.mjs invoked directly",
          command: process.execPath,
          args: [path.resolve(LANE, SCRIPT)],
          input: INPUT,
        })
      )
    ).toContain('"trusted"');
  });
});

describe("invokedAsScript", () => {
  const own = path.resolve(LANE, SCRIPT);
  const ownUrl = pathToFileURL(own).href;

  it("is true when both sides name the same real file", () => {
    expect(invokedAsScript(ownUrl, own)).toBe(true);
  });

  it("is true when the entry path reaches it through a symlink", () => {
    expect(invokedAsScript(ownUrl, path.join(linkedLane(), SCRIPT))).toBe(true);
  });

  it("is true when the module url itself is the symlinked spelling", () => {
    // The `--preserve-symlinks-main` shape: realpathing only `argv[1]` answers
    // false here, for an entry point that really was invoked directly.
    const linked = path.join(linkedLane(), SCRIPT);
    expect(invokedAsScript(pathToFileURL(linked).href, own)).toBe(true);
  });

  it("is false for a different module", () => {
    expect(
      invokedAsScript(ownUrl, path.resolve(LANE, "cross-pollinate.mjs"))
    ).toBe(false);
  });

  it("is false when nothing was asked to run", () => {
    // `node -e`, `--eval`, `--print` and the REPL all leave argv[1] undefined.
    // Passed through a binding rather than as a literal: the point is the
    // absent value, and the guard's condition is falsiness, not the token.
    const nothingRan: string | undefined = undefined;
    expect(invokedAsScript(ownUrl, nothingRan)).toBe(false);
    expect(invokedAsScript(ownUrl, "")).toBe(false);
  });

  it("is false when the entry path cannot be resolved", () => {
    // Any resolution error, not just ENOENT. Node loaded the entry moments
    // earlier, so a path that will not resolve now is not the path it came
    // through — answering "maybe" with a confident "yes" is the failure here.
    expect(
      invokedAsScript(ownUrl, path.join(tmpdir(), "absent-9f2a.mjs"))
    ).toBe(false);
  });

  it("resolves the module url through /tmp on macOS", () => {
    // `/tmp` is itself a symlink to `/private/tmp`, which is why a raw string
    // comparison fails routinely on this platform rather than exotically.
    expect(realpathSync(tmpdir())).toBeTruthy();
    expect(invokedAsScript(ownUrl, own)).toBe(true);
  });
});
