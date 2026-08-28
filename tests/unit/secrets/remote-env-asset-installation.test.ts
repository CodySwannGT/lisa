/**
 * Repository installation contract for remote-environment bootstrap assets.
 *
 * A fresh remote clone runs these repository files before any plugin exists,
 * so installation must preserve all three reviewed assets byte-for-byte and
 * executable while remaining idempotent.
 * @module tests/unit/secrets/remote-env-asset-installation
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installAssets } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

const ASSET_DIR = path.resolve(
  "plugins/src/base/skills/lisa-setup-remote-env/assets"
);
const AUTHORITY = "materialized-env-authority.mjs";
const SESSION_START = "session-start.sh";
const SETUP = "setup.sh";
const INSTALLABLE = [AUTHORITY, SESSION_START, SETUP] as const;

describe("remote environment asset installation", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-assets-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("puts all three exact assets in the repository, executable", () => {
    const written = installAssets(root);
    const names = written
      .map(row => row.name)
      .sort((left, right) => left.localeCompare(right));

    expect(names).toEqual(INSTALLABLE);
    for (const name of INSTALLABLE) {
      const target = path.join(root, "scripts", "lisa-remote-env", name);
      expect(existsSync(target)).toBe(true);
      expect(readFileSync(target)).toEqual(
        readFileSync(path.join(ASSET_DIR, name))
      );
      expect(statSync(target).mode & 0o777).toBe(0o755);
    }
  });

  it("reports an unchanged file as current rather than rewriting it", () => {
    installAssets(root);
    expect(installAssets(root).every(row => row.action === "current")).toBe(
      true
    );
  });

  it("restores an edited repository copy from the reviewed asset", () => {
    installAssets(root);
    const target = path.join(root, "scripts", "lisa-remote-env", SETUP);
    writeFileSync(target, "#!/usr/bin/env bash\nexit 0\n");

    const written = installAssets(root);

    expect(written.find(row => row.name === SETUP)?.action).toBe("written");
  });
});
