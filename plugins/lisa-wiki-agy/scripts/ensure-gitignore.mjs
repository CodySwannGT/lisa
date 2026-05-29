#!/usr/bin/env node
/**
 * ensure-gitignore.mjs — merge the lisa-wiki gitignore block into the project's
 * `.gitignore`, idempotently. Dependency-free.
 *
 * The block is delimited by `# BEGIN: AI GUARDRAILS WIKI` and
 * `# END: AI GUARDRAILS WIKI` markers (see templates/wrapper-gitignore.txt).
 * Behavior matches the base lisa plugin's copy-contents strategy
 * (src/strategies/copy-contents.ts):
 *
 *   - If the file is missing, create it with just the block.
 *   - If the block markers exist, replace the block in place.
 *   - If the markers don't exist, append the block to the end (preserving a
 *     trailing newline).
 *
 * Patterns outside the marker block are NEVER touched. Re-running produces no
 * spurious diff once the file is in sync.
 *
 * Usage: node ensure-gitignore.mjs [--cwd <project-dir>] [--dry-run]
 *   default cwd: process.cwd()
 *   --dry-run    prints the proposed merge result to stdout instead of writing
 *
 * Exit code 0 = ok (file was created, updated, or already in sync).
 * Exit code 1 = error (e.g. template missing).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BEGIN_MARKER = "# BEGIN: AI GUARDRAILS WIKI";
const END_MARKER = "# END: AI GUARDRAILS WIKI";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.dirname(scriptDir);
const templatePath = path.join(
  pluginRoot,
  "templates",
  "wrapper-gitignore.txt"
);

const argv = process.argv.slice(2);
const cwdIndex = argv.indexOf("--cwd");
const projectDir =
  cwdIndex !== -1 && argv[cwdIndex + 1]
    ? path.resolve(argv[cwdIndex + 1])
    : process.cwd();
const dryRun = argv.includes("--dry-run");

if (!fs.existsSync(templatePath)) {
  fail(`template not found: ${templatePath}`);
}

const templateRaw = fs.readFileSync(templatePath, "utf8");
const block = extractBlock(templateRaw);
if (!block) {
  fail(
    `template at ${templatePath} does not contain the expected marker pair (${BEGIN_MARKER} / ${END_MARKER})`
  );
}

const gitignorePath = path.join(projectDir, ".gitignore");
const existing = fs.existsSync(gitignorePath)
  ? fs.readFileSync(gitignorePath, "utf8")
  : null;

const merged = mergeBlock(existing, block);

if (existing !== null && merged === existing) {
  console.log(`✓ .gitignore already in sync (${gitignorePath})`);
  process.exit(0);
}

if (dryRun) {
  process.stdout.write(merged);
  process.exit(0);
}

fs.writeFileSync(gitignorePath, merged);
const verb = existing === null ? "created" : "updated";
console.log(`✓ ${verb} ${gitignorePath}`);
process.exit(0);

/**
 * Pull the block (markers included) out of arbitrary text. Returns null when
 * the marker pair is missing or out of order.
 */
function extractBlock(text) {
  const startIdx = text.indexOf(BEGIN_MARKER);
  if (startIdx === -1) return null;
  const endStart = text.indexOf(END_MARKER, startIdx + BEGIN_MARKER.length);
  if (endStart === -1) return null;
  const endIdx = endStart + END_MARKER.length;
  return text.slice(startIdx, endIdx);
}

/**
 * Merge a freshly-rendered block into the destination file content.
 *   - existing === null → return the block alone (file will be created)
 *   - existing has the markers → replace the block in place
 *   - existing lacks the markers → append the block at the end
 * Always normalizes to exactly one trailing newline.
 */
function mergeBlock(existing, freshBlock) {
  if (existing === null) {
    return `${freshBlock.trimEnd()}\n`;
  }

  const startIdx = existing.indexOf(BEGIN_MARKER);
  if (startIdx !== -1) {
    const endStart = existing.indexOf(
      END_MARKER,
      startIdx + BEGIN_MARKER.length
    );
    if (endStart !== -1) {
      const endIdx = endStart + END_MARKER.length;
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx);
      const trimmedAfter = after.startsWith("\n") ? after : `\n${after}`;
      return `${before}${freshBlock.trimEnd()}${trimmedAfter}`;
    }
  }

  // No marker pair in the destination — append.
  const base = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${base}\n${freshBlock.trimEnd()}\n`;
}
