/**
 * The parts of the enforce skill a program can run: its shell commands and
 * the ticket results it teaches.
 *
 * Enforcing is carried out by an agent following
 * `plugins/src/base/skills/lisa-enforce/SKILL.md`, and no suite can put a
 * model in a test. What a suite can do is run the commands the skill writes
 * down, exactly as written, and hold the document the skill has the agent
 * write to the code that reads it. These helpers lift both out of the skill,
 * so the suites execute the shipped text rather than a copy of it
 * (CodySwannGT/lisa#4994).
 * @module tests/helpers/enforce-skill
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { fencedBlocks } from "./audit-skill.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The skill, as authored. Every agent's copy is built from this file. */
const ENFORCE_SKILL_SOURCE = path.join(
  "plugins",
  "src",
  "base",
  "skills",
  "lisa-enforce",
  "SKILL.md"
);

/**
 * Read the skill as it is authored.
 * @returns The document
 */
export function enforceSkill(): string {
  return readFileSync(path.join(REPO_ROOT, ENFORCE_SKILL_SOURCE), "utf8");
}

/**
 * The shell commands the skill tells the agent to run, in the order it gives
 * them.
 * @returns The content of each `bash` block
 */
export function enforceSkillShellBlocks(): readonly string[] {
  return fencedBlocks(enforceSkill())
    .filter(block => block.language === "bash")
    .map(block => block.content);
}

/**
 * The ticket results the skill shows the agent how to write.
 * @returns The parsed content of each `json` block that holds `results`
 */
export function enforceSkillTicketExamples(): readonly Readonly<
  Record<string, unknown>
>[] {
  return fencedBlocks(enforceSkill())
    .filter(block => block.language === "json")
    .map(
      block => JSON.parse(block.content) as Readonly<Record<string, unknown>>
    )
    .filter(document => Array.isArray(document.results));
}
