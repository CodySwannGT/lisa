#!/usr/bin/env node
/**
 * check-bdd-coverage — the BDD behavior-contract gate.
 *
 * Validates `bdd/features/*.feature` against `bdd/coverage-map.json` and
 * reports five separate facts: behaviors DECLARED, obligations MAPPED to an
 * automated test (traceability), mapped tests that RAN, what those runs
 * returned, and what is WAIVED. Traceability coverage is not execution
 * coverage and is never a pass rate.
 *
 * THREE-STATE ADOPTION (`BDD_MODE`, supplied by CI, never inferred):
 *
 *   not-adopted  The contract is not required. The gate reports and exits 0,
 *                and the check MUST NOT be a required ruleset context.
 *   bootstrap    A visible, non-blocking check carrying a named owner and a
 *                hard expiry. Contract defects are warnings; a missing or
 *                passed expiry is a failure, so bootstrap cannot become
 *                permanent.
 *   enforced     Absence fails. A missing config, a malformed manifest, zero
 *                scenarios, zero mappings, any contract defect, a floor
 *                regression, or a deleted scenario all fail loudly. Only in
 *                this state is the check a required ruleset context.
 *
 * A required context is NEVER auto-skipped: GitHub counts a skipped required
 * check as passing, which is the exact anti-pattern this gate exists to
 * avoid.
 *
 * Usage:
 *   node scripts/check-bdd-coverage.mjs [--write] [--json] [--results <file>]
 *
 * @module scripts/check-bdd-coverage
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ADOPTION_STATES,
  REPORT_SCHEMA_VERSION,
  SUPPORTED_MAP_SCHEMA_VERSIONS,
  declaredPlatforms,
} from "./bdd/contract.mjs";
import { checkDeletions, checkRatchet, loadBaseline } from "./bdd/baseline.mjs";
import { loadScenarios } from "./bdd/parse.mjs";
import { buildReport } from "./bdd/report.mjs";
import { renderBurndown } from "./bdd/render.mjs";
import {
  validateMappings,
  validateScenarios,
  validateTrackerTags,
} from "./bdd/validate.mjs";
import { validateWaivers } from "./bdd/waivers.mjs";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const MAP_REL = "bdd/coverage-map.json";
const defect = (code, message) => ({ code, message });

/**
 * Resolve the adoption state from the environment.
 * @param {Record<string, string|undefined>} env - Process environment.
 * @returns {{mode: string, error: string|null}} The resolved mode.
 */
export function resolveMode(env) {
  const raw = (env.BDD_MODE ?? "").trim();
  if (raw === "") return { mode: "not-adopted", error: null };
  if (!ADOPTION_STATES.includes(raw)) {
    return {
      mode: "not-adopted",
      error: `BDD_MODE="${raw}" is not one of ${ADOPTION_STATES.join(", ")}`,
    };
  }
  return { mode: raw, error: null };
}

/**
 * Read and parse the coverage map, distinguishing "absent" from "malformed".
 * @param {string} root - Repo root.
 * @returns {{present: boolean, contract: object|null, error: string|null}} Load result.
 */
export function loadContract(root) {
  const file = path.join(root, MAP_REL);
  if (!fs.existsSync(file))
    return { present: false, contract: null, error: null };
  try {
    const contract = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      contract === null ||
      typeof contract !== "object" ||
      Array.isArray(contract)
    ) {
      return {
        present: true,
        contract: null,
        error: `${MAP_REL} is not a JSON object`,
      };
    }
    return { present: true, contract, error: null };
  } catch (error) {
    return {
      present: true,
      contract: null,
      error: `${MAP_REL} is not valid JSON: ${error.message}`,
    };
  }
}

/**
 * Validate the manifest's own adoption block against the mode CI declared.
 *
 * The two must agree: CI is the authority (it survives deletion of `bdd/`),
 * and the manifest is the self-describing record. A disagreement means an
 * adoption was half-performed, which is exactly the state that produces a
 * required check nobody is actually running.
 * @param {object} contract - Parsed coverage map.
 * @param {string} mode - Mode declared by CI.
 * @param {string} today - ISO date to evaluate the expiry against.
 * @returns {object[]} Defects found.
 */
