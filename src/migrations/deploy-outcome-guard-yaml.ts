/**
 * Line-level editing of a host's `deploy.yml` for `ensure-deploy-outcome-guard`
 * (CodySwannGT/lisa#3740).
 *
 * The file being edited is one the host OWNS — Lisa seeded it once and has
 * never overwritten it since — so the discipline here is the opposite of a
 * template copy: touch the two constructs that carry the defect and leave every
 * other byte, including comments and formatting, exactly as the host left it.
 * That is why this works on lines rather than by re-serializing a parsed
 * document; a YAML round-trip would silently reformat a file somebody reviewed.
 *
 * Every locator returns null rather than a best guess. A workflow whose shape
 * this cannot resolve unambiguously is not edited, and the doctor finding
 * reports it instead — a migration that half-recognises a file and edits it
 * anyway is worse than one that declines.
 * @module migrations/deploy-outcome-guard-yaml
 */

/** Where one job's block sits in the file, and how its keys are indented. */
export interface JobBlock {
  /** Index of the `<job-id>:` line. */
  readonly start: number;
  /** Index one past the job's last line. */
  readonly end: number;
  /** Column the job's own keys (`if:`, `steps:`) begin at. */
  readonly keyIndent: number;
}

/**
 * Indentation width of one line, or null when the line carries no content.
 * @param line - The raw line
 * @returns Number of leading spaces, or null for a blank or comment-only line
 */
function indentOf(line: string): number | null {
  if (line.trim() === "") return null;
  return line.length - line.trimStart().length;
}

/**
 * Locate one job's block by its id.
 * @param lines - The workflow file's lines
 * @param jobId - The job's key in the `jobs:` map
 * @returns Where the job sits, or null when it cannot be located exactly once
 */
export function locateJob(
  lines: readonly string[],
  jobId: string
): JobBlock | null {
  const pattern = new RegExp(`^(\\s+)${jobId}:\\s*$`);
  const starts = lines.flatMap((line, index) =>
    pattern.test(line) ? [index] : []
  );
  if (starts.length !== 1) return null;
  const start = starts[0] ?? 0;
  const jobIndent = indentOf(lines[start] ?? "") ?? 0;
  const body = lines
    .slice(start + 1)
    .findIndex(line => (indentOf(line) ?? jobIndent + 1) <= jobIndent);
  const end = body === -1 ? lines.length : start + 1 + body;
  const keyIndent = lines
    .slice(start + 1, end)
    .map(indentOf)
    .find((indent): indent is number => indent !== null);
  return keyIndent === undefined ? null : { start, end, keyIndent };
}

/** A span of lines to replace, and the indentation its replacement takes. */
export interface KeySpan {
  /** Index of the key's first line. */
  readonly start: number;
  /** Index one past the key's last line. */
  readonly end: number;
}

/**
 * Locate one top-level key of a job, including any continuation lines.
 * @param lines - The workflow file's lines
 * @param block - The job's block
 * @param key - The key name, e.g. `if` or `steps`
 * @returns The key's span, or null when the job does not declare it
 */
export function locateKey(
  lines: readonly string[],
  block: JobBlock,
  key: string
): KeySpan | null {
  const pattern = new RegExp(`^\\s{${block.keyIndent}}${key}:`);
  const found = lines
    .slice(block.start, block.end)
    .findIndex(line => pattern.test(line));
  if (found === -1) return null;
  const start = block.start + found;
  const rest = lines
    .slice(start + 1, block.end)
    .findIndex(
      line => (indentOf(line) ?? block.keyIndent + 1) <= block.keyIndent
    );
  return { start, end: rest === -1 ? block.end : start + 1 + rest };
}

/**
 * Locate the first entry of a job's `steps:` list.
 * @param lines - The workflow file's lines
 * @param block - The job's block
 * @returns The first step's line index and indentation, or null when absent
 */
export function locateFirstStep(
  lines: readonly string[],
  block: JobBlock
): { readonly index: number; readonly indent: number } | null {
  const steps = locateKey(lines, block, "steps");
  if (steps === null) return null;
  const offset = lines
    .slice(steps.start + 1, steps.end)
    .findIndex(line => line.trimStart().startsWith("- "));
  if (offset === -1) return null;
  const index = steps.start + 1 + offset;
  return { index, indent: indentOf(lines[index] ?? "") ?? 0 };
}

