#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * bdd-matrix — the per-scenario traceability matrix.
 *
 * The human-readable companion to `check-bdd-coverage.mjs`. It reuses that
 * gate's parser and the same `bdd/coverage-map.json`, so the two can never
 * disagree about what is covered.
 *
 * Every row separates the five facts the gate keeps apart: the behavior
 * DECLARED, where it came from, whether automation is MAPPED per runner
 * (traceability), whether that automation RAN, and what it returned. A `✓` in
 * the mapped column asserts an aligned test exists and still contains its
 * evidence string — never that it passed.
 *
 * Usage: BDD_BASE_SHA="$(git merge-base HEAD origin/HEAD)" bun run bdd:matrix [--results <file>]
 *
 * @module scripts/bdd-matrix
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { waivedKeys } from "./bdd/baseline.mjs";
import { byCodeUnit, declaredPlatforms, trackerUrl } from "./bdd/contract.mjs";
import { loadScenarios } from "./bdd/parse.mjs";
import { indexResults } from "./bdd/report.mjs";
import { loadExecutionResults } from "./check-bdd-coverage.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const OUT_REL = path.join("docs", "bdd-scenario-matrix.md");

/**
 * Index mappings by scenario and runner.
 * @param {object} contract - Parsed coverage map.
 * @returns {Map<string, object[]>} Scenario ID → its mappings.
 */
function mappingsByScenario(contract) {
  const index = new Map();
  for (const mapping of contract.mappings ?? []) {
    index.set(mapping.scenario, [
      ...(index.get(mapping.scenario) ?? []),
      mapping,
    ]);
  }
  return index;
}

/**
 * Render one scenario's mapped-automation cell for one runner.
 * @param {readonly string[]} required - Platforms the scenario demands this runner cover.
 * @param {readonly object[]} mappings - Mappings for this scenario and runner.
 * @param {(platform: string) => boolean} isWaived - Whether that platform is waived.
 * @returns {string} Cell text.
 */
function mappedCell(required, mappings, isWaived) {
  if (required.length === 0) return "n/a";
  const covered = new Set(mappings.flatMap(mapping => mapping.platforms ?? []));
  const hit = required.filter(platform => covered.has(platform));
  const waived = required.filter(
    platform => !covered.has(platform) && isWaived(platform)
  );
  const parts = [];
  if (hit.length > 0) parts.push(`✓ ${hit.join("+")}`);
  if (waived.length > 0) parts.push(`waived ${waived.join("+")}`);
  const accounted = hit.length + waived.length;
  if (accounted === 0) return "✗ none";
  if (accounted < required.length) parts.push("✗ rest");
  return parts.join(", ");
}

/**
 * Render one scenario's execution cell.
 * @param {readonly object[]} mappings - Mappings for this scenario.
 * @param {Map<string, object>} results - Execution results index.
 * @param {boolean} supplied - Whether any run evidence was supplied.
 * @returns {string} Cell text.
 */
function executionCell(mappings, results, supplied) {
  if (!supplied) return "not supplied";
  if (mappings.length === 0) return "—";
  const statuses = mappings.map(
    mapping =>
      results.get(`${mapping.runner}|${mapping.file}|${mapping.evidence}`)
        ?.status ?? "not run"
  );
  const tally = counts =>
    Object.entries(counts)
      .map(([key, value]) => `${value} ${key}`)
      .join(", ");
  const counted = {};
  for (const status of statuses) counted[status] = (counted[status] ?? 0) + 1;
  return tally(counted);
}

/**
 * Render a scenario's provenance and tracker references.
 * @param {object} scenario - Parsed scenario.
 * @param {object} trackers - The `trackers` block of the coverage map.
 * @returns {string} Cell text.
 */
function sourceCell(scenario, trackers) {
  const provenance = scenario.provenance.map(tag => `\`${tag}\``);
  const tickets = scenario.trackers.map(reference => {
    const url = trackerUrl(reference, trackers);
    return url ? `[${reference.tag}](${url})` : reference.tag;
  });
  return [...provenance, ...tickets].join("<br>") || "—";
}

/**
 * Render the full matrix document.
 * @param {string} root - Repo root.
 * @param {readonly string[]} resultFiles - Execution result documents to join.
 * @returns {string} Markdown document.
 */