export function validateAdoption(contract, mode, today) {
  const adoption = contract.adoption ?? {};
  const defects = [];
  if (adoption.state && adoption.state !== mode) {
    defects.push(
      defect(
        "adoption-drift",
        `bdd/coverage-map.json declares adoption.state "${adoption.state}" but CI passed BDD_MODE "${mode}". Adoption is one operation: change both, and the ruleset context, together.`
      )
    );
  }
  if (mode === "enforced" && !adoption.state) {
    defects.push(
      defect(
        "adoption-drift",
        `enforced mode requires adoption.state "enforced" in ${MAP_REL}`
      )
    );
  }
  if (mode !== "bootstrap") return defects;
  return [...defects, ...bootstrapDefects(adoption, today)];
}

/**
 * Bootstrap owes a named owner and a hard expiry, and dies at that expiry.
 * @param {object} adoption - The manifest's adoption block.
 * @param {string} today - ISO date to evaluate against.
 * @returns {object[]} Defects found.
 */
function bootstrapDefects(adoption, today) {
  const defects = [];
  if (!adoption.owner) {
    defects.push(
      defect(
        "bootstrap-metadata",
        "bootstrap requires adoption.owner (a named person, not a team)"
      )
    );
  }
  if (!adoption.expiresAt) {
    defects.push(
      defect(
        "bootstrap-metadata",
        "bootstrap requires adoption.expiresAt (an ISO date); a bootstrap with no time-box never ends"
      )
    );
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(adoption.expiresAt)) {
    defects.push(
      defect(
        "bootstrap-metadata",
        "adoption.expiresAt must be an ISO date (YYYY-MM-DD)"
      )
    );
  } else if (adoption.expiresAt < today) {
    defects.push(
      defect(
        "bootstrap-expired",
        `the BDD bootstrap expired on ${adoption.expiresAt} (owner: ${adoption.owner ?? "unnamed"}). Advance to enforced or re-authorize the time-box.`
      )
    );
  }
  return defects;
}

/**
 * Read every supplied execution-result document.
 * @param {string} root - Repo root.
 * @param {readonly string[]} files - Repo-relative or absolute result paths.
 * @returns {{runs: object[], defects: object[]}} Parsed runs and any read errors.
 */
export function loadExecutionResults(root, files) {
  const runs = [];
  const defects = [];
  for (const file of files) {
    const resolved = path.resolve(root, file);
    if (!fs.existsSync(resolved)) {
      defects.push(
        defect("execution-results", `execution results not found: ${file}`)
      );
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
      for (const run of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!run.runner) {
          defects.push(
            defect(
              "execution-results",
              `${file}: each run must name its runner`
            )
          );
          continue;
        }
        runs.push(run);
      }
    } catch (error) {
      defects.push(defect("execution-results", `${file}: ${error.message}`));
    }
  }
  return { runs, defects };
}

/**
 * Run every contract validator plus the base-revision comparisons.
 * @param {object} input - Root, contract, scenarios, platforms, and options.
 * @returns {object[]} Defects found.
 */
function validateAll({ root, contract, scenarios, platforms, options }) {
  const defects = [
    ...validateScenarios(scenarios, platforms),
    ...validateTrackerTags(scenarios, contract.trackers),
    ...validateMappings({ root, scenarios, contract }),
    ...validateWaivers({ scenarios, contract, today: options.today }),
  ];
  if (!options.baseSha) return defects;
  const baseline = loadBaseline(root, options.baseSha);
  if (!baseline.available) {
    return [
      ...defects,
      defect(
        "baseline",
        `base revision ${options.baseSha} is not readable; the ratchet and deletion checks could not run`
      ),
    ];
  }
  return [
    ...defects,
    ...checkRatchet({
      baseContract: baseline.contract,
      contract,
      labels: options.labels,
    }),
    ...checkDeletions({
      baseIds: baseline.scenarioIds,
      scenarios,
      contract,
      labels: options.labels,
    }),
  ];
}

/**
 * Defects that only exist in enforced mode, where absence must fail.
 * @param {object} input - Contract, scenarios, report, and platforms.
 * @returns {object[]} Defects found.
 */
