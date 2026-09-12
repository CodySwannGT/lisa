/**
 * The tables and the classification the installed-base CDK check stands on.
 *
 * Two things are pinned here and nowhere else. The first is that the tables
 * still describe the preset that actually ships: `CDK_PRESET_ARTIFACTS` is
 * derived back out of the stack trees and `CDK_PRESET_FORCED_DEPENDENCIES` out
 * of the package template, so an artifact or dependency added to the preset
 * later cannot leave the installed-base check reading an out-of-date list. The
 * second is that the classification keeps four states apart, and in particular
 * that a repository holding a `cdk.json` Lisa seeded for it does not read as a
 * CDK app just because the marker is present (CodySwannGT/lisa#3711).
 * @module tests/unit/core/cdk-preset-adoption
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CDK_APP_MARKER,
  CDK_PRESET_ARTIFACTS,
  CDK_PRESET_BIN_ENTRY,
  CDK_PRESET_FORCED_DEPENDENCIES,
  cdkAppEntrySource,
  classifyCdkPresetAdoption,
} from "../../../src/core/cdk-preset-adoption.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

const COPY_OVERWRITE = "copy-overwrite";

/** The entry the CDK template's seeded `app` command names. */
const SEEDED_ENTRY = "bin/infrastructure.ts";

/**
 * Sort strings by locale comparison, so the assertions compare sets rather
 * than incidental ordering.
 * @param left - First string
 * @param right - Second string
 * @returns Standard comparator result
 */
function byName(left: string, right: string): number {
  return left.localeCompare(right);
}

/**
 * A directory placeholder, excluded from the exclusivity derivation: any
 * repository may create one for its own reasons, so its presence says nothing
 * about which preset was applied.
 */
const PLACEHOLDER = ".keep";

/**
 * Every file under a directory, as repo-relative POSIX paths.
 * @param root - Directory to walk
 * @returns Relative paths of every file beneath it
 */
async function filesUnder(root: string): Promise<readonly string[]> {
  const entries = await fs.readdir(root, {
    withFileTypes: true,
    recursive: true,
  });
  return entries
    .filter(entry => entry.isFile())
    .map(entry =>
      path
        .relative(root, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );
}

/**
 * Stack directories that ship a `copy-overwrite` tree.
 * @returns Stack directory names
 */
async function stacksWithCopyOverwrite(): Promise<readonly string[]> {
  const entries = await fs.readdir(REPO_ROOT, { withFileTypes: true });
  const candidates = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  const shipping: string[] = [];
  for (const candidate of candidates) {
    if (await fs.pathExists(path.join(REPO_ROOT, candidate, COPY_OVERWRITE))) {
      shipping.push(candidate);
    }
  }
  return shipping;
}

describe("CDK preset tables track what the preset actually ships", () => {
  it("lists exactly the copy-overwrite artifacts only the CDK stack ships", async () => {
    // Derived rather than restated: a check that keys on a stale artifact list
    // reports "no CDK preset here" for a repository carrying a newer one, and
    // an installed base that cannot find itself is the defect being fixed.
    const stacks = await stacksWithCopyOverwrite();
    expect(stacks).toContain("cdk");
    const cdkFiles = new Set(
      await filesUnder(path.join(REPO_ROOT, "cdk", COPY_OVERWRITE))
    );
    const elsewhere = new Set<string>();
    for (const stack of stacks.filter(name => name !== "cdk")) {
      for (const file of await filesUnder(
        path.join(REPO_ROOT, stack, COPY_OVERWRITE)
      )) {
        elsewhere.add(file);
      }
    }
    const exclusive = [...cdkFiles]
      .filter(file => !elsewhere.has(file))
      .filter(file => path.basename(file) !== PLACEHOLDER)
      .sort(byName);

    expect([...CDK_PRESET_ARTIFACTS].sort(byName)).toEqual(exclusive);
  });

  it("lists exactly the runtime dependencies the preset force-merges", async () => {
    const template = (await fs.readJson(
      path.join(REPO_ROOT, "cdk", "package-lisa", "package.lisa.json")
    )) as {
      force: {
        dependencies: Record<string, string>;
        bin: Record<string, string>;
      };
    };

    expect([...CDK_PRESET_FORCED_DEPENDENCIES].sort(byName)).toEqual(
      Object.keys(template.force.dependencies).sort(byName)
    );
    expect(template.force.bin[CDK_PRESET_BIN_ENTRY.name]).toBe(
      CDK_PRESET_BIN_ENTRY.target
    );
  });

  it("uses the same marker the CDK stack seeds under create-only", async () => {
    // The marker is itself part of what the preset delivers, which is why the
    // check cannot stop at its presence.
    expect(
      await fs.pathExists(
        path.join(REPO_ROOT, "cdk", "create-only", CDK_APP_MARKER)
      )
    ).toBe(true);
  });
});

describe("cdkAppEntrySource", () => {
  it("reads the entry out of the command the CDK template seeds", () => {
    expect(cdkAppEntrySource(`npx tsx ${SEEDED_ENTRY}`)).toBe(SEEDED_ENTRY);
  });

  it("reads a quoted entry", () => {
    expect(cdkAppEntrySource('npx ts-node "bin/app.ts"')).toBe("bin/app.ts");
  });

  it("declines rather than guessing when no source file is named", () => {
    expect(cdkAppEntrySource("dotnet run --project Infra")).toBeNull();
  });

  it("declines rather than guessing when more than one source is named", () => {
    expect(cdkAppEntrySource("node --require reg.js bin/app.js")).toBeNull();
  });
});

describe("classifyCdkPresetAdoption", () => {
  const artifacts = [...CDK_PRESET_ARTIFACTS];

  it("says absent when no preset artifact is present", () => {
    expect(
      classifyCdkPresetAdoption({
        presetArtifacts: [],
        hasAppMarker: false,
        appEntry: null,
      })
    ).toBe("absent");
  });

  it("says ineligible when the preset is present with no marker", () => {
    expect(
      classifyCdkPresetAdoption({
        presetArtifacts: artifacts,
        hasAppMarker: false,
        appEntry: null,
      })
    ).toBe("ineligible");
  });

  it("says ineligible when the marker names an entry that does not exist", () => {
    // The seeded-marker shape. `cdk.json` arrives with the preset under
    // create-only, so a repository admitted by the old predicate holds one it
    // never wrote — and a check that stopped at the marker would call it a
    // CDK app.
    expect(
      classifyCdkPresetAdoption({
        presetArtifacts: artifacts,
        hasAppMarker: true,
        appEntry: { kind: "resolved", source: SEEDED_ENTRY, present: false },
      })
    ).toBe("ineligible");
  });

  it("says eligible when the marker names an entry that exists", () => {
    expect(
      classifyCdkPresetAdoption({
        presetArtifacts: artifacts,
        hasAppMarker: true,
        appEntry: { kind: "resolved", source: SEEDED_ENTRY, present: true },
      })
    ).toBe("eligible");
  });

  it("keeps undeterminable apart from both verdicts", () => {
    expect(
      classifyCdkPresetAdoption({
        presetArtifacts: artifacts,
        hasAppMarker: true,
        appEntry: { kind: "unrecognised" },
      })
    ).toBe("undeterminable");
  });
});
