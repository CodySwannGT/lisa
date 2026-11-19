/**
 * The parts of the attest skill a program can read and run: its two kinds of
 * run, its steps and its shell commands.
 *
 * Attesting is carried out by an agent following
 * `plugins/src/base/skills/lisa-attest/SKILL.md`, and no suite can put a
 * model in a test. What a suite can do is run the commands the skill writes
 * down, exactly as written, and hold the order and the wording of its steps
 * to what the skill promises: that a verdict is only ever read from the
 * verdict file after the check has passed. These helpers lift both out of
 * the document, so the suites read the shipped text rather than a copy of it
 * (CodySwannGT/lisa#5001).
 * @module tests/helpers/attest-skill
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { fencedBlocks } from "./audit-skill.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The skill, as authored. Every agent's copy is built from this file. */
export const ATTEST_SKILL_SOURCE = path.join(
  "plugins",
  "src",
  "base",
  "skills",
  "lisa-attest",
  "SKILL.md"
);

/** The heading the before-enforce run starts at. */
export const BEFORE_ENFORCE_HEADING = "## The before-enforce run";

/** How a line begins when it starts a list item, a table row or a quote. */
const STARTS_A_BLOCK: readonly RegExp[] = [/^[-*>|] /u, /^\d{1,2}\. /u];

/** Where one sentence ends and the next begins, inside one block. */
const SENTENCE_END = /(?<=[.!?:]) (?=[A-Z`*"'[(])/u;

/** The two kinds of run the skill describes. */
export type AttestSkillRun = "attest" | "before-enforce";

/** One step of the skill. */
export interface AttestSkillStep {
  /** The heading, without the `### `. */
  readonly title: string;
  /** Everything under the heading, up to the next one. */
  readonly body: string;
  /** Its number within its own run. */
  readonly number: number;
}

/**
 * Read the skill as it is authored.
 * @returns The document
 */
export function attestSkill(): string {
  return readFileSync(path.join(REPO_ROOT, ATTEST_SKILL_SOURCE), "utf8");
}

/**
 * The part of the skill that describes one kind of run.
 *
 * The attest run is everything before the before-enforce heading, the
 * preflight both runs share included; the before-enforce run is everything
 * from that heading on.
 * @param run - Which kind of run
 * @returns That part of the document
 * @throws {Error} When the skill no longer has the heading, so a suite can
 *   never pass by reading an empty section
 */
export function attestSkillSection(run: AttestSkillRun): string {
  const skill = attestSkill();
  const at = skill.indexOf(`\n${BEFORE_ENFORCE_HEADING}\n`);
  if (at === -1) {
    throw new Error(`The attest skill has no "${BEFORE_ENFORCE_HEADING}"`);
  }
  return run === "attest" ? skill.slice(0, at) : skill.slice(at);
}

/**
 * The shell commands of one kind of run, in the order the skill gives them.
 * @param run - Which kind of run
 * @returns The content of each `bash` block
 */
export function attestSkillShellBlocks(run: AttestSkillRun): readonly string[] {
  return fencedBlocks(attestSkillSection(run))
    .filter(block => block.language === "bash")
    .map(block => block.content);
}

/**
 * The steps of one kind of run.
 * @param run - Which kind of run
 * @returns One entry per `###` heading, in order
 */
export function attestSkillSteps(
  run: AttestSkillRun
): readonly AttestSkillStep[] {
  return attestSkillSection(run)
    .split(/^### /mu)
    .slice(1)
    .map(section => {
      const title = section.slice(0, section.indexOf("\n"));
      return {
        title,
        body: section.slice(section.indexOf("\n")),
        number: Number(/step (\d+):/iu.exec(title)?.[1]),
      };
    });
}

/**
 * The sentences of a piece of the skill, each on one line.
 *
 * Markdown wraps a sentence over several lines, and a table row or a list
 * item is a sentence of its own. So the text is cut at blank lines, table
 * rows and list markers first, and at full stops after that.
 * @param text - A piece of the skill
 * @returns Each sentence, with its line breaks turned into spaces
 */
export function sentencesOf(text: string): readonly string[] {
  const blocks = text.split("\n").reduce<readonly string[]>((done, line) => {
    const words = line.trim();
    const startsBlock =
      words === "" || STARTS_A_BLOCK.some(marker => marker.test(words));
    const last = done.at(-1);
    return startsBlock || last === undefined
      ? [...done, words]
      : [...done.slice(0, -1), `${last} ${words}`];
  }, []);
  return blocks
    .flatMap(block => block.split(SENTENCE_END))
    .map(sentence => sentence.trim())
    .filter(sentence => sentence !== "");
}
