#!/usr/bin/env node
/**
 * Print the project's learned gotchas — the bounded projection of the
 * machine-managed learnings ledger — so a flow can read them back at the start
 * of work.
 *
 * ## Why this exists
 *
 * The ledger was write-mostly: learnings were captured on every build, but only
 * the planning checks were ever read back, so an implementer repeated mistakes
 * the ledger already recorded. Loading the whole file into every session is the
 * opposite failure, so this prints only the contract's bounded projection
 * (`projectLearnings`), the same slice the budget gate measures.
 *
 * ## Contract
 *
 * `node learnings-projection.mjs [--match <regex>]`, run from the project root.
 *
 * - No ledger: prints nothing, exits 0. Absence is normal.
 * - Unreadable or malformed ledger, or Lisa not installed: one warning on
 *   stderr, nothing on stdout, exit 0. A broken ledger never blocks work.
 * - Otherwise: one JSON line `{ entries: [{id, rule, why, confidence}], omitted: [ids] }`.
 *   `--match` keeps only entries whose `rule` matches the regex, and the
 *   projection is taken over that subset so other entries never crowd it out.
 *
 * Lisa's learnings module is resolved from the project (the host installs
 * `@codyswann/lisa`), not from this script's location inside the plugin.
 * `LISA_LEARNINGS_MODULE` (an absolute path) overrides that resolution; the
 * contract tests use it to run against the source module.
 * @module learnings-projection
 */
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Read `--match <regex>` from argv.
 * @param {readonly string[]} argv - Arguments after the script path
 * @returns {RegExp | null} The filter, or null when none was given
 */
export function parseMatch(argv) {
  const index = argv.indexOf("--match");
  if (index === -1) return null;
  const source = argv[index + 1];
  if (!source) throw new Error("--match needs a regular expression");
  return new RegExp(source);
}

/**
 * Build the printed projection from parsed ledger entries.
 * @param {{ projectLearnings: Function }} learnings - The learnings module
 * @param {readonly object[]} parsed - Validated ledger entries
 * @param {RegExp | null} match - Optional rule filter
 * @returns {{ entries: object[], omitted: string[] }} The served slice
 */
export function buildProjection(learnings, parsed, match) {
  const subset = match
    ? parsed.filter(entry => match.test(entry.rule))
    : [...parsed];
  const { entries } = learnings.projectLearnings(subset);
  const kept = new Set(entries.map(entry => entry.id));
  return {
    entries: entries.map(({ id, rule, why, confidence }) => ({
      id,
      rule,
      why,
      confidence,
    })),
    omitted: subset.filter(entry => !kept.has(entry.id)).map(entry => entry.id),
  };
}

/**
 * Load Lisa's learnings module from the project at `cwd`.
 * @param {string} cwd - Project root
 * @returns {Promise<object>} The `@codyswann/lisa/learnings` module
 */
async function loadLearnings(cwd) {
  const override = process.env.LISA_LEARNINGS_MODULE;
  if (override) return import(pathToFileURL(override).href);
  const require = createRequire(path.join(cwd, "package.json"));
  return import(
    pathToFileURL(require.resolve("@codyswann/lisa/learnings")).href
  );
}

/**
 * Print the projection for the project at `cwd`.
 * @param {string} cwd - Project root
 * @param {readonly string[]} argv - Arguments after the script path
 * @returns {Promise<void>}
 */
export async function main(cwd, argv) {
  try {
    const match = parseMatch(argv);
    const learnings = await loadLearnings(cwd);
    const file = learnings.resolveProjectLearningsFile(
      await learnings.readProjectConfig(cwd)
    );
    const raw = await readFile(path.resolve(cwd, file), "utf8").catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (raw === null) return;
    const projection = buildProjection(
      learnings,
      learnings.parseLearningsFile(raw),
      match
    );
    process.stdout.write(`${JSON.stringify(projection)}\n`);
  } catch (error) {
    process.stderr.write(`project learnings unavailable: ${error.message}\n`);
  }
}

const invokedDirectly = (() => {
  try {
    return (
      realpathSync(process.argv[1] ?? "") ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  await main(process.cwd(), process.argv.slice(2));
}
