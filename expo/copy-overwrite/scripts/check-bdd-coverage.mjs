#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * check-bdd-coverage — the BDD behavior-contract gate.
 *
 * Validates `bdd/features/*.feature` against `bdd/coverage-map.json` and
 * reports five separate facts: behaviors DECLARED, obligations MAPPED to an
 * automated test (traceability), mapped tests that RAN, what those runs
 * returned, and what is WAIVED. Traceability coverage is not execution
 * coverage and is never a pass rate.
 *
 * ONE ADOPTION CONTROL, and it is not this file's. Whether the property is
 * governed at all is decided by the gate declaration — `required`, `optional`,
 * or `off` — the same declaration every other quality job answers to. This gate
 * used to carry a second, private axis (`BDD_MODE`, plus an `adoption` block in
 * the coverage map) that could disagree with it, and the losing control lost
 * silently. Both are retired; `BDD_MODE` is now refused rather than read.
 *
 * So the prover has exactly one behaviour: it proves. Absence fails. A missing
 * config, a malformed manifest, zero scenarios, zero mappings, any contract
 * defect, a platform below its committed floor, coverage given back, new
 * behavior nobody mapped or waived, a deleted scenario, or a run with no base
 * revision to compare against all fail loudly, and there are no warnings — a
 * defect graded amber is a defect nobody fixes. A project that does not want
 * that declares the gate `off`, which is a decision a reader can find in the
 * settings file, rather than a green check that found five hundred defects.
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
import { fileURLToPath } from "node:url";

import {
  GATE_LEVELS,
  RETIRED_ADOPTION_STATES,
  SUPPORTED_MAP_SCHEMA_VERSIONS,
  declaredPlatforms,
} from "./bdd/contract.mjs";
import {
  SUCCESS_STATUSES,
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
import {
  disclosureDefects,
  discoverSpecs,
  missingDiscoveryDefects,
} from "./bdd/discover.mjs";
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
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const MAP_REL = "bdd/coverage-map.json";
const defect = (code, message) => ({ code, message });

/** Defect code, named once. */
const EXECUTION_RESULTS = "execution-results";

/** Defect code, named once. */
const EMPTY_CONTRACT = "empty-contract";

/** Defect code, named once. */
const ADOPTION_RETIRED = "adoption-retired";

/** How every retirement message ends, so all of them name the same remedy. */
const DECLARE_INSTEAD =
  `Declare this gate in .lisa.config.json at one of ${GATE_LEVELS.join(", ")}` +
  " — that declaration is now the only control over whether the property is" +
  " governed.";

/**
 * Refuse a `BDD_MODE` the gate no longer reads.
 *
 * `BDD_MODE` was a second adoption control alongside the gate declaration, and
 * it is retired. Ignoring a value someone deliberately set would be the worst
 * of the three options: the setting would keep looking like configuration while
 * deciding nothing, which is the exact failure the collapse was done to remove.
 *
 * The refusal names the value. A retired one gets its own sentence saying what
 * it was and why it went, because telling the author of `bootstrap` to check
 * for a typo sends them hunting a mistake they did not make.
 * @param {Record<string, string|undefined>} env - Process environment.
 * @returns {{error: string|null}} The refusal, when there is one.
 */
export function refuseRetiredMode(env) {
  const raw = (env.BDD_MODE ?? "").trim();
  if (raw === "") return { error: null };
  const known = RETIRED_ADOPTION_STATES[raw];
  return {
    error: known
      ? `BDD_MODE="${raw}" is ${known}`
      : `BDD_MODE is retired and "${raw}" was never one of its values. ${DECLARE_INSTEAD}`,
  };
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
 * Refuse an `adoption` block the gate no longer reads.
 *
 * The block mirrored `BDD_MODE` inside the manifest, and `adoption-drift`
 * existed to catch the two disagreeing. With one control left there is nothing
 * for it to mirror, so the block is dead configuration — and dead configuration
 * that still reads like a switch is how a project believes it declared
 * something it did not.
 *
 * Refused rather than ignored, and refused whatever it says: a stale
 * `"state": "enforced"` is exactly as misleading as a stale `"bootstrap"`, and
 * only deleting it makes the settings file true. The message names the value so
 * the author of a `bootstrap` block is told what happened to it rather than
 * left to guess.
 * @param {object} contract - Parsed coverage map.
 * @returns {object[]} Defects found.
 */
export function retiredAdoptionDefects(contract) {
  const adoption = contract.adoption;
  if (adoption === undefined) return [];
  const state = typeof adoption?.state === "string" ? adoption.state : null;
  const known = state ? RETIRED_ADOPTION_STATES[state] : null;
  const preamble = known
    ? `${MAP_REL} declares adoption.state "${state}", which is ${known}`
    : `${MAP_REL} carries an "adoption" block, which is retired: the gate no longer reads it`;
  return [
    defect(
      ADOPTION_RETIRED,
      `${preamble} Delete the block. ${DECLARE_INSTEAD}`
    ),
  ];
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
        defect(EXECUTION_RESULTS, `execution results not found: ${file}`)
      );
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
      for (const run of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!run.runner) {
          defects.push(
            defect(EXECUTION_RESULTS, `${file}: each run must name its runner`)
          );
          continue;
        }
        runs.push(run);
      }
    } catch (error) {
      defects.push(defect(EXECUTION_RESULTS, `${file}: ${error.message}`));
    }
  }
  return { runs, defects };
}