function enforcedDefects({ contract, scenarios, report, platforms }) {
  const defects = [];
  if (scenarios.length === 0) {
    defects.push(
      defect(
        "empty-contract",
        "enforced mode: bdd/features declares zero scenarios"
      )
    );
  }
  if ((contract.mappings ?? []).length === 0) {
    defects.push(
      defect(
        "empty-contract",
        "enforced mode: bdd/coverage-map.json declares zero test mappings"
      )
    );
  }
  if (Object.keys(contract.runnerPlatforms ?? {}).length === 0) {
    defects.push(
      defect(
        "empty-contract",
        "enforced mode: bdd/coverage-map.json declares no runnerPlatforms"
      )
    );
  }
  for (const platform of report.floor.unset) {
    defects.push(
      defect(
        "floor-missing",
        `enforced mode: no coverageFloor declared for platform ${platform}`
      )
    );
  }
  for (const [platform, value] of Object.entries(report.floor.byPlatform)) {
    if (!value.ok) {
      defects.push(
        defect(
          "floor-regression",
          `${platform} traceability coverage ${value.actual}% is below its committed floor of ${value.floor}%`
        )
      );
    }
  }
  void platforms;
  return defects;
}

/**
 * Evaluate the gate.
 * @param {string} root - Repo root.
 * @param {object} options - Mode, dates, labels, base SHA, and result files.
 * @returns {object} The result envelope.
 */
export function run(root, options) {
  const { mode } = options;
  const loaded = loadContract(root);
  const fatal = configFatals(loaded, mode);
  if (fatal)
    return envelope({ mode, status: "failed", defects: [fatal], report: null });
  if (!loaded.present) {
    return envelope({ mode, status: "not-adopted", defects: [], report: null });
  }
  const contract = loaded.contract;
  const versionDefect = schemaDefect(contract);
  const platforms = declaredPlatforms(contract.runnerPlatforms);
  const scenarios = loadScenarios(root, platforms);
  const execution = loadExecutionResults(root, options.resultFiles ?? []);
  const report = buildReport({
    scenarios,
    contract,
    runs: execution.runs,
    platforms,
  });
  const defects = [
    ...(versionDefect ? [versionDefect] : []),
    ...validateAdoption(contract, mode, options.today),
    ...execution.defects,
    ...validateAll({ root, contract, scenarios, platforms, options }),
    ...(mode === "enforced"
      ? enforcedDefects({ contract, scenarios, report, platforms })
      : []),
  ];
  return envelope({ mode, status: statusFor(mode, defects), defects, report });
}

/**
 * Configuration problems that stop the gate before it can evaluate anything.
 * @param {object} loaded - Result of {@link loadContract}.
 * @param {string} mode - Adoption state.
 * @returns {object|null} The fatal defect, or null.
 */
function configFatals(loaded, mode) {
  if (loaded.error) return defect("config-malformed", loaded.error);
  if (loaded.present || mode === "not-adopted") return null;
  return defect(
    "config-absent",
    `${mode} mode requires ${MAP_REL}, which does not exist. In ${mode} mode absence is a failure, never a skip.`
  );
}

/**
 * Reject a coverage map written against an unknown schema version.
 * @param {object} contract - Parsed coverage map.
 * @returns {object|null} The defect, or null.
 */
function schemaDefect(contract) {
  const version = contract.schemaVersion;
  if (SUPPORTED_MAP_SCHEMA_VERSIONS.includes(version)) return null;
  return defect(
    "config-schema",
    `bdd/coverage-map.json schemaVersion ${JSON.stringify(version)} is not supported (this gate reads ${SUPPORTED_MAP_SCHEMA_VERSIONS.join(", ")})`
  );
}

/**
 * Map mode plus defects onto a run status.
 * @param {string} mode - Adoption state.
 * @param {readonly object[]} defects - Defects found.
 * @returns {string} The status.
 */
function statusFor(mode, defects) {
  if (defects.length === 0) return "passed";
  if (mode === "enforced") return "failed";
  const fatalCodes = [
    "bootstrap-expired",
    "bootstrap-metadata",
    "adoption-drift",
    "config-malformed",
    "config-schema",
  ];
  const fatal = defects.some(item => fatalCodes.includes(item.code));
  if (mode === "bootstrap") return fatal ? "failed" : "bootstrap-warnings";
  return fatal ? "failed" : "passed";
}

