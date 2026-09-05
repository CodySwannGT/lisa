#!/usr/bin/env node
/**
 * CI gate on the total size of the always-on eager rule tier.
 *
 * WHY THIS EXISTS, AND WHY IT IS A GATE RATHER THAN A REPORT.
 *
 * `plugins/<plugin>/rules/eager/*.md` is concatenated into `additionalContext`
 * by `inject-rules.sh` on **SessionStart and SubagentStart**, mirrored into
 * `.codex/lisa-rules/eager/` and `.opencode/lisa-rules/`, and flattened to
 * Cursor `.mdc` files with `alwaysApply: true`. Every session in every adopting
 * project pays for it before its first tool call, and so does every subagent —
 * a lead plus ten teammates pays it eleven times.
 *
 * This tier has already been cleaned up once and grown back. Measured from git:
 *
 *   pre-split (flat rules/)   12 files   190,237 bytes
 *   2026-05-28 after a820527  13 files    26,540 bytes   ("~86% smaller")
 *   2026-07-15                19 files    49,488 bytes
 *   2026-07-30                36 files   105,198 bytes
 *   2026-09-05                56 files   201,083 bytes
 *
 * Fourteen weeks took it to 7.6x the post-cleanup figure and 5.7% PAST the
 * payload the cleanup was created to remove. Nothing measured it, so nobody saw
 * it happen — every individual addition was defensible. A fix performed once
 * and undone by accretion needs a guard, not a second tidy (#3992).
 *
 * TOTAL BYTES, NOT PER FILE. A per-file cap is defeated by splitting one rule
 * into two, and the file count is exactly what already moved: 13 -> 56. The
 * cost to a session is the sum, so the sum is what is measured.
 *
 * THE CEILING lives in `eager-rules.thresholds.json` (root, beside the other threshold files) and
 * is registered as a `max`-direction family in `threshold-ratchet-families.mjs`,
 * so it may only tighten: lowering it is free, raising it is a weakening that
 * needs a `thresholdRatchet.allow` entry with a written reason. See
 * `threshold-ratchet.mjs` for why an allow entry is read only from the baseline.
 *
 * ALL THREE ROOTS are checked, not just the source. `plugins/lisa/` and
 * `plugins/lisa-copilot/` are generated copies that ship to Claude and Copilot;
 * checking only `plugins/src/base` would gate the input to a generator while the
 * artifacts that actually reach a session went unmeasured.
 *
 * It refuses to pass an inspection it did not perform: zero roots or zero rule
 * files is exit 2, not a passing zero. Every gate in the `plugins-sync` job
 * takes that stance, and it is why they are trustworthy — a scan that finds
 * nothing and a tree that is clean otherwise print the same tick.
 * @module scripts/check-eager-rule-budget
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** Plugin roots whose eager tier ships to a session. */
const CHECKED_PLUGINS = ["src/base", "lisa", "lisa-copilot"];

/** Committed ceiling, ratcheted by the `eager-rules` threshold family. */
const THRESHOLDS_FILE = path.join(REPO_ROOT, "eager-rules.thresholds.json");

/**
 * Total the `.md` payload of one plugin's eager rules directory.
 * @param {string} pluginRelPath - Plugin path relative to `plugins/`.
 * @returns {{ root: string, files: number, bytes: number } | undefined} The
 *   measurement, or undefined when the plugin has no eager directory.
 */
function measureEagerTier(pluginRelPath) {
  const dir = path.join(REPO_ROOT, "plugins", pluginRelPath, "rules", "eager");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return undefined;
  const files = readdirSync(dir).filter(name => name.endsWith(".md"));
  const bytes = files.reduce(
    (total, name) =>
      total + Buffer.byteLength(readFileSync(path.join(dir, name))),
    0
  );
  return {
    root: `plugins/${pluginRelPath}/rules/eager`,
    files: files.length,
    bytes,
  };
}

/**
 * Read the committed byte ceiling.
 * @returns {number} The ceiling in bytes.
 */
function readCeiling() {
  if (!existsSync(THRESHOLDS_FILE)) {
    process.stderr.write(
      `✗ Missing ${path.relative(REPO_ROOT, THRESHOLDS_FILE)} — the eager budget ` +
        `cannot be checked without its committed ceiling.\n`
    );
    process.exit(2);
  }
  const parsed = JSON.parse(readFileSync(THRESHOLDS_FILE, "utf8"));
  const ceiling = parsed.totalBytes;
  if (
    typeof ceiling !== "number" ||
    !Number.isFinite(ceiling) ||
    ceiling <= 0
  ) {
    process.stderr.write(
      `✗ ${path.relative(REPO_ROOT, THRESHOLDS_FILE)} has no usable ` +
        `"totalBytes" number; refusing to check against an unreadable ceiling.\n`
    );
    process.exit(2);
  }
  return ceiling;
}

const ceiling = readCeiling();
const measured = CHECKED_PLUGINS.map(measureEagerTier).filter(Boolean);

// VACUITY GUARD. A tree with no eager rules and a tree this script failed to
// read produce the same zero, and the passing branch cannot tell them apart.
// Exit 2 keeps "I could not measure" distinct from "it is within budget".
if (measured.length === 0) {
  process.stderr.write(
    `✗ No eager rules directory found under any of ${CHECKED_PLUGINS.join(", ")}. ` +
      `Refusing to report a passing zero for a measurement that did not happen.\n`
  );
  process.exit(2);
}
const empty = measured.filter(m => m.files === 0);
if (empty.length > 0) {
  process.stderr.write(
    `✗ Eager rules directories with zero .md files: ${empty
      .map(m => m.root)
      .join(", ")}. Refusing to report a passing zero.\n`
  );
  process.exit(2);
}

const over = measured.filter(m => m.bytes > ceiling);
for (const m of measured) {
  const margin =
    m.bytes > ceiling
      ? `over by ${m.bytes - ceiling}`
      : `${ceiling - m.bytes} to spare`;
  process.stdout.write(
    `${(m.bytes > ceiling ? "OVER" : "ok").padEnd(4)} ${m.root}: ${m.files} ` +
      `files, ${m.bytes} bytes (ceiling ${ceiling}, ${margin})\n`
  );
}

if (over.length > 0) {
  process.stderr.write("\n");
  for (const m of over) {
    process.stderr.write(
      `✗ ${m.root} is ${m.bytes - ceiling} bytes over the eager budget ` +
        `(${m.bytes} measured, ceiling ${ceiling}).\n`
    );
  }
  process.stderr.write(
    "\n  Every session AND every subagent in every adopting project pays this " +
      "payload\n  before its first tool call. Fix it by demoting, not by raising " +
      "the ceiling:\n\n" +
      "  1. Move the rule's body to plugins/src/base/rules/reference/<slug>.md\n" +
      "  2. Add a one-line entry to plugins/src/base/rules/eager/00-rule-index.md\n" +
      "  3. Delete the eager head and re-run this gate\n\n" +
      "  A rule stays eager only when an agent behaves WRONGLY without it in a " +
      "session\n  that never asks for it. Being true, well-argued, and cited by " +
      "ten skills is not\n  that bar — those rules belong in the index.\n\n" +
      "  Raising the ceiling in eager-rules.thresholds.json is a weakening: the " +
      "threshold\n  ratchet refuses it without a thresholdRatchet.allow entry " +
      "naming a reason.\n"
  );
  process.exit(1);
}

process.stdout.write(
  `\n✓ Eager rule budget passed across ${measured.length} plugin roots ` +
    `(ceiling ${ceiling} bytes).\n`
);
