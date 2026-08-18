/**
 * Ensure a project actually declares the Work-Item Traceability gate.
 *
 * Every upstream layer already sanctions it — the gate registry declares it at
 * `pull-request`, the TypeScript ruleset template names the context as
 * required, and the promotion ledger grandfathers it. Lisa's own repository
 * enforces it. Measured 2026-08-18, **no consumer did**: `traceability` was
 * absent from all five projects' `.lisa.config.json`.
 *
 * WHAT AN UNDECLARED GATE COSTS, RESTATED AFTER #2680. An earlier draft of this
 * check said an undeclared gate meant "the job never ran at all". That was true
 * when the job's `if:` keyed on `skip_jobs` and ignored the config. Since #2680
 * it is false: the job runs on every pull request, and with the gate undeclared
 * (`configured=false`) the built-in validation step still runs and still reds.
 *
 * The real cost is narrower and easier to miss. `contextsFor` filters on
 * `gate.level === "required"`, so an undeclared gate emits no required status
 * context — the job reds and **merges anyway**. Declaring it is what converts an
 * ignorable red into a blocking one. Do not restore the stronger claim without
 * re-measuring: it was wrong once already, and a repair that overstates what it
 * fixes is the same defect class as a check that reports work it never did.
 *
 * Two independent layers decide whether a missing trailer blocks, and
 * conflating them is why this went unseen:
 *
 *   1. the gate's level in `.lisa.config.json` — does the JOB run and fail?
 *   2. branch-protection required contexts — does a failing job BLOCK a merge?
 *
 * This check repairs layer 1, which is the one that produces any signal at all,
 * and only REPORTS layer 2. Promoting a context is governed by its own control
 * (`check-required-check-promotions.mjs`), and mutating live branch protection
 * belongs to `scripts/lisa-github-rulesets.sh`.
 * @module cli/doctor-traceability-gate
 */
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import type { DoctorCheck } from "./doctor.js";

const CHECK_NAME = "Work-Item Traceability declared?";

/**
 * What this check can and cannot see about layer 2.
 *
 * `lisa doctor` runs offline, so it never observes live branch protection. A
 * declared gate therefore proves the job will FAIL, never that the failure will
 * BLOCK — `contextsFor` only emits the context, and the ruleset has to require
 * it. Saying nothing here would let a green doctor read as "traceability is
 * enforced" when the context may not be required at all, which is the exact
 * conflation #2677 was filed about. So both branches say it, and both name
 * where layer 2 IS observed rather than leaving the reader to find it.
 */
const LAYER_TWO_NOTE =
  `Whether a failure BLOCKS a merge is a separate layer that \`lisa doctor\` ` +
  `cannot see: it runs offline and never reads live branch protection. Check ` +
  `it with \`lisa health\` (the \`github.rulesets\` finding names any context ` +
  `that "runs without blocking"), and apply the ruleset with ` +
  `scripts/lisa-github-rulesets.sh if the context is missing.`;

/** The gate id as the registry declares it. */
export const GATE_ID = "traceability";

/** The moment the registry permits for this gate. */
export const GATE_MOMENT = "pull-request";

/** What an undeclared project is repaired to. */
export const GATE_LEVEL = "required";

/** The subset of `.lisa.config.json` this check reads. */
interface GateConfig {
  readonly gates?: Record<string, unknown>;
}

/**
 * Whether a config declares the traceability gate at all.
 *
 * Declared-as-`off` counts as declared. A repair that overwrote an explicit
 * opt-out would make the gate un-declinable, which is worse than the hole it
 * closes: the project could never express a considered exemption, and the next
 * `lisa doctor` would silently undo a deliberate decision.
 * @param config - Parsed `.lisa.config.json`
 * @returns True when the project has already made a decision about this gate.
 */
export function declaresTraceability(config: GateConfig): boolean {
  return Object.hasOwn(config.gates ?? {}, GATE_ID);
}

/**
 * Add the gate at its registry-legal moment, without touching anything else.
 *
 * Returns a new object rather than mutating, so a caller that decides not to
 * write still holds the original.
 * @param config - Parsed `.lisa.config.json`
 * @returns A copy declaring the gate
 */
export function withTraceabilityGate<T extends GateConfig>(config: T): T {
  return {
    ...config,
    gates: {
      ...(config.gates ?? {}),
      [GATE_ID]: { [GATE_MOMENT]: GATE_LEVEL },
    },
  };
}

/**
 * Read the config file, or `null` when there is none.
 * @param configPath - Absolute path to `.lisa.config.json`
 * @returns File contents, or `null` when absent or unreadable
 */
async function readConfigText(configPath: string): Promise<string | null> {
  try {
    return await readFile(configPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Parse the config, reporting the failure rather than throwing.
 * @param raw - File contents
 * @returns The parsed config, or the parse error's message
 */
function parseConfig(
  raw: string
): { readonly config: GateConfig } | { readonly error: string } {
  try {
    return { config: JSON.parse(raw) as GateConfig };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Report — and repair — an undeclared traceability gate.
 * @param targetPath - Project path to inspect and repair
 * @returns The doctor check result
 */
export async function checkTraceabilityGate(
  targetPath: string
): Promise<DoctorCheck> {
  const configPath = path.join(targetPath, ".lisa.config.json");
  const raw = await readConfigText(configPath);
  if (raw === null) {
    // Not a Lisa project, or not one yet. Nothing to declare and nothing to
    // repair — reporting a gap here would fire on every unrelated directory.
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "no .lisa.config.json — nothing to declare",
    };
  }

  const parsed = parseConfig(raw);
  if ("error" in parsed) {
    return {
      name: CHECK_NAME,
      status: "warn",
      detail:
        `.lisa.config.json is not valid JSON, so the gate could not be ` +
        `checked: ${parsed.error}`,
    };
  }
  const config = parsed.config;

  if (declaresTraceability(config)) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `gates.${GATE_ID} is declared — left as the project set it. ${LAYER_TWO_NOTE}`,
    };
  }

  // Two-space indent and a trailing newline: the convention every Lisa-written
  // JSON in a host project uses, so the repair does not show up as a whole-file
  // reformat in the diff that carries it.
  await writeFile(
    configPath,
    `${JSON.stringify(withTraceabilityGate(config), null, 2)}\n`,
    "utf-8"
  );

  return {
    name: CHECK_NAME,
    status: "warn",
    detail:
      `gates.${GATE_ID} was undeclared, so a missing Work-Item trailer reddened ` +
      `the check and merged anyway — an undeclared gate emits no required ` +
      `status context. ADDED as {"${GATE_MOMENT}": "${GATE_LEVEL}"} — commit ` +
      `it. Declare it as "off" instead if this project is deliberately opting ` +
      `out; that decision is preserved. ${LAYER_TWO_NOTE}`,
  };
}