/**
 * Run every contract validator plus the base-revision comparisons.
 * @param {object} input - Root, contract, scenarios, platforms, and options.
 * @returns {object[]} Defects found.
 */
function validateAll({
  root,
  contract,
  scenarios,
  platforms,
  options,
  cache,
  discovery,
}) {
  const defects = [
    ...validateScenarios(scenarios, platforms),
    ...validateTrackerTags(scenarios, contract.trackers),
    ...validateMappings({ root, scenarios, contract, cache }),
    ...validateWaivers({ scenarios, contract, today: options.today }),
    ...discovery.defects,
    ...disclosureDefects({ root, contract, discovery }),
  ];
  if (!options.baseSha) return [...defects, MISSING_BASE_DEFECT];
  const baseline = loadBaseline(root, options.baseSha, platforms);
  if (!baseline.available) {
    return [
      ...defects,
      defect(
        "baseline",
        `base revision ${options.baseSha} is not readable${baseline.error ? ` (${baseline.error})` : ""}, so the non-regression checks could not run. A gate that cannot compare against a base does not get to report that nothing regressed.`
      ),
    ];
  }
  return [
    ...defects,
    ...checkCoverageRegression({
      baseline,
      contract,
      scenarios,
    }),
    ...checkNewObligations({ baseline, contract, scenarios }),
    ...checkDeletions({
      baseIds: baseline.scenarioIds,
      scenarios,
      contract,
    }),
  ];
}

/**
 * What a run with no base revision reports.
 *
 * Non-regression is the whole of what protects accepted coverage now that the
 * floor is a plain bar rather than a ratchet, and every one of those checks
 * needs a base. Running without one used to skip them in silence, which is a
 * gate reporting a property it never evaluated.
 *
 * Unconditional, and therefore a constant rather than a function. The exemption
 * used to be spelled "not in enforced mode", and with the mode axis retired
 * that phrase has no referent: a run either proves non-regression or admits it
 * could not.
 */
const MISSING_BASE_DEFECT = defect(
  "baseline",
  "BDD_BASE_SHA is required: without a base revision the gate cannot tell coverage that was given back from coverage that was never there, so it refuses to claim either."
);

