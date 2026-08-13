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
 *                scenarios, zero mappings, any contract defect, a platform
 *                below its committed floor, coverage given back, new behavior
 *                nobody mapped or waived, a deleted scenario, or a run with no
 *                base revision to compare against all fail loudly. Only in
 *                this state is the check a required ruleset context.
 *
 * The committed `coverageFloor` is an ABSOLUTE BAR, not a ratchet: it answers
 * "is this platform below the bar right now", and nothing stops a project
 * lowering it. Non-regression is a separate, deterministic job done per
 * obligation in `bdd/baseline.mjs` — see that module for why a number was the
 * wrong instrument for it.
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
  SUPPORTED_MAP_SCHEMA_VERSIONS,
  declaredPlatforms,
} from "./bdd/contract.mjs";
import {
  SUCCESS_STATUSES,
  WARNABLE_DEFECT_CODES,
  buildSummary,
  contractVersion,
  correlationId,
  hasFatalDefect,
  loadEnvelopeModule,
  subjectFor,
} from "./bdd/envelope.mjs";
import {
  checkCoverageRegression,
  checkDeletions,
  checkNewObligations,
  loadBaseline,
} from "./bdd/baseline.mjs";
import { loadScenarios } from "./bdd/parse.mjs";
import { buildReport } from "./bdd/report.mjs";
import { renderBurndown } from "./bdd/render.mjs";
import {
  unresolvedEvidenceKeys,
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
function validateAll({ root, contract, scenarios, platforms, options, cache }) {
  const defects = [
    ...validateScenarios(scenarios, platforms),
    ...validateTrackerTags(scenarios, contract.trackers),
    ...validateMappings({ root, scenarios, contract, cache }),
    ...validateWaivers({ scenarios, contract, today: options.today }),
  ];
  if (!options.baseSha) return [...defects, ...missingBaseDefects(options)];
  const baseline = loadBaseline(root, options.baseSha, platforms);
  if (!baseline.available) {
    return [
      ...defects,
      defect(
        "baseline",
        `base revision ${options.baseSha} is not readable, so the non-regression checks could not run. A gate that cannot compare against a base does not get to report that nothing regressed.`
      ),
    ];
  }
  return [
    ...defects,
    ...checkCoverageRegression({
      baseline,
      contract,
      scenarios,
      labels: options.labels,
    }),
    ...checkNewObligations({ baseline, contract, scenarios }),
    ...checkDeletions({
      baseIds: baseline.scenarioIds,
      scenarios,
      contract,
      labels: options.labels,
    }),
  ];
}

/**
 * Enforced mode owes a base revision.
 *
 * Non-regression is the whole of what protects accepted coverage now that the
 * floor is a plain bar rather than a ratchet, and every one of those checks
 * needs a base. Running without one used to skip them in silence, which is a
 * gate reporting a property it never evaluated. Bootstrap stays quiet — it is
 * non-blocking by construction — and a local run outside CI is not making a
 * merge decision, so neither is asked for a base it does not have.
 * @param {object} options - Parsed CLI/environment options.
 * @returns {object[]} Zero or one defect.
 */
function missingBaseDefects(options) {
  if (options.mode !== "enforced") return [];
  return [
    defect(
      "baseline",
      "enforced mode requires BDD_BASE_SHA: without a base revision the gate cannot tell coverage that was given back from coverage that was never there, so it refuses to claim either."
    ),
  ];
}

/**
 * A malformed coverage floor, in EVERY adopted state.
 *
 * This is config integrity, not contract quality, so bootstrap does not
 * downgrade it: a floor written as `"19"` rather than `19` disables the
 * ratchet AND removes the platform from enforcement, in one character, in
 * one file, with no other signal. It is refused rather than ignored.
 * @param {object} report - The built report.
 * @returns {object[]} Defects found.
 */
function floorIntegrityDefects(report) {
  return (report.floor.invalid ?? []).map(platform =>
    defect(
      "floor-invalid",
      `coverageFloor.${platform} is not a number between 0 and 100; a non-numeric floor silently disables enforcement, so it is refused rather than ignored`
    )
  );
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
    return result({ mode, defects: [fatal], report: null, contract: null });
  if (!loaded.present) {
    return result({ mode, defects: [], report: null, contract: null });
  }
  const contract = loaded.contract;
  const versionDefect = schemaDefect(contract);
  const platforms = declaredPlatforms(contract.runnerPlatforms);
  const scenarios = loadScenarios(root, platforms);
  const execution = loadExecutionResults(root, options.resultFiles ?? []);
  // One file cache serves both the evidence defects and the coverage count,
  // so each mapped file is read once no matter how large the manifest.
  const cache = new Map();
  const unresolved = unresolvedEvidenceKeys({ root, contract, cache });
  const report = buildReport({
    scenarios,
    contract,
    runs: execution.runs,
    platforms,
    unresolved,
  });
  const defects = [
    ...(versionDefect ? [versionDefect] : []),
    ...validateAdoption(contract, mode, options.today),
    ...execution.defects,
    ...floorIntegrityDefects(report),
    ...validateAll({ root, contract, scenarios, platforms, options, cache }),
    ...(mode === "enforced"
      ? enforcedDefects({ contract, scenarios, report, platforms })
      : []),
  ];
  return result({ mode, defects, report, contract });
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
 * Statuses that must NOT map onto `failed`, because they describe a bad
 * request or an unreadable contract rather than a contract that failed.
 * Source constants, deliberately: an unrecognized code falls through to
 * `failed`, which is the closed direction.
 */
const INVALID_CODES = Object.freeze([
  "config-malformed",
  "config-schema",
  "config-absent",
]);

/**
 * Assemble the gate's internal result, with each defect's severity resolved.
 *
 * Severity is decided here, once, from the adoption state and the warnable
 * allowlist, so the human output, the envelope findings and the exit code can
 * never disagree about whether something was a warning.
 * @param {object} input - Mode, defects, report, and the parsed contract.
 * @returns {object} The internal result.
 */
function result({ mode, defects, report, contract }) {
  const fatal = hasFatalDefect(mode, defects);
  const graded = defects.map(item => ({
    ...item,
    severity:
      mode === "enforced" || !WARNABLE_DEFECT_CODES.includes(item.code)
        ? "error"
        : "warning",
  }));
  return {
    adoptionState: mode,
    status: statusFor({ mode, defects: graded, fatal, report }),
    defects: graded,
    report,
    contract,
  };
}

/**
 * Map the run onto the standard envelope's status vocabulary.
 * @param {object} input - Mode, graded defects, fatality, and the report.
 * @returns {string} An envelope status.
 */
function statusFor({ mode, defects, fatal, report }) {
  if (defects.some(item => INVALID_CODES.includes(item.code))) return "invalid";
  if (fatal) return "failed";
  if (mode === "not-adopted" && !report) return "not-adopted";
  return "completed";
}

/**
 * One operator-readable line naming what the gate proved, and what it did not.
 * @param {object} run - The internal result.
 * @returns {string} Summary line.
 */
function summaryLine(run) {
  const head = `bdd-coverage ${run.adoptionState}: ${run.status}`;
  if (!run.report) return `${head} (${run.defects.length} findings)`;
  const trace = run.report.traceability.overall;
  const execution = run.report.execution.supplied
    ? `${run.report.execution.executed}/${run.report.execution.mappedTests} mapped tests executed, ${run.report.execution.passed} passed / ${run.report.execution.failed} failed / ${run.report.execution.skipped} skipped`
    : "no execution evidence supplied";
  return `${head}; ${run.report.scenarios.declared} scenarios declared, traceability ${trace.covered}/${trace.total} (${trace.percentage}%), ${execution}, ${run.report.waived.count} waived, ${run.defects.length} findings`;
}

/**
 * The one-sentence `reason` the envelope requires for a non-success status.
 * @param {object} run - The internal result.
 * @returns {string} The reason.
 */
function reasonFor(run) {
  const first = run.defects.find(item => item.severity === "error");
  return first
    ? `${first.code}: ${first.message}`
    : `bdd-coverage ${run.adoptionState} did not complete`;
}

/**
 * Convert the internal result into Lisa's standard command envelope.
 *
 * `mode` is the ENVELOPE's mode — the gate really runs, so it is always
 * `real`. The BDD adoption state is a different axis and rides in
 * `summary.adoptionState`, with `status: "not-adopted"` carrying it for a
 * repo that has not wired the contract.
 * @param {object} input - The result, the environment, and CLI options.
 * @returns {object} An envelope conforming to lisa-command-envelope.v1.
 */
export function toCommandEnvelope({
  run: gateRun,
  env,
  options,
  filesWritten,
}) {
  const fields = {
    capability: "bdd-coverage",
    mode: "real",
    operation: "check",
    environment: env.BDD_ENVIRONMENT || "local",
    contractVersion: contractVersion(gateRun.contract),
    dryRun: !options.write,
    status: gateRun.status,
    correlationId: correlationId(env.BDD_CORRELATION_ID, {
      adoptionState: gateRun.adoptionState,
      status: gateRun.status,
      summary: summaryLine(gateRun),
    }),
    summary: {
      ...buildSummary({
        adoptionState: gateRun.adoptionState,
        report: gateRun.report,
        defects: gateRun.defects,
        filesWritten,
      }),
      headline: summaryLine(gateRun),
    },
    findings: gateRun.defects.map(item => ({
      code: item.code,
      subject: subjectFor(item),
      message: item.message,
      severity: item.severity,
    })),
  };
  return SUCCESS_STATUSES.includes(gateRun.status)
    ? fields
    : { ...fields, reason: reasonFor(gateRun) };
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
    report: argv.includes("--report"),
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
 *
 * stdout carries exactly one machine-readable result — the standard command
 * envelope — and human narration goes to stderr, per the envelope contract.
 * @returns {Promise<void>} Resolves once the exit code is set.
 */
async function main() {
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
  const gateRun = run(root, options);
  const filesWritten =
    options.write && gateRun.report ? writeArtifacts(root, gateRun.report) : 0;
  const envelope = await sealEnvelope({ gateRun, options, filesWritten });
  // Exactly ONE machine-readable object on stdout. `--report` is a diagnostic
  // that swaps the envelope for the detailed report; it never adds a second
  // document, because a stream carrying two shapes has no schema at all.
  if (options.report) console.log(JSON.stringify(gateRun.report, null, 2));
  else if (options.json) console.log(JSON.stringify(envelope, null, 2));
  printHuman(gateRun, envelope);
  process.exitCode = SUCCESS_STATUSES.includes(envelope.status) ? 0 : 1;
}

/**
 * Build the envelope through the shared module when it is installed, so its
 * validator — not this file — decides conformance.
 *
 * When the shared module is absent the same object is emitted unvalidated
 * rather than nothing: a gate that produces no result is indistinguishable
 * from one that passed.
 * @param {object} input - The gate run, CLI options, and files written.
 * @returns {Promise<object>} The envelope.
 */
async function sealEnvelope({ gateRun, options, filesWritten }) {
  const fields = toCommandEnvelope({
    run: gateRun,
    env: process.env,
    options,
    filesWritten,
  });
  const shared = await loadEnvelopeModule(
    path.dirname(fileURLToPath(import.meta.url))
  );
  if (!shared) {
    console.error(
      "[bdd-coverage] scripts/lisa-command-envelope.mjs is not installed; emitting the envelope without validating it against the published schema."
    );
    return { schemaVersion: "lisa-command-envelope-v1", ...fields };
  }
  return shared.buildEnvelope(fields);
}

/**
 * Write the regenerated machine report and burndown.
 * @param {string} root - Repo root.
 * @param {object} report - The report.
 * @returns {number} How many files were written, for the envelope's counters.
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
  return 2;
}

/**
 * Narrate the result on stderr, which the envelope contract reserves for
 * humans so stdout stays exactly one machine-readable object.
 * @param {object} gateRun - The internal result.
 * @param {object} envelope - The emitted envelope.
 * @returns {void}
 */
function printHuman(gateRun, envelope) {
  for (const item of gateRun.defects) {
    console.error(
      `[bdd-coverage] ${item.severity}: ${item.code}: ${item.message}`
    );
  }
  if (gateRun.adoptionState === "bootstrap" && gateRun.defects.length > 0) {
    console.error(
      "[bdd-coverage] bootstrap: warnings above are visible, not blockers, until this repo advances to enforced. Anything reported as `error` fails even here."
    );
  }
  console.error(`[bdd-coverage] ${envelope.summary.headline}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