export function renderMatrix(root, resultFiles) {
  const contract = JSON.parse(
    fs.readFileSync(path.join(root, "bdd", "coverage-map.json"), "utf8")
  );
  const platforms = declaredPlatforms(contract.runnerPlatforms);
  const scenarios = loadScenarios(root, platforms);
  const execution = loadExecutionResults(root, resultFiles);
  // Shared with the burndown so the two can never disagree about whether a
  // test failed — including the retry precedence that keeps a `failed`
  // attempt from being buried by a later `passed`.
  const results = indexResults(execution.runs);
  const byScenario = mappingsByScenario(contract);
  const waived = waivedKeys(contract);
  const runners = Object.keys(contract.runnerPlatforms ?? {}).sort(byCodeUnit);
  const byFeature = new Map();
  for (const scenario of scenarios) {
    byFeature.set(scenario.feature, [
      ...(byFeature.get(scenario.feature) ?? []),
      scenario,
    ]);
  }
  const header = [
    "| ID | Behavior | Source | Lifecycle",
    ...runners.map(runner => ` | Mapped (${runner})`),
    " | Executed |",
  ].join("");
  const divider = `|---|---|---|---|${runners.map(() => "---|").join("")}---|`;
  const sections = [...byFeature.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map(feature =>
      renderFeature({
        feature,
        scenarios: byFeature.get(feature),
        byScenario,
        contract,
        runners,
        results,
        waived,
        supplied: execution.runs.length > 0,
        header,
        divider,
      })
    )
    .join("\n");
  return preamble(scenarios, execution.runs.length > 0) + sections;
}

/**
 * Render one feature's table.
 * @param {object} input - Feature, its scenarios, and the shared indexes.
 * @returns {string} Markdown section.
 */
function renderFeature({
  feature,
  scenarios,
  byScenario,
  contract,
  runners,
  results,
  waived,
  supplied,
  header,
  divider,
}) {
  const rows = scenarios
    .map(scenario => {
      const mappings = byScenario.get(scenario.id) ?? [];
      const cells = runners.map(runner => {
        const covers = new Set(contract.runnerPlatforms[runner] ?? []);
        const required = scenario.platforms.filter(platform =>
          covers.has(platform)
        );
        return mappedCell(
          required,
          mappings.filter(mapping => mapping.runner === runner),
          platform => waived.has(`${scenario.id}:${platform}`)
        );
      });
      const lifecycle =
        scenario.lifecycle.length > 0
          ? scenario.lifecycle.join(", ")
          : "required";
      return `| \`${scenario.id ?? "(no id)"}\` | ${scenario.name} | ${sourceCell(scenario, contract.trackers)} | ${lifecycle} | ${cells.join(" | ")} | ${executionCell(mappings, results, supplied)} |`;
    })
    .join("\n");
  return `## ${feature}\n\n${header}\n${divider}\n${rows}\n`;
}

/**
 * The explanatory preamble.
 * @param {readonly object[]} scenarios - Parsed scenarios.
 * @param {boolean} supplied - Whether run evidence was supplied.
 * @returns {string} Markdown preamble.
 */
function preamble(scenarios, supplied) {
  const required = scenarios.filter(scenario => scenario.required).length;
  return `# BDD scenario traceability matrix

Every declared behavior, where it came from, and what actually proves it.
Generated by \`BDD_BASE_SHA="$(git merge-base HEAD origin/HEAD)" bun run bdd:matrix\`; never hand-edited.

- **Mapped** — aligned automation exists in that runner for the platforms the scenario requires, and its evidence string still resolves. This is **traceability**, not a result: a mapped test that fails still shows \`✓\`.
- **Executed** — what the supplied run evidence returned for those mapped tests. ${supplied ? "Run evidence was supplied for this render." : "**No run evidence was supplied for this render**, so this column reads `not supplied` throughout — nothing here asserts any test ran."}
- **Lifecycle** — \`required\` counts toward coverage; \`blocked\`, \`reference-only\`, and \`superseded\` are excluded until that changes.

${scenarios.length} scenarios declared, ${required} required.

`;
}

/**
 * CLI entry point.
 * @returns {void}
 */
function main() {
  const root = process.env.BDD_COVERAGE_ROOT || PACKAGE_ROOT;
  const argv = process.argv.slice(2);
  const resultFiles = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--results" && argv[index + 1])
      resultFiles.push(argv[index + 1]);
  }
  const body = renderMatrix(root, resultFiles);
  if (!argv.includes("--write")) {
    console.log(body);
    return;
  }
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, OUT_REL), body);
  console.log(`[bdd-matrix] wrote ${OUT_REL}`);
}

if (invokedAsScript(import.meta.url)) main();
