/**
 * Structural and machine-token coverage for the registered automation loops.
 *
 * The skills' guidance prose is reviewed, not pinned. Two things stay pinned:
 *
 * - `/setup-automations`'s `allowed-tools` frontmatter: registration scaffolds
 *   one checked-in runbook per registered loop (#1796), so the skill must be
 *   allowed to write files.
 * - The run-outcome recording call (RBC-4, #1798). Every registered loop skill
 *   tells the agent to run `scripts/automation-run-record.mjs` with
 *   `--outcome` and `--runbook`, and that script's argv parser reads exactly
 *   those flags. Both directions are asserted: every copy of every loop skill
 *   carries the call, and the shipped parser still accepts the flags and
 *   records them.
 *
 * Every plugin root that ships the skills is asserted.
 * @module tests/unit/strategies/automations-skills
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  automationRunRecordPath,
  readAutomationRunRecords,
  runAutomationRunRecordCli,
} from "../../../plugins/src/base/scripts/automation-run-record.mjs";

/** Source + every generated skills root. */
const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
] as const;

/**
 * The six skills backing the seven registered loop-ids (lisa-intake backs both
 * intake-prd and intake-tickets).
 */
const LOOP_SKILLS = [
  "lisa-repair-intake",
  "lisa-intake",
  "lisa-exploratory-qa",
  "lisa-project-ideation",
  "lisa-monitor",
  "lisa-learnings-audit",
] as const;

/** The recorder invocation the loop skills spell and the parser reads. */
const RECORDER = "scripts/automation-run-record.mjs";
const RECORDER_FLAGS = ["--outcome", "--runbook"] as const;

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("setup-automations frontmatter", () => {
  describe.each(ROOTS.slice(0, 2))("%s/lisa-setup-automations", root => {
    const content = readSkill(root, "lisa-setup-automations");

    it("can author files (Write/Edit) so it can scaffold runbooks", () => {
      expect(content).toMatch(/allowed-tools:.*"Write"/);
      expect(content).toMatch(/allowed-tools:.*"Edit"/);
    });
  });
});

describe("registered loops record their run outcome through the shipped CLI (#1798)", () => {
  it.each(
    ROOTS.flatMap(root => LOOP_SKILLS.map(slug => [root, slug] as const))
  )("%s/%s invokes the recorder with --outcome and --runbook", (root, slug) => {
    const content = readSkill(root, slug);

    expect(content).toContain(RECORDER);
    for (const flag of RECORDER_FLAGS) {
      expect(content).toContain(flag);
    }
  });

  it("the recorder's argv parser accepts --outcome and --runbook and records them", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "lisa-run-record-"));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const code = await runAutomationRunRecordCli([
        "--loop-id",
        "intake-repair",
        "--outcome",
        "nothing-needed",
        "--summary",
        "Nothing to repair.",
        "--runbook",
        ".lisa/automations/intake-repair.runbook.md",
        "--project-root",
        projectRoot,
      ]);

      expect(code).toBe(0);
      const { records } = await readAutomationRunRecords(
        automationRunRecordPath(projectRoot, "intake-repair")
      );
      expect(records).toEqual([
        expect.objectContaining({
          outcome: "nothing-needed",
          runbook: ".lisa/automations/intake-repair.runbook.md",
        }),
      ]);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