/**
 * A malformed coverage floor.
 *
 * A floor written as `"19"` rather than `19` disables the ratchet AND removes
 * the platform from enforcement, in one character, in one file, with no other
 * signal. It is refused rather than ignored.
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
 * Absence, which must fail.
 *
 * These used to be skipped outside `enforced` — the largest of the carve-outs
 * the adoption axis bought, and the one that made a non-enforced run report a
 * property it had not evaluated. There is one mode now, so they always run.
 *
 * The platform vocabulary is deliberately NOT a parameter: every platform this
 * function cares about already reaches it through `report.floor`, which was
 * built from that same vocabulary. It used to be passed and discarded behind a
 * `void`, which reads as "unused for now" and hides whether an intended check
 * was ever written.
 * @param {object} input - Contract, scenarios, report, and discovery.
 * @returns {object[]} Defects found.
 */
function completenessDefects({ contract, scenarios, report, discovery }) {
  const defects = [];
  if (scenarios.length === 0) {
    defects.push(
      defect(EMPTY_CONTRACT, "bdd/features declares zero scenarios")
    );
  }
  if ((contract.mappings ?? []).length === 0) {
    defects.push(
      defect(
        EMPTY_CONTRACT,
        "bdd/coverage-map.json declares zero test mappings"
      )
    );
  }
  if (Object.keys(contract.runnerPlatforms ?? {}).length === 0) {
    defects.push(
      defect(
        EMPTY_CONTRACT,
        "bdd/coverage-map.json declares no runnerPlatforms"
      )
    );
  }
  defects.push(...missingDiscoveryDefects(contract, discovery));
  for (const platform of report.floor.unset) {
    defects.push(
      defect(
        "floor-missing",
        `no coverageFloor declared for platform ${platform}`
      )
    );
  }
  for (const [platform, value] of Object.entries(report.floor.byPlatform)) {
    if (!value.ok) {
      defects.push(
        defect(
          "floor-regression",
          `${platform} traceability coverage ${measured(value)}% is below its committed floor of ${value.floor}%`
        )
      );
    }
  }
  return defects;
}

/**
 * The measured percentage, printed at enough precision to explain the verdict.
 *
 * The floor is decided on the unrounded value, so a platform sitting at
 * 99.95% must not be told it failed at "100%" — a message that contradicts
 * its own finding is how an operator concludes the gate is broken.
 * @param {{actual: number|null, exact: number|null}} value - A floor entry.
 * @returns {string} The percentage to print.
 */
function measured(value) {
  if (value.exact === null) return String(value.actual);
  return String(Number(value.exact.toFixed(4)));
}

/**
 * Evaluate the gate.
 * @param {string} root - Repo root.
 * @param {object} options - Mode, dates, labels, base SHA, and result files.
 * @returns {object} The result envelope.
 */
export function run(root, options) {
  const loaded = loadContract(root);
  const fatal = configFatals(loaded);
  if (fatal) return result({ defects: [fatal], report: null, contract: null });
  const contract = loaded.contract;
  const versionDefect = schemaDefect(contract);
  const platforms = declaredPlatforms(contract.runnerPlatforms);
  const scenarios = loadScenarios(root, platforms);
  const execution = loadExecutionResults(root, options.resultFiles ?? []);
  // One file cache serves both the evidence defects and the coverage count,
  // so each mapped file is read once no matter how large the manifest.
  const cache = new Map();
  const unresolved = unresolvedEvidenceKeys({ root, contract, cache });
  // Discovery answers the question the declared half cannot: which tests exist
  // that the manifest never mentions. It runs before the report so the report
  // can carry the inventory it produced.
  const discovery = discoverSpecs({ root, contract });
  const report = buildReport({
    scenarios,
    contract,
    runs: execution.runs,
    platforms,
    unresolved,
    discovery,
  });
  const defects = [
    ...(versionDefect ? [versionDefect] : []),
    ...retiredAdoptionDefects(contract),
    ...execution.defects,
    ...floorIntegrityDefects(report),
    ...validateAll({
      root,
      contract,
      scenarios,
      platforms,
      options,
      cache,
      discovery,
    }),
    ...completenessDefects({ contract, scenarios, report, discovery }),
  ];
  return result({ defects, report, contract });
}

