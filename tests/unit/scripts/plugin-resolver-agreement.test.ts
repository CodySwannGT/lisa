/**
 * The two scripts resolve a cache through ONE implementation (#3093).
 *
 * `plugin-routing-validate.mjs` imported `compareSemver` and `isValidSemver`
 * from `plugin-parity-drift.mjs` and then walked the cache itself. The shared
 * import made them look like one resolver; the duplicated walk made them two.
 * They disagreed about orphaned directories, and the disagreement was the
 * expensive kind:
 *
 * > **The fix for this class did not reach the second copy, so the class would
 * > recur with its remedy already apparently applied.**
 *
 * Someone tracing a future failure would have found a detector whose orphan
 * handling is correct and tested, an import linking the failing script to it,
 * and a failure the fix was supposed to have prevented — and concluded the
 * cause was somewhere else. It was not; it was the duplicated walk the import
 * made invisible.
 *
 * So these cases assert on **`cacheMaxVersion`**, the routing validator's own
 * entry point, and each of the two orphan cases fails against the exact pre-fix
 * source of THAT script — not the one that was already fixed. `importing the
 * fixed helper` is not evidence that a script is fixed, and that is the whole
 * lesson.
 *
 * The agreement cases run both resolvers over one fixture, so a future
 * divergence is a failing test rather than a field incident.
 * @module tests/unit/scripts/plugin-resolver-agreement
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveCurrentVersion } from "../../../scripts/plugin-parity-drift.mjs";
import { cacheMaxVersion } from "../../../scripts/plugin-routing-validate.mjs";

const MARKETPLACE = "cc-marketplace";
const PLUGIN = "safety-net";

/** The live version in the decisive case — older than the orphaned one. */
const OLDER = "1.0.6";

/** The orphaned version that manufactured a "current" 2.0.4 on the day. */
const NEWER = "2.0.4";

const PLUGIN_MANIFEST_DIR = ".claude-plugin";
const PLUGIN_MANIFEST = "plugin.json";
const ORPHAN_MARKER = ".orphaned_at";
const NOT_INSTALLED = "not-installed";

let cacheRoot = "";

/**
 * Seed one cached version directory.
 * @param version Semver, used as the directory name and the manifest version.
 * @param orphaned Whether to stamp it with an `.orphaned_at` marker.
 */
function seedVersion(version: string, orphaned: boolean): void {
  const dir = path.join(cacheRoot, MARKETPLACE, PLUGIN, version);
  fs.ensureDirSync(path.join(dir, PLUGIN_MANIFEST_DIR));
  fs.writeJsonSync(path.join(dir, PLUGIN_MANIFEST_DIR, PLUGIN_MANIFEST), {
    name: PLUGIN,
    version,
  });
  if (orphaned) {
    // Only the marker's PRESENCE is load-bearing; its content is a timestamp.
    fs.writeFileSync(path.join(dir, ORPHAN_MARKER), "1786727141296");
  }
}

/**
 * Seed a version directory carrying no usable manifest version.
 * @param version Semver used as the directory NAME only.
 * @param orphaned Whether to stamp it with an `.orphaned_at` marker.
 */
function seedNameOnly(version: string, orphaned: boolean): void {
  const dir = path.join(cacheRoot, MARKETPLACE, PLUGIN, version);
  fs.ensureDirSync(dir);
  if (orphaned) {
    fs.writeFileSync(path.join(dir, ORPHAN_MARKER), "1786727141296");
  }
}

beforeEach(() => {
  cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-resolver-"));
});

afterEach(() => {
  fs.removeSync(cacheRoot);
});

