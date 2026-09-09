/**
 * Doctor coverage for a "managed by Lisa" banner that has gone false.
 *
 * A consumer carrying a workflow whose template was removed upstream is told,
 * by the file's own first line, that Lisa replaces it on every run and that a
 * local fix is pointless. Nothing replaces it and the fix is not pointless. A
 * proposal to remove one such workflow was declined on exactly that false
 * premise (CodySwannGT/lisa#3703).
 *
 * These tests pin the check that lets such a repository find itself, the four
 * lookalike shapes it must stay quiet about, and — the arm that matters most —
 * that a probe which could not read the package reports so rather than
 * condemning every banner in the repository at once.
 * @module tests/unit/cli/doctor-stale-managed-banner
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkStaleManagedBanner,
  STALE_MANAGED_BANNER_CHECK_NAME,
} from "../../../src/cli/doctor-stale-managed-banner.js";
import { LISA_PACKAGE_NAME } from "../../../src/core/self-apply.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** The header a `copy-overwrite` template carries, as shipped. */
const MANAGED_HEADER = [
  "# This file is managed by Lisa and IS replaced on each `lisa` run.",
  "# Do not edit directly — durable changes belong upstream in Lisa.",
  "",
  "name: workflow",
].join("\n");

/** The header a `create-only` template carries, as shipped. */
const SEEDED_HEADER = [
  "# Seeded by Lisa on first setup — this file is YOURS.",
  "# Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)",
  "",
  "name: workflow",
].join("\n");

/** Repo-relative path of the workflow whose template was removed upstream. */
const BUILD_WORKFLOW = ".github/workflows/build.yml";

/** What the check says when it declines to answer. */
const UNDETERMINED = "Could not determine";

/** A workflow the host wrote, carrying no ownership header at all. */
const HOST_WORKFLOW = "name: nightly\non:\n  workflow_dispatch:\n";

describe("doctor stale managed-banner check", () => {
  let target: string;
  let lisaRoot: string;

  /**
   * Write a file, creating its parent directories.
   * @param root - Directory the path is relative to
   * @param relativePath - Repo-relative path to write
   * @param contents - File contents
   */
  const write = async (
    root: string,
    relativePath: string,
    contents: string
  ): Promise<void> => {
    const absolute = path.join(root, relativePath);
    await fse.ensureDir(path.dirname(absolute));
    await fse.writeFile(absolute, contents);
  };

  beforeEach(async () => {
    target = await createTempDir();
    lisaRoot = await createTempDir();
    await fse.writeJson(path.join(target, "package.json"), {
      name: "a-consumer",
    });
    await write(
      lisaRoot,
      "all/copy-overwrite/.github/workflows/quality.yml",
      MANAGED_HEADER
    );
    await write(
      lisaRoot,
      "all/create-only/.github/workflows/ci.yml",
      SEEDED_HEADER
    );
    await write(target, ".github/workflows/quality.yml", MANAGED_HEADER);
  });

  afterEach(async () => {
    await cleanupTempDir(target);
    await cleanupTempDir(lisaRoot);
  });

  it("names a workflow whose template the installed package no longer ships", async () => {
    await write(target, BUILD_WORKFLOW, MANAGED_HEADER);

    const check = await checkStaleManagedBanner(target, lisaRoot);

    expect(check.name).toBe(STALE_MANAGED_BANNER_CHECK_NAME);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(BUILD_WORKFLOW);
    expect(check.detail).toContain("yours");
  });

  it("stays quiet when every managed banner still has a template", async () => {
    const check = await checkStaleManagedBanner(target, lisaRoot);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain("quality.yml");
  });

  it("stays quiet about a file the host wrote itself", async () => {
    await write(target, ".github/workflows/nightly.yml", HOST_WORKFLOW);

    const check = await checkStaleManagedBanner(target, lisaRoot);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain("nightly.yml");
  });

  it("stays quiet about a seed header, which claims nothing to be wrong about", async () => {
    await write(target, ".github/workflows/deploy.yml", SEEDED_HEADER);

    const check = await checkStaleManagedBanner(target, lisaRoot);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain("deploy.yml");
  });

  it("leaves a template that merely moved to create-only to its own ticket", async () => {
    await write(target, ".github/workflows/ci.yml", MANAGED_HEADER);

    const check = await checkStaleManagedBanner(target, lisaRoot);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain("ci.yml");
  });

  it("reports that it could not determine, rather than condemning every banner, when the package ships nothing", async () => {
    await write(target, BUILD_WORKFLOW, MANAGED_HEADER);
    const emptyRoot = await createTempDir();

    const check = await checkStaleManagedBanner(target, emptyRoot);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(UNDETERMINED);
    expect(check.detail).not.toContain(BUILD_WORKFLOW);
    await cleanupTempDir(emptyRoot);
  });

  it("reports that it could not determine when a directory refuses to be read", async () => {
    await write(target, BUILD_WORKFLOW, MANAGED_HEADER);

    const check = await checkStaleManagedBanner(target, lisaRoot, {
      readDirectory: async absolute => {
        if (absolute.includes(".github")) {
          throw Object.assign(new Error("permission denied"), {
            code: "EACCES",
          });
        }
        return [];
      },
    });

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(UNDETERMINED);
    expect(check.detail).not.toContain(BUILD_WORKFLOW);
  });

  it("reports that it could not determine when the installed Lisa is behind the one that applied here", async () => {
    await write(target, BUILD_WORKFLOW, MANAGED_HEADER);
    await fse.outputJson(path.join(target, ".lisa", "apply-receipt.json"), {
      schema_version: 1,
      lisa_version: "9999.0.0",
      applied_at: new Date().toISOString(),
      harness: "claude",
      apply_mode: "full",
      stale_paths: [],
      deleted_paths: [],
    });

    const check = await checkStaleManagedBanner(target, lisaRoot);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(UNDETERMINED);
    expect(check.detail).toContain("9999.0.0");
    expect(check.detail).not.toContain(BUILD_WORKFLOW);
  });

  it("stands down in Lisa's own repository, which authors the files it ships", async () => {
    await write(target, BUILD_WORKFLOW, MANAGED_HEADER);
    await fse.writeJson(path.join(target, "package.json"), {
      name: LISA_PACKAGE_NAME,
    });

    const check = await checkStaleManagedBanner(target, lisaRoot);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain(BUILD_WORKFLOW);
  });
});