/**
 * Wrap a result in the standard command envelope (Lisa A8).
 * @param {object} input - Mode, status, defects, and report.
 * @returns {object} The envelope.
 */
function envelope({ mode, status, defects, report }) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    capability: "bdd-coverage",
    operation: "check",
    mode,
    status,
    contractVersion: report?.schemaVersion ?? null,
    defects: defects.map(item => ({ ...item })),
    report,
    summary: summaryLine(mode, status, report, defects.length),
  };
}

/**
 * One operator-readable line naming what the gate proved.
 * @param {string} mode - Adoption state.
 * @param {string} status - Run status.
 * @param {object|null} report - The report, when built.
 * @param {number} defectCount - Number of defects.
 * @returns {string} Summary line.
 */
function summaryLine(mode, status, report, defectCount) {
  if (!report)
    return `bdd-coverage ${mode}: ${status} (${defectCount} defects)`;
  const trace = report.traceability.overall;
  const exec = report.execution.supplied
    ? `${report.execution.executed}/${report.execution.mappedTests} mapped tests executed, ${report.execution.passed} passed / ${report.execution.failed} failed / ${report.execution.skipped} skipped`
    : "no execution evidence supplied";
  return `bdd-coverage ${mode}: ${status}; ${report.scenarios.declared} scenarios declared, traceability ${trace.covered}/${trace.total} (${trace.percentage}%), ${exec}, ${report.waived.count} waived, ${defectCount} defects`;
}

/**
 * Parse argv into options.
 * @param {readonly string[]} argv - Process arguments.
 * @param {Record<string, string|undefined>} env - Process environment.
 * @returns {object} Parsed options.
 */
export function parseArgs(argv, env) {
  const resultFiles = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--results" && argv[index + 1]) {
      resultFiles.push(argv[index + 1]);
      index += 1;
    }
  }
  if (env.BDD_EXECUTION_RESULTS) {
    resultFiles.push(
      ...env.BDD_EXECUTION_RESULTS.split(",")
        .map(item => item.trim())
        .filter(Boolean)
    );
  }
  return {
    write: argv.includes("--write"),
    json: argv.includes("--json"),
    resultFiles,
    baseSha: env.BDD_BASE_SHA || null,
    labels: (env.BDD_PR_LABELS ?? "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean),
    today: env.BDD_TODAY || new Date().toISOString().slice(0, 10),
  };
}

/**
 * CLI entry point.
 * @returns {void}
 */
function main() {
  const root = process.env.BDD_COVERAGE_ROOT || PACKAGE_ROOT;
  const resolved = resolveMode(process.env);
  if (resolved.error) {
    console.error(`[bdd-coverage] ${resolved.error}`);
    process.exitCode = 2;
    return;
  }
  const options = {
    ...parseArgs(process.argv.slice(2), process.env),
    mode: resolved.mode,
  };
  const result = run(root, options);
  if (options.write && result.report) writeArtifacts(root, result.report);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  process.exitCode = result.status === "failed" ? 1 : 0;
}

/**
 * Write the regenerated machine report and burndown.
 * @param {string} root - Repo root.
 * @param {object} report - The report.
 * @returns {void}
 */
function writeArtifacts(root, report) {
  fs.writeFileSync(
    path.join(root, "bdd", "coverage-report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "e2e-bdd-coverage.md"),
    `${renderBurndown(report).trim()}\n`
  );
}

/**
 * Print the human-readable result.
 * @param {object} result - The envelope.
 * @returns {void}
 */
function printHuman(result) {
  const log = result.status === "failed" ? console.error : console.log;
  for (const item of result.defects)
    log(`[bdd-coverage] ${item.code}: ${item.message}`);
  if (result.mode === "bootstrap" && result.defects.length > 0) {
    console.log(
      "[bdd-coverage] bootstrap: the defects above are visible warnings, not blockers, until this repo advances to enforced."
    );
  }
  log(`[bdd-coverage] ${result.summary}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
