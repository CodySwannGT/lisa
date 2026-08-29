/** Regression coverage for filesystem authority around scratch deletion. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createScratchNamespaceAuthority,
  removeAuthorizedScratchRoot,
} from "../../../src/configs/vitest/scratch-authority.js";
import { withProcessPlatformTempRoot } from "../../helpers/template-toolchain.js";
import {
  MAX_SCRATCH_NAMESPACE_SCAN_ENTRIES,
  collectBoundedScratchNamespaceNames,
} from "../../../src/configs/vitest/scratch-authority.js";
import {
  createScratchOwnerRecord,
  writeScratchOwnerRecord,
} from "../../../src/configs/vitest/scratch-owner.js";
import { validateScratchRunRootIntent } from "../../../src/configs/vitest/scratch-supervision-intent.js";

const temporaryDirectories: string[] = [];
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

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
  it("rejects null root authority through the public schema error", () => {
    expect(() => validateScratchRunRootIntent({ authority: null })).toThrow(
      "Invalid scratch root intent schema"
    );
  });

  it("has no production temp-root selector and ignores a hostile legacy env", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src/configs/vitest/scratch-namespace-authority.ts"),
      "utf8"
    );
    const base = temporaryBase();
    const hostile = temporaryBase();
    const previous = process.env.LISA_TEST_SCRATCH_ROOT;
    process.env.LISA_TEST_SCRATCH_ROOT = hostile;
    try {
      const authority = withProcessPlatformTempRoot(base, () =>
        createScratchNamespaceAuthority()
      );

      expect(authority.namespace.canonicalPath).toContain(
        fs.realpathSync(base)
      );
      expect(authority.namespace.canonicalPath).not.toContain(
        fs.realpathSync(hostile)
      );
    } finally {
      if (previous === undefined) delete process.env.LISA_TEST_SCRATCH_ROOT;
      else process.env.LISA_TEST_SCRATCH_ROOT = previous;
    }
    expect(source).toContain("const baseDir = os.tmpdir();");
    expect(source).not.toMatch(
      /AsyncLocalStorage|LISA_TEST_SCRATCH_ROOT|scratchPlatformTempRoot|withScratchAuthorityTestRoot/u
    );
  });

  it("refuses an over-cap or oversized namespace scan before deletion", () => {
    const overCap = function* (): Generator<string> {
      for (
        let index = 0;
        index <= MAX_SCRATCH_NAMESPACE_SCAN_ENTRIES;
        index += 1
      ) {
        yield `run-${String(index)}-1-control`;
      }
    };

    expect(() => collectBoundedScratchNamespaceNames(overCap())).toThrow(
      /120000 entries/iu
    );
    expect(() =>
      collectBoundedScratchNamespaceNames(["x".repeat(1_025)])
    ).toThrow(/1024 bytes/iu);
  });

  it("creates the exact direct namespace as mode 0700", () => {
    const base = temporaryBase();
    const authority = withProcessPlatformTempRoot(base, () =>
      createScratchNamespaceAuthority()
    );

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

    expect(() =>
      withProcessPlatformTempRoot(base, () => createScratchNamespaceAuthority())
    ).toThrow(/symlink/iu);
  });

  it("quarantines a direct owned root and unlinks internal symlinks only", () => {
    const base = temporaryBase();
    const outside = temporaryBase();
    const authority = withProcessPlatformTempRoot(base, () =>
      createScratchNamespaceAuthority()
    );
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
    const authority = withProcessPlatformTempRoot(temporaryBase(), () =>
      createScratchNamespaceAuthority()
    );

    expect(() =>
      removeAuthorizedScratchRoot({
        authority,
        basename: "../outside",
        expectedToken: "token",
      })
    ).toThrow(/basename/iu);
  });

  it("refuses a same-uid directory swap after the quarantine identity check", () => {
    const base = temporaryBase();
    const outsideParent = temporaryBase();
    const outside = path.join(outsideParent, "outside-target");
    const holding = path.join(outsideParent, "original-quarantine");
    const authority = withProcessPlatformTempRoot(base, () =>
      createScratchNamespaceAuthority()
    );
    const root = path.join(authority.namespace.canonicalPath, "run-42-1-swap");
    fs.mkdirSync(root, { mode: 0o700 });
    fs.mkdirSync(outside, { mode: 0o700 });
    fs.writeFileSync(path.join(outside, "outside-payload.txt"), "keep", "utf8");
    const record = createScratchOwnerRecord({
      authority,
      root,
      pid: process.pid,
      processBirthFingerprint: "birth",
      suiteLabel: "unit",
      registeredPrefixes: [],
    });
    writeScratchOwnerRecord(root, record);
    writeScratchOwnerRecord(outside, record);
    let swapped = false;
    const swap = (candidate: string): void => {
      if (!swapped) {
        swapped = true;
        fs.renameSync(candidate, holding);
        fs.renameSync(outside, candidate);
      }
    };

    let failure: unknown;
    try {
      removeAuthorizedScratchRoot({
        authority,
        basename: path.basename(root),
        expectedToken: record.token,
        afterIdentityCheck: swap,
      });
    } catch (error) {
      failure = error;
    }
    expect(swapped).toBe(true);
    expect(String(failure)).toMatch(/identity changed/iu);
    const replacement = fs
      .readdirSync(authority.namespace.canonicalPath)
      .find(name => name.startsWith(".lisa-quarantine-"));
    expect(replacement).toBeDefined();
    expect(
      fs.readFileSync(
        path.join(
          authority.namespace.canonicalPath,
          replacement ?? "missing",
          "outside-payload.txt"
        ),
        "utf8"
      )
    ).toBe("keep");
  });
});
