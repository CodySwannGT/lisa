/**
 * `lisa apply` corrects the CodeRabbit config Lisa itself wrote into hosts,
 * and only that one.
 *
 * The template Lisa shipped from 2026-02-11 to 2026-03-01 turned CodeRabbit's
 * `auto_apply_labels` on with no allowlist, so the bot could put Lisa's
 * lifecycle labels back onto claimed issues. `deletions.json` keeps the file,
 * so nothing ever corrected it. These tests pin that an unedited copy — the
 * bytes prove it — is rewritten with auto-apply off and an explanatory
 * comment, that an edited copy is never touched, and that an install declines
 * rather than rewriting a reviewed file (CodySwannGT/lisa#4633).
 * @module tests/unit/migrations/correct-lisa-coderabbit-labeling
 */
import * as fse from "fs-extra";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkCoderabbitLabeling } from "../../../src/cli/doctor-coderabbit-labeling.js";
import { SHIPPED_CODERABBIT_CONFIG_DIGESTS } from "../../../src/core/coderabbit-labeling.js";
import { stillProved } from "../../../src/core/retire-unmodified.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { CorrectLisaCoderabbitLabelingMigration } from "../../../src/migrations/correct-lisa-coderabbit-labeling.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** The template Lisa shipped at 41e69a0261, byte for byte. */
const SHIPPED_TEMPLATE = fse.readFileSync(
  path.resolve(
    "tests/fixtures/coderabbit-labeling/shipped-41e69a0261.coderabbit.yml.txt"
  ),
  "utf8"
);

/** The config file name Lisa shipped. */
const CONFIG_FILE = ".coderabbit.yml";

/** The setting the shipped template turns on. */
const AUTO_APPLY_ON = "auto_apply_labels: true";

/** The corrected setting. */
const AUTO_APPLY_OFF = "auto_apply_labels: false";

describe("correct-lisa-coderabbit-labeling migration", () => {
  let tempDir: string;
  let file: string;
  const migration = new CorrectLisaCoderabbitLabelingMigration();

  /**
   * Build a migration context for the temp project.
   * @param overrides - Context fields to override
   * @returns Migration context
   */
  function ctx(overrides: Partial<MigrationContext> = {}): MigrationContext {
    return {
      projectDir: tempDir,
      lisaDir: tempDir,
      detectedTypes: ["typescript"],
      dryRun: false,
      logger: new SilentLogger(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
    file = path.join(tempDir, CONFIG_FILE);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("uses a fixture that really is the shipped template", () => {
    const digest = createHash("sha256").update(SHIPPED_TEMPLATE).digest("hex");
    expect(SHIPPED_CODERABBIT_CONFIG_DIGESTS.has(digest)).toBe(true);
  });

  it("turns auto-apply off in the unedited template and changes nothing else but a comment", async () => {
    await fse.outputFile(file, SHIPPED_TEMPLATE);

    expect(await migration.applies(ctx())).toBe(true);
    const result = await migration.apply(ctx());

    expect(result.action).toBe("applied");
    expect(result.changedFiles).toEqual([CONFIG_FILE]);
    const after = await fse.readFile(file, "utf8");
    expect(after).toContain(`    ${AUTO_APPLY_OFF}\n`);
    expect(after).not.toContain(AUTO_APPLY_ON);
    const withoutComments = (text: string): string =>
      text
        .split("\n")
        .filter(line => !line.trimStart().startsWith("#"))
        .join("\n");
    expect(withoutComments(after)).toBe(
      withoutComments(SHIPPED_TEMPLATE.replace(AUTO_APPLY_ON, AUTO_APPLY_OFF))
    );
    // The only lines added are the comment just above the flipped setting.
    expect(after.split("\n").length).toBeGreaterThan(
      SHIPPED_TEMPLATE.split("\n").length
    );
    expect(
      after.startsWith(
        SHIPPED_TEMPLATE.slice(0, SHIPPED_TEMPLATE.indexOf("issue_enrichment:"))
      )
    ).toBe(true);
    expect(after).toContain("labeling_instructions");
  });

  it("leaves a file the doctor check then passes", async () => {
    await fse.outputFile(file, SHIPPED_TEMPLATE);
    await migration.apply(ctx());

    expect((await checkCoderabbitLabeling(tempDir)).status).toBe("ok");
  });

  it("is a no-op the second time", async () => {
    await fse.outputFile(file, SHIPPED_TEMPLATE);
    await migration.apply(ctx());

    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
  });

  it("corrects a CRLF copy of the template and keeps its line endings", async () => {
    const crlf = SHIPPED_TEMPLATE.replaceAll("\n", "\r\n");
    await fse.outputFile(file, crlf);

    expect((await migration.apply(ctx())).action).toBe("applied");
    const after = await fse.readFile(file, "utf8");
    expect(after).toContain(`    ${AUTO_APPLY_OFF}\r\n`);
    expect(after.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("leaves an edited copy untouched", async () => {
    const edited = `${SHIPPED_TEMPLATE}# our own note\n`;
    await fse.outputFile(file, edited);

    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
    expect(await fse.readFile(file, "utf8")).toBe(edited);
  });

  it("does nothing when the project has no CodeRabbit config", async () => {
    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
  });

  it("only describes the change under dry-run", async () => {
    await fse.outputFile(file, SHIPPED_TEMPLATE);

    const result = await migration.apply(ctx({ dryRun: true }));

    expect(result.action).toBe("applied");
    expect(await fse.readFile(file, "utf8")).toBe(SHIPPED_TEMPLATE);
  });

  it("leaves the file alone when it is edited between the proof and the write", async () => {
    // The real re-check, with an edit landing just before it runs: the
    // window between planning and writing is where a host's work could be
    // overwritten on the strength of bytes the file no longer has.
    const edited = `${SHIPPED_TEMPLATE}# edited meanwhile\n`;
    const racing = new CorrectLisaCoderabbitLabelingMigration(
      async (filePath, proof) => {
        await fse.outputFile(filePath, edited);
        return await stillProved(filePath, proof);
      }
    );
    await fse.outputFile(file, SHIPPED_TEMPLATE);

    const result = await racing.apply(ctx());

    expect(result.action).toBe("noop");
    expect(result.message).toContain("changed after Lisa proved it unedited");
    expect(await fse.readFile(file, "utf8")).toBe(edited);
  });

  it("declines an install, naming the file and the command", async () => {
    await fse.outputFile(file, SHIPPED_TEMPLATE);

    const result = await migration.apply(ctx({ postinstallSafe: true }));

    expect(result.action).toBe("skipped");
    expect(result.changedFiles).toEqual([]);
    expect(result.message).toContain(CONFIG_FILE);
    expect(result.message).toContain("npx @codyswann/lisa@latest .");
    expect(await fse.readFile(file, "utf8")).toBe(SHIPPED_TEMPLATE);
  });
});
