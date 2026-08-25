// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Markdown rendering for the BDD burndown.
 *
 * The prose here is load-bearing: it is the only place a reader learns that
 * the headline percentage is traceability, not execution and not a pass
 * rate. Do not shorten it into a bare number.
 *
 * @module scripts/bdd/render
 */
import { byCodeUnit } from "./contract.mjs";
import { cell } from "./markdown-cell.mjs";

/**
 * Format a coverage figure, refusing to print "100%" for an empty
 * denominator — a platform with no obligations has no coverage to report,
 * and a bare 100% there is the exact false headline this gate exists to
 * prevent.
 * @param {object} value - A covered/total/percentage summary.
 * @returns {string} Cell text.
 */
const fmt = value =>
  value.total === 0 || value.percentage === null
    ? "n/a (no obligations)"
    : `${value.covered}/${value.total} (${value.percentage.toFixed(1)}%)`;

/**
 * Render the per-platform traceability table.
 * @param {object} report - The coverage report.
 * @returns {string} Markdown table.
 */
function platformTable(report) {
  const rows = Object.entries(report.traceability.byPlatform)
    .map(([platform, value]) => `| ${cell(platform)} | ${fmt(value)} |`)
    .join("\n");
  return `| Platform | Obligations with mapped automation |\n|---|---:|\n${rows}\n| **Overall** | **${fmt(report.traceability.overall)}** |`;
}

/**
 * Render the execution section, which is deliberately empty-but-explicit
 * when no run evidence was supplied.
 * @param {object} report - The coverage report.
 * @returns {string} Markdown section body.
 */
function executionSection(report) {
  const execution = report.execution;
  if (!execution.supplied) {
    return `**No execution evidence was supplied to this run.** ${execution.mappedTests} mapped tests exist; how many ran, and what they returned, is unknown here. Pass \`--results <file>\` with a runner result document to populate this section. Traceability without execution proves automation was written, never that it works.`;
  }
  const sources = execution.sources
    .map(
      source =>
        `- \`${cell(source.runner)}\` run \`${cell(source.runId ?? "unidentified")}\` (${source.resultCount} results, completed ${cell(source.completedAt ?? "unknown")})`
    )
    .join("\n");
  return `| Mapped tests | Executed | Passed | Failed | Skipped | Not run |\n|---:|---:|---:|---:|---:|---:|\n| ${execution.mappedTests} | ${execution.executed} | ${execution.passed} | ${execution.failed} | ${execution.skipped} | ${execution.notRun} |\n\nSources:\n\n${sources}`;
}

/**
 * Render the waiver ledger.
 * @param {object} report - The coverage report.
 * @returns {string} Markdown table.
 */
function waiverTable(report) {
  const rows =
    report.waived.entries
      .map(
        entry =>
          `| ${cell(entry.scenario)} | ${cell(entry.platforms.join(", "))} | ${cell(entry.runner ?? "—")} | ${cell(entry.owner ?? "**unowned**")} | ${cell(entry.reason ?? "—")} | ${cell(entry.ticket ?? "**none**")} | ${cell(entry.expiresAt ?? "**never**")} |`
      )
      .join("\n") || "| — | — | — | — | None | — | — |";
  return `| Scenario | Platforms | Runner | Owner | Reason | Ticket | Expires |\n|---|---|---|---|---|---|---|\n${rows}`;
}

/**
 * Render one platform's committed floor.
 *
 * An unusable value is called out as invalid rather than shown as absent —
 * "no floor here" and "somebody broke the floor" need different reactions.
 * @param {object} value - One platform's floor evaluation.
 * @returns {string} Cell text.
 */
function floorCell(value) {
  if (value.state === "invalid") return "**invalid**";
  return value.floor === null ? "**unset**" : `${value.floor}%`;
}

/**
 * Render the floor ratchet table.
 * @param {object} report - The coverage report.
 * @returns {string} Markdown table.
 */
function floorTable(report) {
  const rows = Object.entries(report.floor.byPlatform)
    .map(
      ([platform, value]) =>
        `| ${cell(platform)} | ${floorCell(value)} | ${value.actual === null ? "n/a" : `${value.actual}%`} | ${value.ok ? "ok" : "**below floor**"} |`
    )
    .join("\n");
  return `| Platform | Committed floor | Current | Status |\n|---|---:|---:|---|\n${rows}`;
}

/**
 * Render the discovered-test inventory: what the roots hold, and what of it
 * the contract never mentions.
 *
 * The undisclosed list is printed in full rather than counted. A count is a
 * number somebody can grow accustomed to; a named file with a named test is a
 * thing somebody has to either map or excuse.
 * @param {object} report - The coverage report.
 * @returns {string} Markdown section body.
 */
