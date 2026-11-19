/**
 * The parts of the configure skill a program can run: its shell commands and
 * its example declaration.
 *
 * Configuring is carried out by an agent following
 * `plugins/src/base/skills/lisa-configure/SKILL.md`, and no suite can put a
 * model in a test. What a suite can do is run the commands the skill writes
 * down, exactly as written, and hold the declaration the skill teaches to the
 * code that judges declarations. These helpers lift both out of the document,
 * so the suites execute the shipped text rather than a copy of it
 * (CodySwannGT/lisa#4984).
 * @module tests/helpers/configure-skill
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { fencedBlocks } from "./audit-skill.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The skill, as authored. Every agent's copy is built from this file. */
export const CONFIGURE_SKILL_SOURCE = path.join(
  "plugins",
  "src",
  "base",
  "skills",
  "lisa-configure",
  "SKILL.md"
);

/**
 * Read the skill as it is authored.
 * @returns The document
 */
export function configureSkill(): string {
  return readFileSync(path.join(REPO_ROOT, CONFIGURE_SKILL_SOURCE), "utf8");
}

/**
 * The shell commands the skill tells the agent to run, in the order it gives
 * them.
 * @returns The content of each `bash` block
 */
export function configureSkillShellBlocks(): readonly string[] {
  return fencedBlocks(configureSkill())
    .filter(block => block.language === "bash")
    .map(block => block.content);
}

/**
 * The example declarations the skill shows the agent.
 * @returns The parsed content of each `json` block that holds a `gates` block
 */
export function configureSkillExampleDeclarations(): readonly {
  readonly gates: Readonly<Record<string, unknown>>;
}[] {
  return fencedBlocks(configureSkill())
    .filter(block => block.language === "json")
    .map(block => JSON.parse(block.content) as { readonly gates?: unknown })
    .filter(
      (document): document is { gates: Readonly<Record<string, unknown>> } =>
        typeof document.gates === "object" && document.gates !== null
    );
}
