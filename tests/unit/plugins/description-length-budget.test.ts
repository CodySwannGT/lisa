/**
 * Keep skill, agent, and command descriptions short.
 *
 * Every description is loaded into the model's context in every session, and
 * when the listing overflows, Claude Code drops descriptions — so a skill with
 * a long description can make another skill undiscoverable. A description says
 * what the skill does and when to use it; the details live in the body.
 */
import {
  globSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripClaudeOnlyCommandKeys } from "../../../scripts/lib/nest-plugin-commands.mjs";

const MAX_DESCRIPTION_CHARS = 300;
const ROOT = path.resolve(__dirname, "../../..");

/**
 * Read the frontmatter `description` of a Markdown file.
 * @param file Absolute path to the Markdown file.
 * @returns The description text, or null when there is none.
 */
function readDescription(file: string): string | null {
  const text = readFileSync(file, "utf8");
  const block = /^---\n([\s\S]*?)\n---/.exec(text);
  const body = block?.[1];
  if (body === undefined) return null;
  const line = body.split("\n").find(l => l.startsWith("description:"));
  if (!line) return null;
  const raw = line.replace(/^description:\s*/, "");
  if (raw.startsWith('"')) return JSON.parse(raw) as string;
  if (raw.startsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

const PATTERNS = [
  "plugins/src/*/skills/*/SKILL.md",
  "plugins/src/*/agents/*.md",
  "plugins/src/*/commands/**/*.md",
];

describe("description length budget", () => {
  const files = PATTERNS.flatMap(p => globSync(p, { cwd: ROOT }));

  it("finds the description surfaces", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it(`keeps every description at or under ${MAX_DESCRIPTION_CHARS} characters`, () => {
    const over = files
      .map(f => ({ f, d: readDescription(path.join(ROOT, f)) }))
      .filter(({ d }) => d !== null && d.length > MAX_DESCRIPTION_CHARS)
      .map(({ f, d }) => `${f} (${d?.length})`);
    expect(over).toEqual([]);
  });
});

describe("stripClaudeOnlyCommandKeys", () => {
  it("removes disable-model-invocation from nested command frontmatter only", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lisa-strip-keys-"));
    try {
      const commandFile = path.join(dir, "commands", "lisa", "doctor.md");
      mkdirSync(path.dirname(commandFile), { recursive: true });
      writeFileSync(
        commandFile,
        '---\ndisable-model-invocation: true\ndescription: "Check setup"\n---\n\nBody mentions disable-model-invocation: true literally.\n'
      );
      stripClaudeOnlyCommandKeys(dir);
      expect(readFileSync(commandFile, "utf8")).toBe(
        '---\ndescription: "Check setup"\n---\n\nBody mentions disable-model-invocation: true literally.\n'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op when the variant ships no commands", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lisa-strip-keys-"));
    try {
      expect(() => stripClaudeOnlyCommandKeys(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