/**
 * Extract the guard step from a shipped Lisa deploy template.
 *
 * Read rather than reproduced: the body is kept byte-identical across the
 * shipped templates by a test, and a copy inside this module would be a fourth
 * one that test cannot see.
 * @param template - The template workflow's source
 * @param stepName - The guard step's `name:` value
 * @returns The step's lines, de-indented to column zero, or null when absent
 */
export function extractGuardStep(
  template: string,
  stepName: string
): readonly string[] | null {
  const lines = template.split("\n");
  const start = lines.findIndex(line =>
    line.trimStart().startsWith(`- name: ${stepName}`)
  );
  if (start === -1) return null;
  const indent = indentOf(lines[start] ?? "") ?? 0;
  const after = lines
    .slice(start + 1)
    .findIndex(line => (indentOf(line) ?? indent + 1) <= indent);
  const end = after === -1 ? lines.length : start + 1 + after;
  return lines
    .slice(start, end)
    .map(line => (line.trim() === "" ? "" : line.slice(indent)));
}

/**
 * Render the replacement `if:` block for a job.
 * @param condition - The rewritten condition text
 * @param keyIndent - Column the job's keys begin at
 * @returns The lines to write in place of the job's old `if:`
 */
export function renderCondition(
  condition: string,
  keyIndent: number
): readonly string[] {
  const pad = " ".repeat(keyIndent);
  const inner = " ".repeat(keyIndent + 2);
  return [
    `${pad}# \`!cancelled()\` suppresses the implicit \`success()\` GitHub would`,
    `${pad}# otherwise AND onto this condition. Without it a failed release`,
    `${pad}# SKIPPED this job, and a skipped job renders as neutral and counts`,
    `${pad}# as a satisfied required check — so a deploy that never happened`,
    `${pad}# left no signal at all. The release result is read by the guard STEP`,
    `${pad}# below, which fails this job loudly instead (#3467, applied by`,
    `${pad}# Lisa's ensure-deploy-outcome-guard migration for #3740).`,
    `${pad}if: >-`,
    ...condition
      .split(" && ")
      .map((part, index, parts) =>
        index === parts.length - 1 ? `${inner}${part}` : `${inner}${part} &&`
      ),
  ];
}

/**
 * Apply both edits to one workflow's source, or return null.
 *
 * The two are produced together on purpose. Suppressing the implicit
 * `success()` without inserting the guard would leave a deploy job that RUNS on
 * a failed release with nothing checking the release result — it would attempt
 * to ship, which is worse than the silence this repairs.
 * @param source - The host workflow's source
 * @param jobId - The deploy job to repair
 * @param condition - The rewritten condition text
 * @param guardStep - The guard step's lines, de-indented to column zero
 * @returns The edited source, or null when the file could not be edited safely
 */
export function applyGuardEdits(
  source: string,
  jobId: string,
  condition: string,
  guardStep: readonly string[]
): string | null {
  const lines = source.split("\n");
  const block = locateJob(lines, jobId);
  if (block === null) return null;
  const step = locateFirstStep(lines, block);
  if (step === null) return null;
  const existing = locateKey(lines, block, "if");
  const guardLines = guardStep.map(line =>
    line === "" ? "" : `${" ".repeat(step.indent)}${line}`
  );
  const conditionLines = renderCondition(condition, block.keyIndent);
  const declared = existing ?? {
    start: block.start + 1,
    end: block.start + 1,
  };
  const withGuard = [
    ...lines.slice(0, step.index),
    ...guardLines,
    ...lines.slice(step.index),
  ];
  // Inserting the guard shifts every index at or after it. `steps:` normally
  // follows `if:`, so the span is usually untouched — but YAML mapping keys
  // carry no required order, and a host that wrote them the other way round
  // would otherwise have its file corrupted rather than declined.
  const shift = step.index <= declared.start ? guardLines.length : 0;
  return [
    ...withGuard.slice(0, declared.start + shift),
    ...conditionLines,
    ...withGuard.slice(declared.end + shift),
  ].join("\n");
}