describe("cacheMaxVersion: the routing validator honours orphan markers", () => {
  it("resolves nothing when every cached version is orphaned", () => {
    // The state that blocked every push from one machine: ten versions on
    // disk, none installed, and this script reporting `cache max 2.0.4` —
    // a version manufactured out of leftovers.
    for (const version of ["0.9.0", "1.0.1", OLDER, "2.0.1", NEWER]) {
      seedVersion(version, true);
    }

    expect(
      cacheMaxVersion(cacheRoot, PLUGIN, MARKETPLACE),
      "an uninstalled plugin resolved to a version, and every artifact pinned " +
        "to anything else was reported invalid against it"
    ).toBeNull();
  });

  it("resolves the LIVE older version rather than the orphaned newer one", () => {
    // The decisive case, and the one that separates the two readings of
    // "ignore orphans":
    //
    //   filter-then-max  -> 1.0.6   (correct: 1.0.6 IS installed)
    //   max-then-check   -> null    (wrong: something IS installed)
    //
    // They agree everywhere except here, so an implementation that got the
    // order wrong would pass every other case in this file.
    seedVersion(OLDER, false);
    seedVersion(NEWER, true);

    expect(cacheMaxVersion(cacheRoot, PLUGIN, MARKETPLACE)).toBe(OLDER);
  });

  it("still takes the max when nothing is orphaned", () => {
    // The control against over-filtering: the orphan rule must not turn into
    // "prefer the older version".
    seedVersion(OLDER, false);
    seedVersion(NEWER, false);

    expect(cacheMaxVersion(cacheRoot, PLUGIN, MARKETPLACE)).toBe(NEWER);
  });
});

describe("cacheMaxVersion: the directory-name fallback is kept, and scoped", () => {
  it("accepts a semver directory name when the manifest has no version", () => {
    // This validator has always accepted a semver dir name for plugins that
    // ship no manifest version. That behaviour is this caller's one genuine
    // difference from the drift detector, and it survives the consolidation.
    seedNameOnly(OLDER, false);

    expect(cacheMaxVersion(cacheRoot, PLUGIN, MARKETPLACE)).toBe(OLDER);
  });

  it("does not accept an ORPHANED directory's name", () => {
    // The fallback reads a name, and a name is exactly what an uninstalled
    // directory keeps. Without scoping the fallback to live directories, the
    // orphan filter would be bypassed by the plugins that need the fallback.
    seedNameOnly(NEWER, true);

    expect(cacheMaxVersion(cacheRoot, PLUGIN, MARKETPLACE)).toBeNull();
  });

  it("is NOT applied by the drift detector, which reads the manifest only", () => {
    // The difference is deliberate: a `synced-from` pin is compared against
    // what a manifest declares. Pinning it here means a later "simplification"
    // that unified the two would fail rather than silently change the detector.
    seedNameOnly(OLDER, false);

    expect(resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE).status).toBe(
      "unresolved"
    );
  });
});

describe("both scripts agree about the same cache", () => {
  it("agrees that an all-orphaned cache resolves to nothing", () => {
    for (const version of [OLDER, NEWER]) {
      seedVersion(version, true);
    }

    const drift = resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE);

    expect(drift.status).toBe(NOT_INSTALLED);
    expect(drift.version).toBeNull();
    expect(cacheMaxVersion(cacheRoot, PLUGIN, MARKETPLACE)).toBeNull();
  });

  it("agrees on a live version older than an orphan", () => {
    seedVersion(OLDER, false);
    seedVersion(NEWER, true);

    const drift = resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE);

    expect(drift.status).toBe("ok");
    expect(drift.version).toBe(OLDER);
    expect(cacheMaxVersion(cacheRoot, PLUGIN, MARKETPLACE)).toBe(OLDER);
  });

  it("keeps 'not installed' and 'installed but unreadable' apart", () => {
    // Two existing detector cases caught an earlier attempt to collapse these.
    // They are different answers: telling an operator a plugin is ABSENT when
    // it is present and unreadable sends them to look for the wrong thing.
    // The routing validator collapses both to `null` because its only question
    // is whether there is a version to compare — that collapse is local to the
    // caller, and the resolver must keep the states distinct for the detector.
    const dir = path.join(cacheRoot, MARKETPLACE, PLUGIN, "1.0.0");
    fs.ensureDirSync(path.join(dir, PLUGIN_MANIFEST_DIR));
    fs.writeFileSync(
      path.join(dir, PLUGIN_MANIFEST_DIR, PLUGIN_MANIFEST),
      "{ not json"
    );

    expect(
      resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE).status,
      "a live directory with an unreadable manifest is INSTALLED and merely " +
        "unreadable; reporting it as absent is a different, wrong claim"
    ).toBe("unresolved");
  });
});
