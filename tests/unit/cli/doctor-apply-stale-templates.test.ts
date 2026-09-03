/**
 * Regression tests for CodySwannGT/lisa#3033.
 *
 * A consumer repository bumped across two dozen versions and three
 * `copy-overwrite` assets stopped tracking upstream. Nothing overwrote them —
 * that part is correct, and deliberately so: the apply ran unattended and a
 * hand-edited root config is not Lisa's to replace without being asked
 * (#3026). The defect is that the finding did not survive the install. The
 * apply named the files on the way past, the install output scrolled away, and
 * `lisa doctor` — which the README nominates as the durable signal — reported
 * "Templates are current". The only thing that ever noticed was a fork-drift
 * guard the repository happened to run on its own; most do not.
 *
 * So these tests pin two things, and neither of them is "overwrite more":
 *   1. the receipt records which managed files were left stale, and
 *   2. doctor reads them back, names each one, and hands over a per-path
 *      `--refresh-templates=<path>` remedy rather than a repo-wide one.
 *
 * Each test below fails against the code as it stood before the fix: the
 * receipt had no `stale_paths` field to record, and doctor's only two verdicts
 * for a current receipt were "ok" and the agent-emit warning.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkApplyFreshness } from "../../../src/cli/doctor-apply-freshness.js";
import { getPackageVersion } from "../../../src/cli/version.js";
import type { ApplyMode } from "../../../src/core/apply-receipt.js";
import {
  APPLY_RECEIPT_SCHEMA_VERSION,
  readApplyReceipt,
  recordSuccessfulApply,
  resolveApplyReceiptPath,
} from "../../../src/core/apply-receipt.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const MANIFEST = "package.json";
const LISA_DEP = "@codyswann/lisa";
const POSTINSTALL_SAFE: ApplyMode = "postinstall-safe";
const APPLIED_AT = "2026-08-24T10:00:00.000Z";
const ESLINT_CONFIG = "eslint.config.ts";
const ESLINT_EXPO = "eslint.expo.ts";
const RULE_TESTS_GITKEEP = "ast-grep/rule-tests/.gitkeep";

describe("doctor reports managed files a bump left stale (#3033)", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
    await fs.writeJson(path.join(projectDir, MANIFEST), {
      name: "host-project",
      devDependencies: { [LISA_DEP]: "^3.0.0" },
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Write a receipt for an apply at the installed version.
   * @param stalePaths - Managed files that apply left out of date
   * @param applyMode - Mode the recorded apply ran in
   */
  async function writeReceipt(
    stalePaths: readonly string[],
    applyMode: ApplyMode = POSTINSTALL_SAFE
  ): Promise<void> {
    const receiptPath = resolveApplyReceiptPath(projectDir);
    await fs.ensureDir(path.dirname(receiptPath));
    await fs.writeJson(receiptPath, {
      schema_version: APPLY_RECEIPT_SCHEMA_VERSION,
      lisa_version: getPackageVersion(),
      applied_at: APPLIED_AT,
      harness: "fleet",
      apply_mode: applyMode,
      stale_paths: stalePaths,
    });
  }

  it("records the managed files an apply left out of date", async () => {
    // The receipt is the only thing that outlives a `bun install`. Before the
    // fix it stored the apply MODE and not one path, so nothing downstream
    // could report what the apply had already worked out.
    await recordSuccessfulApply(projectDir, {
      lisaVersion: getPackageVersion(),
      harness: "fleet",
      applyMode: POSTINSTALL_SAFE,
      stalePaths: [ESLINT_CONFIG, ESLINT_EXPO, RULE_TESTS_GITKEEP],
      deletedWorkflowPaths: [],
    });

    const receipt = await readApplyReceipt(projectDir);

    expect(receipt?.stale_paths).toEqual([
      ESLINT_CONFIG,
      ESLINT_EXPO,
      RULE_TESTS_GITKEEP,
    ]);
  });

  it("stops reporting a repo with stale managed files as current", async () => {
    await writeReceipt([ESLINT_CONFIG]);

    const check = await checkApplyFreshness(projectDir);

    expect(check.status).toBe("warn");
    // The exact sentence that let the fork sit undetected. A version stamp
    // being current says nothing about whether the templates are.
    expect(check.detail).not.toContain("Templates are current");
  });

  it("names every stale managed file", async () => {
    await writeReceipt([ESLINT_CONFIG, ESLINT_EXPO, RULE_TESTS_GITKEEP]);

    const check = await checkApplyFreshness(projectDir);

    expect(check.detail).toContain(ESLINT_CONFIG);
    expect(check.detail).toContain(ESLINT_EXPO);
    expect(check.detail).toContain(RULE_TESTS_GITKEEP);
  });

  it("hands over a per-path refresh remedy, not the repo-wide flag", async () => {
    await writeReceipt([ESLINT_CONFIG]);

    const check = await checkApplyFreshness(projectDir);

    // `--refresh-templates` is the only flag the unattended path honours, and
    // doctor never mentioned it. It must arrive scoped: the bare form is
    // repo-wide and would revert every deliberate fork in one command.
    expect(check.detail).toContain("--refresh-templates=<path>");
    expect(check.detail).toContain("ONE path at a time");
  });

  it("says the stale files stopped receiving security fixes", async () => {
    await writeReceipt([ESLINT_CONFIG]);

    const check = await checkApplyFreshness(projectDir);

    // The operator standing at this gate is not necessarily technical. "Out of
    // date" reads as cosmetic; the actual consequence has to be stated.
    expect(check.detail).toContain("security fixes");
  });

  it("still reports the agent-emit gap alongside the stale files", async () => {
    // Two independent things are outstanding on a postinstall-safe apply.
    // Reporting one must not shadow the other.
    await writeReceipt([ESLINT_CONFIG], POSTINSTALL_SAFE);

    const check = await checkApplyFreshness(projectDir);

    expect(check.detail).toContain(ESLINT_CONFIG);
    expect(check.detail).toContain("postinstall-safe mode");
  });

  it("names the receipt rather than printing an unreadable wall of paths", async () => {
    const many = Array.from({ length: 14 }, (_, index) => `config-${index}.ts`);
    await writeReceipt(many);

    const check = await checkApplyFreshness(projectDir);

    expect(check.detail).toContain("14 managed file(s)");
    expect(check.detail).toContain("+4 more");
    expect(check.detail).toContain(".lisa/apply-receipt.json");
  });

  it("stays quiet when a full apply left nothing stale", async () => {
    await writeReceipt([], "full");

    const check = await checkApplyFreshness(projectDir);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain("--refresh-templates");
  });

  it("says nothing about staleness for a receipt written before the field existed", async () => {
    // An older receipt cannot answer the question. Reading its silence as
    // "nothing is stale" would be the same false reassurance in a new place —
    // and raising the schema version to force the issue would tell the whole
    // installed fleet that Lisa had never applied there.
    const receiptPath = resolveApplyReceiptPath(projectDir);
    await fs.ensureDir(path.dirname(receiptPath));
    await fs.writeJson(receiptPath, {
      schema_version: APPLY_RECEIPT_SCHEMA_VERSION,
      lisa_version: getPackageVersion(),
      applied_at: APPLIED_AT,
      harness: "fleet",
      apply_mode: "full",
    });

    const receipt = await readApplyReceipt(projectDir);
    const check = await checkApplyFreshness(projectDir);

    expect(receipt?.stale_paths).toEqual([]);
    expect(check.status).toBe("ok");
  });
});
