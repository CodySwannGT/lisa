/**
 * Proof that plugin-payload CLIs run when reached through a symlink.
 *
 * `plugins/src/base/scripts/` had never been in the entry-guard sweep. Five of
 * its modules carried a defective guard and none carried a correct one — the
 * uniformity being the tell that no rule had ever applied there.
 *
 * These cannot import `scripts/lib/invoked-as-script.mjs`, because a plugin
 * payload has no `./lib/` to resolve against, so each defines the rule inline.
 * The sweep in `invoked-as-script.test.ts` now asserts that every module here
 * either routes through the helper or defines it; this file asserts the copies
 * actually WORK, which the sweep cannot see.
 *
 * Every assertion is on OUTPUT. A guard that no-ops prints nothing and exits 0,
 * which is indistinguishable from a clean run by exit status alone — and these
 * are exactly the modules whose silence is mistaken for success.
 * @module tests/unit/scripts/plugin-payload-entry-guards
 */

import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { invokedAsScript } from "../../../plugins/src/base/scripts/design-source-gate.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const LANE = "plugins/src/base/scripts";
const DESIGN_GATE = "design-source-gate.mjs";

/**
 * Each guarded CLI, with text only its body can produce.
 *
 * Matched against a marker rather than merely "some output", because a module
 * that failed to import also writes to stderr — so an emptiness check would
 * pass for a module that never reached its guard at all.
 */
const ENTRY_POINTS = [
  { script: "automation-run-record.mjs", marker: "Usage:" },
  { script: "cross-pollinate.mjs", marker: "harness" },
  { script: DESIGN_GATE, marker: "usage:" },
  { script: "plugin-sync-explain.mjs", marker: "plugin-sync-explain" },
] as const;

let temps: string[] = [];

afterEach(() => {
  for (const dir of temps) rmSync(dir, { force: true, recursive: true });
  temps = [];
});

/**
 * A symlink pointing at the lane directory, removed after the test.
 * @returns Path to the link
 */
function linkedLane(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-payload-link-"));
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

/**
 * Run one lane module through a symlink to its containing directory.
 *
 * The DIRECTORY is linked, not the file: linking a file out of its directory
 * fails under `--preserve-symlinks-main` with ERR_MODULE_NOT_FOUND because its
 * sibling imports resolve beside the link, which is a property of the fixture
 * rather than of the guard.
 * @param script - Filename within the lane
 * @param flags - Extra node flags placed ahead of the entry path
 * @returns Combined stdout and stderr
 */
function throughSymlink(script: string, flags: readonly string[] = []): string {
  const entry = path.join(linkedLane(), script);
  return output(
    boundedSpawnSync({
      label: `${script} --help through a symlink`,
      command: process.execPath,
      args: [...flags, entry, "--help"],
    })
  );
}

describe("plugin-payload CLIs reached through a symlink", () => {
  it.each(ENTRY_POINTS)("runs its body: $script", ({ script, marker }) => {
    expect(throughSymlink(script)).toContain(marker);
  });

  it.each(ENTRY_POINTS)(
    "runs its body under --preserve-symlinks-main: $script",
    ({ script, marker }) => {
      // Both sides stay symlinked under this flag, so a fix that normalized
      // only `argv[1]` would reintroduce the no-op precisely here.
      expect(throughSymlink(script, ["--preserve-symlinks-main"])).toContain(
        marker
      );
    }
  );

  it.each(ENTRY_POINTS)(
    "still runs when invoked directly: $script",
    ({ script, marker }) => {
      // A control: the fix must not trade one no-op for another.
      expect(
        output(
          boundedSpawnSync({
            label: `${script} --help`,
            command: process.execPath,
            args: [path.resolve(LANE, script), "--help"],
          })
        )
      ).toContain(marker);
    }
  );
});

describe("design-source-gate's guard was loose, not silent", () => {
  // The other three modules compared `import.meta.url` against a `file://`
  // string and NO-OPPED through a symlink. This one tested whether argv[1]
  // merely ENDED WITH its own basename, so it kept running through a symlink —
  // the failure is over-matching, and the symlink cases above cannot see it.
  const own = path.resolve(LANE, DESIGN_GATE);
  const ownUrl = pathToFileURL(own).href;

  it("refuses a different file that happens to share the basename", () => {
    // The old spelling accepted this: another checkout, a vendored copy, or any
    // path ending in `design-source-gate.mjs` ran this module's body.
    const root = mkdtempSync(path.join(tmpdir(), "lisa-payload-decoy-"));
    temps.push(root);
    const decoy = path.join(root, DESIGN_GATE);
    writeFileSync(decoy, "export {};\n");
    expect(invokedAsScript(ownUrl, decoy)).toBe(false);
  });

  it("still accepts its own file", () => {
    expect(invokedAsScript(ownUrl, own)).toBe(true);
  });

  it("survives a rename, which the basename test would not", () => {
    // The old guard named its own filename in a string literal, so renaming the
    // file turned the guard off with nothing to notice. The rule now derives
    // both sides from the running module.
    expect(
      invokedAsScript(ownUrl, path.resolve(LANE, "cross-pollinate.mjs"))
    ).toBe(false);
  });
});