function inventorySection(report) {
  const inventory = report.testInventory;
  if (inventory.runners.length === 0) {
    return "**No `testDiscovery` roots are declared**, so no test file was walked and an undeclared test cannot be found here. In enforced mode this is a `discovery-missing` defect.";
  }
  const rows =
    inventory.undisclosed
      .map(
        item =>
          `| ${cell(item.runner)} | \`${cell(item.file)}\` | ${item.evidence === null ? "*(file has no title)*" : cell(item.evidence)} |`
      )
      .join("\n") || "| — | — | None |";
  return `${inventory.discovered} tests discovered under ${inventory.roots.map(root => `\`${cell(root)}\``).join(", ")}; ${inventory.disclosed} are named by a mapping or an exclusion. ${inventory.dynamicTitles} carry a computed (template-literal) title, taken verbatim from the source — a runner result cannot be joined to those by title.\n\n| Runner | File | Test not named by the contract |\n|---|---|---|\n${rows}`;
}

/**
 * Render the exclusion ledger: tests deliberately aligned to no behavior.
 * @param {object} report - The coverage report.
 * @returns {string} Markdown table.
 */
function exclusionTable(report) {
  const rows =
    report.testInventory.exclusions
      .map(
        entry =>
          `| \`${cell(entry.file)}\` | ${entry.evidence === null ? "*(whole file)*" : cell(entry.evidence)} | ${cell(entry.reason ?? "**unstated**")} |`
      )
      .join("\n") || "| — | — | None |";
  return `| File | Test | Reason it aligns to no product behavior |\n|---|---|---|\n${rows}`;
}

/**
 * Group the remaining gaps by feature.
 * @param {object} report - The coverage report.
 * @returns {string} Markdown sections.
 */
function gapSections(report) {
  const grouped = new Map();
  for (const gap of report.gaps) {
    const entries = grouped.get(gap.feature) ?? new Map();
    const entry = entries.get(gap.scenario) ?? {
      name: gap.name,
      platforms: [],
    };
    entry.platforms.push(gap.platform);
    entries.set(gap.scenario, entry);
    grouped.set(gap.feature, entries);
  }
  const sections = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([feature, entries]) => {
      const rows = [...entries.entries()]
        .map(
          ([id, value]) =>
            `| ${cell(id)} | ${cell(value.name)} | ${cell([...value.platforms].sort(byCodeUnit).join(", "))} |`
        )
        .join("\n");
      return `### ${cell(feature)}\n\n| Scenario | Behavior with no mapped proof | Platforms |\n|---|---|---|\n${rows}`;
    });
  return (
    sections.join("\n\n") ||
    "None. Every required, non-waived obligation has aligned automation mapped to it."
  );
}

/**
 * Render the whole burndown document.
 * @param {object} report - The coverage report.
 * @returns {string} Markdown document.
 */
export function renderBurndown(report) {
  return `# BDD behavior contract — coverage burndown

Generated from \`bdd/features/*.feature\` and \`bdd/coverage-map.json\` as of ${report.asOf ?? "an unrecorded date"}.
Regenerated by \`bun run bdd:coverage:write\`; never hand-edited.

## What each number means

This document reports five different facts and never merges them:

1. **Declared** — behaviors written as Gherkin scenarios. ${report.scenarios.declared} total, ${report.scenarios.required} in the denominator, ${report.scenarios.excluded} excluded (${report.scenarios.blocked} blocked, ${report.scenarios.referenceOnly} reference-only, ${report.scenarios.superseded} superseded).
2. **Traceability coverage** — required obligations with aligned automation mapped and their evidence string still present. **This is not execution coverage and not a pass rate.** A mapped test that fails on every run still counts here.
3. **Execution** — how many of those mapped tests actually ran in a supplied run.
4. **Results** — what those runs returned: pass, fail, skip.
5. **Waivers** — obligations deliberately outside the denominator. A waiver is a dated IOU with an owner and a retiring ticket; it is never coverage.

## Traceability coverage

${platformTable(report)}

## Execution

${executionSection(report)}

## Coverage floor

The committed floor is an absolute bar — "is this platform below it right now" — and nothing else. It is **not** a ratchet and nobody has to nudge it upward: what protects coverage already earned is a separate, per-obligation check. Coverage accepted at the base revision cannot disappear, and behavior that is new must arrive mapped or waived; either reduction takes a recorded route — a complete \`retirements\` record or a \`platformWaivers\` entry — which lands in the diff where it can be read and challenged.

${floorTable(report)}

## Waived obligations

${report.waived.note}

${waiverTable(report)}

## Discovered tests the contract does not mention

${report.testInventory.note}

${inventorySection(report)}

## Tests deliberately aligned to no behavior

Every row here is a standing claim that a real test proves nothing about product behavior. An exclusion whose file is gone, whose title was renamed, or that no discovery root covers is a defect, not a permanent excuse.

${exclusionTable(report)}

## Traceability to work items

${report.trackers.scenariosWithTag} of ${report.scenarios.declared} scenarios carry a tracker tag; ${report.trackers.scenariosWithoutTag} do not. Tags are validated for syntax and against this repo's declared trackers; the gate never contacts a tracker, so an unreachable issue can never block a merge.

## Required obligations with no mapped proof

${gapSections(report)}
`;
}