/**
 * Configuration problems that stop the gate before it can evaluate anything.
 *
 * A missing manifest is one of them. It used to be tolerated outside
 * `enforced`, which meant the commonest way to switch this gate off was to
 * delete the file it reads — an absence that looks identical to an oversight.
 * The way to switch it off is to declare it `off`.
 * @param {object} loaded - Result of {@link loadContract}.
 * @returns {object|null} The fatal defect, or null.
 */
function configFatals(loaded) {
  if (loaded.error) return defect("config-malformed", loaded.error);
  if (loaded.present) return null;
  return defect(
    "config-absent",
    `${MAP_REL} does not exist, and its absence is a failure, never a skip. ${DECLARE_INSTEAD}`
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
 * Assemble the gate's internal result.
 *
 * No severity is resolved here any more, because there is no longer more than
 * one. A defect fails the run; the exit code, the human output and the envelope
 * findings therefore cannot disagree about whether something counted, which is
 * the property the grading step existed to preserve and the reason it can go.
 * @param {object} input - Defects, report, and the parsed contract.
 * @returns {object} The internal result.
 */
function result({ defects, report, contract }) {
  return {
    status: statusFor({ defects, fatal: hasFatalDefect(defects), report }),
    defects,
    report,
    contract,
  };
}

/**
 * Map the run onto the standard envelope's status vocabulary.
 * @param {object} input - Defects, fatality, and the report.
 * @returns {string} An envelope status.
 */
function statusFor({ defects, fatal, report }) {
  if (defects.some(item => INVALID_CODES.includes(item.code))) return "invalid";
  if (fatal) return "failed";
  return report ? "completed" : "no-op";
}

/**
 * One operator-readable line naming what the gate proved, and what it did not.
 * @param {object} run - The internal result.
 * @returns {string} Summary line.
 */
function summaryLine(run) {
  const head = `bdd-coverage: ${run.status}`;
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
  const first = run.defects[0];
  return first
    ? `${first.code}: ${first.message}`
    : "bdd-coverage did not complete";
}

/**
 * Convert the internal result into Lisa's standard command envelope.
 *
 * `mode` is the ENVELOPE's mode — the gate really runs, so it is always
 * `real`. There is no second axis to carry: whether the property is governed is
 * the gate declaration's answer, and it is decided before this gate is invoked
 * at all.
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
      status: gateRun.status,
      summary: summaryLine(gateRun),
    }),
    summary: {
      ...buildSummary({
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
  const refused = refuseRetiredMode(process.env);
  if (refused.error) {
    console.error(`[bdd-coverage] ${refused.error}`);
    process.exitCode = 2;
    return;
  }
  const options = parseArgs(process.argv.slice(2), process.env);
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
 *
 * When the shared module is present but REFUSES the envelope — a schema this
 * gate's fields no longer satisfy, or a half-copied `scripts/` directory whose
 * schema document never arrived — that refusal is caught rather than thrown.
 * An uncaught rejection here produced no envelope at all and a Node-supplied
 * exit code, which is the one outcome this function exists to rule out. The
 * fields are emitted with `status: "invalid"`, so the run is machine-readable,
 * operator-readable, and NONZERO.
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
  try {
    return shared.buildEnvelope(fields);
  } catch (error) {
    console.error(`[bdd-coverage] ${error.message}`);
    return {
      schemaVersion: "lisa-command-envelope-v1",
      ...fields,
      status: "invalid",
      reason: `the result could not be sealed into a valid command envelope: ${error.message}`,
    };
  }
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
    console.error(`[bdd-coverage] ${item.code}: ${item.message}`);
  }
  console.error(`[bdd-coverage] ${envelope.summary.headline}`);
}

if (invokedAsScript(import.meta.url)) main();
