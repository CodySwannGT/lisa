/**
 * The parts of the audit skill a program can run: its shell commands and its
 * example report.
 *
 * The audit is carried out by an agent following
 * `plugins/src/base/skills/lisa-audit/SKILL.md`, and no suite can put a model
 * in a test. What a suite can do is run the commands the skill writes down,
 * exactly as written, and check the report shape the skill teaches against the
 * code that judges reports. These helpers lift both out of the document so the
 * suites execute the shipped text rather than a copy of it
 * (CodySwannGT/lisa#4979).
 * @module tests/helpers/audit-skill
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The skill, as authored. Every agent's copy is built from this file. */
export const AUDIT_SKILL_SOURCE = path.join(
  "plugins",
  "src",
  "base",
  "skills",
  "lisa-audit",
  "SKILL.md"
);

/** One fenced block of the skill. */
export interface FencedBlock {
  /** The language the fence names, such as `bash` or `json`. */
  readonly language: string;
  /** The block's content, without the fence or the fence's indentation. */
  readonly content: string;
}

/** What reading the skill line by line has collected so far. */
interface FenceScan {
  readonly blocks: readonly FencedBlock[];
  /** The block being read, or `null` between blocks. */
  readonly open: {
    readonly language: string;
    readonly indent: number;
    readonly lines: readonly string[];
  } | null;
}

const FENCE = /^(\s*)```(\w*)\s*$/u;

/**
 * Read the fenced blocks of a Markdown document, in order.
 * @param markdown - The document
 * @returns Each block with a language, in the order it appears
 */
export function fencedBlocks(markdown: string): readonly FencedBlock[] {
  const scanned = markdown.split("\n").reduce<FenceScan>(
    (scan, line) => {
      const fence = FENCE.exec(line);
      if (scan.open === null) {
        return fence === null
          ? scan
          : {
              blocks: scan.blocks,
              open: {
                language: fence[2] ?? "",
                indent: (fence[1] ?? "").length,
                lines: [],
              },
            };
      }
      if (fence === null) {
        return {
          blocks: scan.blocks,
          open: {
            ...scan.open,
            lines: [...scan.open.lines, line.slice(scan.open.indent)],
          },
        };
      }
      return {
        blocks: [
          ...scan.blocks,
          {
            language: scan.open.language,
            content: scan.open.lines.join("\n"),
          },
        ],
        open: null,
      };
    },
    { blocks: [], open: null }
  );
  return scanned.blocks;
}

/**
 * Read the skill as it is authored.
 * @returns The document
 */
function auditSkill(): string {
  return readFileSync(path.join(REPO_ROOT, AUDIT_SKILL_SOURCE), "utf8");
}

/**
 * The shell commands the skill tells the agent to run, in the order it gives
 * them.
 * @returns The content of each `bash` block
 */
export function auditSkillShellBlocks(): readonly string[] {
  return fencedBlocks(auditSkill())
    .filter(block => block.language === "bash")
    .map(block => block.content);
}

/**
 * The example reports the skill shows the agent.
 * @returns The parsed content of each `json` block
 */
export function auditSkillExampleReports(): readonly unknown[] {
  return fencedBlocks(auditSkill())
    .filter(block => block.language === "json")
    .map(block => JSON.parse(block.content) as unknown);
}
