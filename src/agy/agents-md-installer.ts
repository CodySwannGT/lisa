/**
 * Write Lisa's AGENTS.md template for agy host projects, with rule content
 * baked directly into the file body.
 *
 * Per the parity research artifact (Cluster 4-agy / Option α), Lisa cannot
 * polyfill rules-injection on agy via a SessionStart hook because agy plugin
 * hooks do not fire in `-p` headless mode. The alternative is to bake the
 * eager rule content into the AGENTS.md template that agy auto-loads at
 * session start (verified-by-doc since v1.20.3).
 *
 * Behavior diverges from `src/codex/agents-md-installer.ts`:
 *   - Codex installer is create-only and references hooks for rule injection.
 *   - agy installer is also create-only but appends the rule bodies directly
 *     to the template, with a Lisa-managed section marker so re-runs can
 *     refresh the rule content without overwriting host-authored sections.
 *
 * The marker block convention mirrors the tagged-merge pattern used in
 * `src/codex/hooks-merger.ts`. On re-runs, the installer:
 *   1. Reads the existing AGENTS.md.
 *   2. Strips the `<!-- LISA_RULES_START -->...<!-- LISA_RULES_END -->` block
 *      if present.
 *   3. Re-emits Lisa's current eager rules between fresh markers.
 *   4. Preserves all content outside the marker block (host-authored guidance).
 * @module agy/agents-md-installer
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";

/** Filename of agy's project memory file (auto-loaded since v1.20.3). */
export const AGENTS_MD_FILENAME = "AGENTS.md";

/** Marker placed at the start of the Lisa-managed block in AGENTS.md. */
export const LISA_RULES_START_MARKER = "<!-- LISA_RULES_START -->";
/** Marker placed at the end of the Lisa-managed block in AGENTS.md. */
export const LISA_RULES_END_MARKER = "<!-- LISA_RULES_END -->";

/** Result of the agy AGENTS.md install pass. */
export interface AgyAgentsMdInstallResult {
  /** Absolute path to the AGENTS.md file. */
  readonly path: string;
  /** True when this run created the file for the first time. */
  readonly created: boolean;
  /** Number of `.md` rule files baked into the marker block. */
  readonly rulesBaked: number;
}

const HEADER = `# AGENTS.md

This file is auto-loaded by Antigravity (\`agy\`) at the start of every
session. Lisa polyfills rule injection by baking its eager rule content
directly into this file (agy plugin hooks do not fire in \`-p\` headless
mode, so the SessionStart-hook strategy Lisa uses on Claude and Codex is
not available on agy).

Anything between the markers below is Lisa-managed and is rewritten on
every \`lisa apply\` run. Add project-specific guidance OUTSIDE the marker
block — it will be preserved across re-applies.
`;

/**
 * Read all eager rule files (the bodies Lisa wants in session context)
 * sorted by filename for stable output.
 * @param rulesEagerDir - Absolute path to the plugin's `rules/eager/` directory.
 * @returns Array of `{ filename, body }` pairs.
 */
async function readEagerRules(
  rulesEagerDir: string
): Promise<readonly { readonly filename: string; readonly body: string }[]> {
  if (!existsSync(rulesEagerDir)) return [];
  const entries = await readdir(rulesEagerDir, { withFileTypes: true });
  const mdEntries = [
    ...entries.filter(entry => entry.isFile() && entry.name.endsWith(".md")),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return await Promise.all(
    mdEntries.map(async entry => {
      const filePath = path.join(rulesEagerDir, entry.name);
      const body = await readFile(filePath, "utf8");
      return { filename: entry.name, body };
    })
  );
}

/**
 * Build the Lisa-managed marker block from the eager rule bodies.
 * @param rules - Eager rule contents read from `rules/eager/*.md`.
 * @returns Markdown text including the start/end markers.
 */
function buildLisaBlock(
  rules: readonly { readonly filename: string; readonly body: string }[]
): string {
  const sections = rules.map(rule => {
    // Drop any existing leading H1 from rule bodies — they are already
    // contextual subsections inside AGENTS.md, not standalone documents.
    // Strip an optional leading H1 line — bounded to one line and one trailing
    // newline pair to satisfy sonarjs/slow-regex (no unbounded `+` quantifiers).
    const trimmed = rule.body.replace(/^# [^\n]{0,256}\n\n?/, "").trim();
    const heading = `## ${rule.filename.replace(/\.md$/, "")}\n\n`;
    return `${heading + trimmed}\n`;
  });
  return `${LISA_RULES_START_MARKER}\n\n${sections.join("\n")}\n${LISA_RULES_END_MARKER}\n`;
}

/**
 * Strip an existing Lisa-managed block from the AGENTS.md body and return the
 * surrounding host-authored content.
 *
 * Tolerates either ordering and whitespace variance around the markers.
 * @param body - Existing AGENTS.md file contents.
 * @returns The body with the Lisa block (if present) removed.
 */
function stripExistingLisaBlock(body: string): string {
  const startIdx = body.indexOf(LISA_RULES_START_MARKER);
  const endIdx = body.indexOf(LISA_RULES_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return body;
  }
  const before = body.slice(0, startIdx);
  const after = body.slice(endIdx + LISA_RULES_END_MARKER.length);
  // Use a bounded quantifier instead of `{3,}` (unbounded) to satisfy
  // sonarjs/slow-regex — three or more consecutive newlines collapse to two.
  return `${(before + after).replace(/\n\n\n+/g, "\n\n").trim()}\n`;
}

/**
 * Install (or refresh) Lisa's AGENTS.md at the host project root for agy.
 * @param destDir - Absolute path to the host project root.
 * @param rulesEagerDir - Absolute path to the plugin's `rules/eager/` directory
 *   containing the rule bodies to bake in.
 * @returns Install result describing path, creation, and rules baked.
 */
export async function installAgyAgentsMd(
  destDir: string,
  rulesEagerDir: string
): Promise<AgyAgentsMdInstallResult> {
  await mkdir(destDir, { recursive: true });
  const filePath = path.join(destDir, AGENTS_MD_FILENAME);
  const rules = await readEagerRules(rulesEagerDir);
  const lisaBlock = buildLisaBlock(rules);

  if (!existsSync(filePath)) {
    const body = `${HEADER}\n${lisaBlock}`;
    await writeFile(filePath, body, "utf8");
    return { path: filePath, created: true, rulesBaked: rules.length };
  }

  const existing = await readFile(filePath, "utf8");
  const hostContent = stripExistingLisaBlock(existing);
  const updated = `${hostContent.trimEnd()}\n\n${lisaBlock}`;
  await writeFile(filePath, updated, "utf8");
  return { path: filePath, created: false, rulesBaked: rules.length };
}
