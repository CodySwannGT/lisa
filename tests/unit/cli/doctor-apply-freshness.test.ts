/**
 * Regression tests for CodySwannGT/lisa#2467.
 *
 * acmeorgb/frontend-v2 received no template updates for months because
 * every `lisa apply` crashed and the postinstall bootstrap threw the error
 * away. Nothing in the toolchain could say so. These tests pin the check that
 * can: a repo whose apply receipt is missing or older than the installed Lisa
 * is reported by `lisa doctor` without anyone running apply by hand.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkApplyFreshness,
  checkYamlRuntime,
} from "../../../src/cli/doctor-apply-freshness.js";
import { getPackageVersion } from "../../../src/cli/version.js";
import type { ApplyMode } from "../../../src/core/apply-receipt.js";
import {
  APPLY_RECEIPT_SCHEMA_VERSION,
  readApplyReceipt,
  recordSuccessfulApply,
  resolveApplyReceiptPath,
} from "../../../src/core/apply-receipt.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CHECK_NAME = "Templates applied by this Lisa version?";
const MANIFEST = "package.json";
const LISA_DEP = "@codyswann/lisa";
const FULL: ApplyMode = "full";
const POSTINSTALL_SAFE: ApplyMode = "postinstall-safe";
const APPLIED_AT = "2026-01-15T10:00:00.000Z";

describe("apply freshness doctor check", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Write a host manifest declaring Lisa as a devDependency.
   * @param extra - Extra manifest fields
   */
  async function writeHostManifest(extra: object = {}): Promise<void> {
    await fs.writeJson(path.join(projectDir, MANIFEST), {
      name: "host-project",
      devDependencies: { [LISA_DEP]: "^3.0.0" },
      ...extra,
    });
  }

  /**
   * Write a receipt claiming an apply completed at the given version.
   * @param version - Lisa version to stamp
   * @param applyMode - Whether that apply was full or postinstall-safe
   * @param appliedAt - ISO timestamp
   */
  async function writeReceipt(
    version: string,
    applyMode: ApplyMode = FULL,
    appliedAt = APPLIED_AT
  ): Promise<void> {
    const receiptPath = resolveApplyReceiptPath(projectDir);
    await fs.ensureDir(path.dirname(receiptPath));
    await fs.writeJson(receiptPath, {
      schema_version: APPLY_RECEIPT_SCHEMA_VERSION,
      lisa_version: version,
      applied_at: appliedAt,
      harness: "fleet",
      apply_mode: applyMode,
    });
  }

  it("reports a repo that has never successfully applied", async () => {
    await writeHostManifest();

    const check = await checkApplyFreshness(projectDir);

    expect(check.name).toBe(CHECK_NAME);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("No successful Lisa apply has ever been");
    // Must name the installed version and the command that reproduces it.
    expect(check.detail).toContain(getPackageVersion());
    expect(check.detail).toContain("--skip-git-check");
  });

  it("names the version a stale repo last applied at", async () => {
    await writeHostManifest();
    await writeReceipt("2.342.2");

    const check = await checkApplyFreshness(projectDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(
      "has not successfully applied templates since Lisa 2.342.2"
    );
    expect(check.detail).toContain("2026-01-15");
    expect(check.detail).toContain(getPackageVersion());
  });

  it("passes when the receipt matches the installed version", async () => {
    await writeHostManifest();
    await writeReceipt(getPackageVersion());

    const check = await checkApplyFreshness(projectDir);

    expect(check.status).toBe("ok");
    expect(check.detail).toContain(getPackageVersion());
  });

  it("does not warn about a repo that is newer than the installed Lisa", async () => {
    await writeHostManifest();
    await writeReceipt("999.0.0");

    expect((await checkApplyFreshness(projectDir)).status).toBe("ok");
  });

  it("reports work postinstall-safe mode skipped even when the version is current", async () => {
    // The second silent-staleness class: a package install can never run the
    // agent emits, so `.codex/config.toml` stays unreconciled on the newest
    // Lisa and nothing said so (acme-product-b#734, same shape as #2436).
    await writeHostManifest();
    await writeReceipt(getPackageVersion(), POSTINSTALL_SAFE);

    const check = await checkApplyFreshness(projectDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(POSTINSTALL_SAFE);
    expect(check.detail).toContain("agent emit");
    expect(check.detail).toContain(".codex/config.toml");
    // Must point at a FULL apply, not the postinstall-safe one that caused it.
    expect(check.detail).toContain(
      "node node_modules/@codyswann/lisa/dist/index.js ."
    );
  });

  it("stays quiet when a receipt predates the apply-mode field", async () => {
    await writeHostManifest();
    const receiptPath = resolveApplyReceiptPath(projectDir);
    await fs.ensureDir(path.dirname(receiptPath));
    await fs.writeJson(receiptPath, {
      schema_version: APPLY_RECEIPT_SCHEMA_VERSION,
      lisa_version: getPackageVersion(),
      applied_at: APPLIED_AT,
      harness: "fleet",
    });

    expect((await checkApplyFreshness(projectDir)).status).toBe("ok");
  });

  it("treats an unreadable or wrong-schema receipt as no receipt", async () => {
    await writeHostManifest();
    const receiptPath = resolveApplyReceiptPath(projectDir);
    await fs.ensureDir(path.dirname(receiptPath));
    await fs.writeFile(receiptPath, "{ not json");

    expect((await checkApplyFreshness(projectDir)).status).toBe("warn");

    await fs.writeJson(receiptPath, {
      schema_version: 99,
      lisa_version: "3.0.0",
      applied_at: APPLIED_AT,
    });

    expect((await checkApplyFreshness(projectDir)).status).toBe("warn");
  });

  it("stays silent for projects that do not depend on Lisa", async () => {
    await fs.writeJson(path.join(projectDir, MANIFEST), {
      name: "unrelated",
    });

    expect((await checkApplyFreshness(projectDir)).status).toBe("ok");
  });

  it("stays silent for the Lisa source repo, which never self-applies", async () => {
    await fs.writeJson(path.join(projectDir, MANIFEST), {
      name: LISA_DEP,
      devDependencies: { [LISA_DEP]: "^3.0.0" },
    });

    const check = await checkApplyFreshness(projectDir);

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("source repo");
  });
});

