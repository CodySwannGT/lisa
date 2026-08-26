/** Regression coverage for filesystem authority around scratch deletion. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createScratchNamespaceAuthority,
  removeAuthorizedScratchRoot,
} from "../../../src/configs/vitest/scratch-authority.js";
import {
  createScratchOwnerRecord,
  writeScratchOwnerRecord,
} from "../../../src/configs/vitest/scratch-owner.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Allocate one isolated authority base and register teardown.
 * @returns Fresh isolated temp base
 */
function temporaryBase(): string {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "authority-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("scratch namespace authority", () => {
  it("creates the exact direct namespace as mode 0700", () => {
    const base = temporaryBase();
    const authority = createScratchNamespaceAuthority(base);

    expect(path.dirname(authority.namespace.canonicalPath)).toBe(
      fs.realpathSync(base)
    );
    expect(fs.statSync(authority.namespace.canonicalPath).mode & 0o777).toBe(
      0o700
    );
    expect(authority.namespace.uid).toBe(process.getuid?.());
  });

  it("refuses a namespace symlink", () => {
    const base = temporaryBase();
    const outside = temporaryBase();
    fs.symlinkSync(outside, path.join(base, "lisa-scratch"));

    expect(() => createScratchNamespaceAuthority(base)).toThrow(/symlink/iu);
  });

  it("quarantines a direct owned root and unlinks internal symlinks only", () => {
    const base = temporaryBase();
    const outside = temporaryBase();
    const authority = createScratchNamespaceAuthority(base);
    const root = path.join(authority.namespace.canonicalPath, "run-42-1-abc");
    fs.mkdirSync(root, { mode: 0o700 });
    fs.writeFileSync(path.join(outside, "keep.txt"), "keep", "utf8");
    fs.symlinkSync(outside, path.join(root, "external-link"));
    const record = createScratchOwnerRecord({
      authority,
      root,
      pid: process.pid,
      processBirthFingerprint: "birth",
      suiteLabel: "unit",
      registeredPrefixes: [],
    });
    writeScratchOwnerRecord(root, record);

    expect(
      removeAuthorizedScratchRoot({
        authority,
        basename: path.basename(root),
        expectedToken: record.token,
      })
    ).toBe(true);
    expect(fs.existsSync(root)).toBe(false);
    expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe(
      "keep"
    );
  });

  it("rejects traversal instead of resolving it", () => {
    const authority = createScratchNamespaceAuthority(temporaryBase());

    expect(() =>
      removeAuthorizedScratchRoot({
        authority,
        basename: "../outside",
        expectedToken: "token",
      })
    ).toThrow(/basename/iu);
  });
});
