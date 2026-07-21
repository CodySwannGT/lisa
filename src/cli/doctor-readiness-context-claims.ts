/**
 * Enforcement-claim extraction for the context-routing readiness producer
 * (B6, PRD #1739, #1896).
 *
 * B6 compares what the repository's instruction surfaces promise against the
 * machinery that would have to deliver it. This module does the reading half —
 * finding the sentences that assert a guarantee and the repository paths they
 * name — while its sibling turns those claims into the rubric-shaped dimension
 * record. Splitting them keeps each file inside the repository's file-size
 * budget and keeps the (deliberately conservative) claim grammar in one place.
 *
 * Every filter here is a false-positive guard. A false B6 tells an operator
 * their documentation lies when it does not, so a sentence is treated as a
 * claim only when it asserts a guarantee, is not hedged, and is not inside a
 * fenced code block — and a token is treated as a mechanism only when it is a
 * checkable repository path.
 * @module cli/doctor-readiness-context-claims
 */
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { isMechanismPath } from "./doctor-readiness-context-mechanisms.js";
import { readFileOrNull } from "./doctor-readiness-shared.js";

/** The instruction surfaces whose enforcement claims are cross-checked. */
const CLAIM_SOURCE_FILES: readonly string[] = ["README.md", "AGENTS.md"];

/** The rules directory whose every `.md` file is an instruction surface. */
const RULES_DIR = path.join(".claude", "rules");

/**
 * Phrases that assert a guarantee something else must enforce. Deliberately
 * narrow: a loose verb list ("uses", "checks") would sweep in ordinary prose and
 * turn B6 into noise the operator learns to ignore.
 */
const ENFORCEMENT_CLAIM =
  /\b(is enforced|are enforced|enforced by|enforces|is blocked by|are blocked by|blocked by|always runs|runs on every|required check|is required|hard-fails|automatically runs|automatically loaded)\b/i;

/**
 * Words that turn a sentence into an illustration, a possibility, or a plan.
 * A hedged sentence claims nothing, so it can overstate nothing.
 */
const HEDGED_CLAIM =
  /\b(example|e\.g\.|i\.e\.|for instance|if you|would|could|may|might|should|todo|planned|future|suppose|imagine|placeholder|instead of|rather than|used to)\b/i;

/** Inline-code spans, the only place a mechanism is read from. */
const INLINE_CODE = /`([^`\n]+)`/g;

/** One enforcement claim read out of an instruction surface. */
export interface EnforcementClaim {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly mechanisms: readonly string[];
}

/**
 * Extract the mechanism paths a claim line names.
 * @param line - The raw documentation line
 * @returns Repo-relative mechanism paths, deduplicated
 */
function namedMechanisms(line: string): readonly string[] {
  const tokens = [...line.matchAll(INLINE_CODE)]
    .map(match => (match[1] ?? "").trim())
    .filter(isMechanismPath)
    .map(token => token.replace(/\/$/, ""));
  return [...new Set(tokens)];
}

/**
 * Read the enforcement claims out of one instruction surface. Fenced code blocks
 * are skipped wholesale: a sample inside a fence documents a shape, not this
 * repository's guarantees.
 * @param file - Repo-relative file path
 * @param source - File contents
 * @returns The enforcement claims the file makes
 */
function extractClaims(
  file: string,
  source: string
): readonly EnforcementClaim[] {
  return proseLines(source)
    .filter(
      entry =>
        ENFORCEMENT_CLAIM.test(entry.text) && !HEDGED_CLAIM.test(entry.text)
    )
    .map(entry => ({
      file,
      line: entry.line,
      text: entry.text.trim(),
      mechanisms: namedMechanisms(entry.text),
    }));
}

/** One numbered line of prose, outside any fenced code block. */
interface ProseLine {
  readonly line: number;
  readonly text: string;
}

/**
 * Split a document into its prose lines, dropping fenced code blocks entirely.
 * A line is inside a fence when an odd number of fence markers precede it, which
 * is what makes the fence state derivable per line rather than accumulated.
 * @param source - File contents
 * @returns The prose lines, each carrying its 1-based line number
 */
function proseLines(source: string): readonly ProseLine[] {
  const lines = source.split("\n");
  const fences = lines.flatMap((text, index) =>
    text.trim().startsWith("```") ? [index] : []
  );
  return lines.flatMap((text, index) => {
    const openFences = fences.filter(fence => fence < index).length;
    return fences.includes(index) || openFences % 2 === 1
      ? []
      : [{ line: index + 1, text }];
  });
}

/**
 * Read every instruction surface a repository declares.
 * @param root - Repository root
 * @returns Every enforcement claim, in stable file order
 */
export async function collectClaims(
  root: string
): Promise<readonly EnforcementClaim[]> {
  const ruleFiles = await listRuleFiles(root);
  const sources = await Promise.all(
    [...CLAIM_SOURCE_FILES, ...ruleFiles].map(async file => ({
      file,
      source: await readFileOrNull(root, file),
    }))
  );
  return sources.flatMap(({ file, source }) =>
    source === null ? [] : extractClaims(file, source)
  );
}

/**
 * List the `.claude/rules/*.md` instruction files.
 * @param root - Repository root
 * @returns Repo-relative rule file paths, sorted
 */
async function listRuleFiles(root: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(path.join(root, RULES_DIR));
    return entries
      .filter(entry => entry.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b))
      .map(entry => `${RULES_DIR.split(path.sep).join("/")}/${entry}`);
  } catch {
    return [];
  }
}
