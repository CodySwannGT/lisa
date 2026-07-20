/** OpenCode distribution parity for Lisa's Kane provider skills. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_SKILLS_SUBDIR,
  installSkills,
} from "../../../src/opencode/skills-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const KANE_PROVIDER = "lisa-kane-browser";
const KANE_SETUP = "lisa-setup-kane";

describe("OpenCode Kane skill parity", () => {
  let destination: string;

  beforeEach(async () => {
    destination = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(destination);
  });

  it("installs the canonical guarded provider and setup skills verbatim", async () => {
    const lisaRoot = path.resolve(".");
    const result = await installSkills(lisaRoot, destination, []);
    const installedNames = result.installed.map(skill => skill.name);
    const provider = await fs.readFile(
      path.join(
        destination,
        ".opencode",
        LISA_SKILLS_SUBDIR,
        KANE_PROVIDER,
        "SKILL.md"
      ),
      "utf8"
    );
    const setup = await fs.readFile(
      path.join(
        destination,
        ".opencode",
        LISA_SKILLS_SUBDIR,
        KANE_SETUP,
        "SKILL.md"
      ),
      "utf8"
    );

    expect(installedNames).toEqual(
      expect.arrayContaining([KANE_PROVIDER, KANE_SETUP])
    );
    expect(provider).toMatch(/cloudUploadApproved/i);
    expect(provider).toMatch(/Kane never replaces|Do not replace Playwright/is);
    expect(setup).toMatch(/Ask exactly one approval question/i);
  });
});
