/**
 * Ensure a project actually declares the Work-Item Traceability gate.
 *
 * Every upstream layer already sanctions it — the gate registry declares it at
 * `pull-request`, the TypeScript ruleset template names the context as
 * required, and the promotion ledger grandfathers it. Lisa's own repository
 * enforces it. Measured 2026-08-18, **no consumer did**: `traceability` was
 * absent from all five projects' `.lisa.config.json`, so the job never ran at
 * all — not a red-but-non-blocking signal an operator might notice, no signal.
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
      detail: `gates.${GATE_ID} is declared — left as the project set it`,
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
      `gates.${GATE_ID} was undeclared, so the job never ran and a missing ` +
      `Work-Item trailer could not be caught. ADDED as ` +
      `{"${GATE_MOMENT}": "${GATE_LEVEL}"} — commit it. Note this makes the ` +
      `job run and fail; whether a failure BLOCKS a merge is a separate ` +
      `layer, and if "🔍 Quality Checks / 🔗 Work-Item Traceability" is not a ` +
      `required status context on the default branch, apply the ruleset with ` +
      `scripts/lisa-github-rulesets.sh. Declare it as "off" instead if this ` +
      `project is deliberately opting out — that decision is preserved.`,
  };
}
