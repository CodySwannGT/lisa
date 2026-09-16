/** Ensure the complete observation contract reaches agents without a rules tree. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { installSkills } from "../../../src/opencode/skills-installer.js";

const REFERENCE = "lisa-usage-accounting/references/effectiveness.md";
const SOURCE = `plugins/src/base/skills/${REFERENCE}`;
const ROOTS = [
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
];

describe("effectiveness contract delivery", () => {
  it.each(ROOTS)("ships the full reference to %s", async root => {
    expect(await readFile(path.join(root, REFERENCE), "utf8")).toBe(
      await readFile(SOURCE, "utf8")
    );
    expect(
      await readFile(path.join(root, "lisa-usage-accounting/SKILL.md"), "utf8")
    ).toContain("references/effectiveness.md");
  });

  it("installs the same nested reference for OpenCode", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lisa-effectiveness-parity-")
    );
    try {
      await installSkills(process.cwd(), root, []);
      expect(
        await readFile(
          path.join(root, ".opencode/skills/lisa", REFERENCE),
          "utf8"
        )
      ).toBe(await readFile(SOURCE, "utf8"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