describe("apply receipt", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("records the version, harness and timestamp of a completed apply", async () => {
    const written = await recordSuccessfulApply(
      projectDir,
      {
        lisaVersion: "3.4.0",
        harness: "fleet",
        applyMode: FULL,
        stalePaths: [],
        deletedPaths: [],
      },
      () => new Date("2026-08-12T09:30:00.000Z")
    );

    expect(written).toBe(true);
    expect(await readApplyReceipt(projectDir)).toEqual({
      schema_version: APPLY_RECEIPT_SCHEMA_VERSION,
      lisa_version: "3.4.0",
      applied_at: "2026-08-12T09:30:00.000Z",
      harness: "fleet",
      apply_mode: FULL,
      stale_paths: [],
      deleted_paths: [],
    });
  });

  it("never throws when the receipt cannot be written", async () => {
    // A file where the .lisa directory needs to be: mkdir fails, apply must not.
    await fs.writeFile(path.join(projectDir, ".lisa"), "not a directory");

    await expect(
      recordSuccessfulApply(projectDir, {
        lisaVersion: "3.4.0",
        harness: "fleet",
        applyMode: POSTINSTALL_SAFE,
        stalePaths: [],
        deletedPaths: [],
      })
    ).resolves.toBe(false);
  });

  it("reports no receipt for a project that has never applied", async () => {
    expect(await readApplyReceipt(projectDir)).toBeNull();
  });
});

describe("yaml runtime doctor check", () => {
  it("passes on the js-yaml this build resolved", () => {
    const check = checkYamlRuntime();

    expect(check.status).toBe("ok");
    expect(check.name).toBe("YAML runtime usable?");
  });
});
