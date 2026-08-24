/**
 * An orphaned cache directory is not an installed version.
 *
 * The plugin cache is append-mostly: uninstalling a plugin does not delete its
 * version directories, it stamps each one with `.orphaned_at`. So what is on
 * disk is a record of every version ever fetched, not of what is installed now.
 *
 * `resolveCurrentVersion` read it as the latter — MAX semver across whatever
 * directories exist — and therefore manufactured a "current upstream version"
 * out of leftovers. Measured: all ten cached `safety-net` versions were
 * orphaned in a single sweep ten days before the gate fired, and the resulting
 * comparison blocked every push from the checkout.
 *
 * The tell was the oscillation. Hours earlier the same gate on the same machine
 * blocked in the OPPOSITE direction and was answered by pinning DOWN; now it
 * blocked the other way and the obvious answer was to pin UP. Both remedies
 * look right and neither is stable, because the pin is not the variable — the
 * resolver is.
 * @module tests/unit/scripts/plugin-parity-orphaned-versions
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveCurrentVersion } from "../../../scripts/plugin-parity-drift.mjs";

/** The marketplace id every fixture here uses. */
const MARKETPLACE = "cc-marketplace";

/** The plugin name every fixture here uses. */
const PLUGIN = "safety-net";

/** The status the detector already has for a plugin that is not installed. */
const NOT_INSTALLED = "not-installed";

/** A live version older than the orphaned one, in the decisive case. */
const OLDER = "1.0.6";

/** An orphaned version newer than the live one. */
const NEWER = "2.0.4";

/** The manifest directory name inside each cached version. */
const PLUGIN_MANIFEST_DIR = ".claude-plugin";

/** The manifest filename inside {@link PLUGIN_MANIFEST_DIR}. */
const PLUGIN_MANIFEST = "plugin.json";

/** The marker the plugin manager stamps onto an uninstalled version. */
const ORPHAN_MARKER = ".orphaned_at";

let cacheRoot = "";

/**
 * Seed one cached version directory.
 * @param version Semver, used as both directory name and manifest version.
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
    // The marker's CONTENT is a timestamp, but only its presence is load-
    // bearing, so the assertions must not depend on the value.
    fs.writeFileSync(path.join(dir, ORPHAN_MARKER), "1786727141296");
  }
}

beforeEach(() => {
  cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-parity-cache-"));
});

afterEach(() => {
  fs.removeSync(cacheRoot);
});

describe("resolveCurrentVersion with orphaned cache directories", () => {
  it("reports not-installed when every cached version is orphaned", () => {
    // The state that blocked the fleet: ten versions on disk, none installed.
    for (const version of ["0.9.0", "1.0.1", OLDER, "2.0.1", NEWER]) {
      seedVersion(version, true);
    }

    const resolved = resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE);

    expect(resolved.status).toBe(NOT_INSTALLED);
    expect(resolved.version).toBeNull();
  });

  it("resolves to a LIVE older version rather than an orphaned newer one", () => {
    // The decisive case, and the reason the filter must run BEFORE the max.
    //
    //   filter-then-max  -> 1.0.6          (correct: 1.0.6 IS installed)
    //   max-then-check   -> not-installed  (wrong)
    //
    // Both readings of "ignore orphans" agree everywhere except here, so this
    // is the only case that tells them apart.
    seedVersion(OLDER, false);
    seedVersion(NEWER, true);

    const resolved = resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE);

    expect(resolved.status).toBe("ok");
    expect(resolved.version).toBe(OLDER);
  });

  it("does not let an orphaned older version drag down a live newer one", () => {
    // The mirror of the case above, so "prefer the older one" cannot pass by
    // accident.
    seedVersion(OLDER, true);
    seedVersion(NEWER, false);

    const resolved = resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE);

    expect(resolved.status).toBe("ok");
    expect(resolved.version).toBe(NEWER);
  });

  it("still takes the max when nothing is orphaned", () => {
    // The control. It passes before AND after the fix, deliberately: it is
    // what proves the change did not simply stop resolving versions.
    seedVersion(OLDER, false);
    seedVersion(NEWER, false);

    const resolved = resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE);

    expect(resolved.status).toBe("ok");
    expect(resolved.version).toBe(NEWER);
  });

  it("still reports unresolved for a LIVE directory with an unreadable manifest", () => {
    // The distinction the orphan filter must not erase, and an existing test
    // caught me erasing it. "Nothing is installed" and "something is installed
    // but I cannot read its version" are different answers: collapsing them
    // would answer "I cannot read this" with "this is not here", sending an
    // operator to look for the wrong thing.
    const dir = path.join(cacheRoot, MARKETPLACE, PLUGIN, "unknown");
    fs.ensureDirSync(path.join(dir, PLUGIN_MANIFEST_DIR));
    fs.writeJsonSync(path.join(dir, PLUGIN_MANIFEST_DIR, PLUGIN_MANIFEST), {
      version: "not-a-semver",
    });

    const resolved = resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE);

    expect(resolved.status).toBe("unresolved");
    expect(resolved.version).toBeNull();
  });

  it("reports not-installed when the plugin has no cache directory at all", () => {
    // The pre-existing behaviour, pinned so the new empty-after-filtering path
    // cannot diverge from it. Both mean the same thing to a reader.
    const resolved = resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE);

    expect(resolved.status).toBe(NOT_INSTALLED);
    expect(resolved.version).toBeNull();
  });

  it("ignores the orphan marker's contents, keying only on its presence", () => {
    // A marker written with an empty body, a different timestamp format, or
    // anything else must still count. Keying on the value would make this
    // dependent on a format nobody here controls.
    const dir = path.join(cacheRoot, MARKETPLACE, PLUGIN, NEWER);
    fs.ensureDirSync(path.join(dir, PLUGIN_MANIFEST_DIR));
    fs.writeJsonSync(path.join(dir, PLUGIN_MANIFEST_DIR, PLUGIN_MANIFEST), {
      version: NEWER,
    });
    fs.writeFileSync(path.join(dir, ORPHAN_MARKER), "");

    const resolved = resolveCurrentVersion(cacheRoot, PLUGIN, MARKETPLACE);

    expect(resolved.status).toBe(NOT_INSTALLED);
  });
});
