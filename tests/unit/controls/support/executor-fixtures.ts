/**
 * Declarations that name a pull-request executor, and the proof records that
 * clear the mark it leaves, for the suites that check what the control
 * register says about a pipeline file Lisa did not write
 * (CodySwannGT/lisa#4991).
 * @module tests/unit/controls/support/executor-fixtures
 */
import { loadCriterionCatalogue } from "../../../../src/controls/catalogue.js";
import type { ProofHalf } from "../../../../src/controls/proof-halves.js";
import {
  buildControlRegister,
  type ControlRegisterBuild,
} from "../../../../src/controls/register.js";
import type {
  ControlRegister,
  PullRequestExecutor,
} from "../../../../src/controls/register-types.js";
import {
  declarationOf,
  shippedGates,
  type GatesBlock,
} from "../../../helpers/control-register.js";

/** The moment an executor is declared at. */
const PULL_REQUEST = "pull-request";

/** A pipeline file on a platform Lisa ships nothing for. */
export const PIPELINE: PullRequestExecutor = {
  platform: "gitlab",
  path: ".gitlab-ci.yml",
};

/** A workflow on the one platform Lisa ships the file for. */
export const LISA_WRITTEN: PullRequestExecutor = {
  platform: "github",
  path: ".github/workflows/ci.yml",
};

/**
 * One gate's pull-request entry with an executor added.
 * @param gate - The gate as declared
 * @param executor - The executor to name
 * @returns The gate, unchanged when it is not declared at pull-request
 */
function gateWithExecutor(gate: unknown, executor: unknown): unknown {
  if (gate === null || typeof gate !== "object" || !(PULL_REQUEST in gate)) {
    return gate;
  }
  const declared = (gate as Readonly<Record<string, unknown>>)[PULL_REQUEST];
  const entry =
    typeof declared === "string"
      ? { level: declared }
      : (declared as Readonly<Record<string, unknown>>);
  return { ...gate, [PULL_REQUEST]: { ...entry, executor } };
}

/**
 * Name one executor on every gate a declaration checks at pull-request.
 * @param block - The `gates` block
 * @param executor - The executor to name
 * @returns The block with the executor on each pull-request entry
 */
export function withExecutor(
  block: GatesBlock,
  executor: unknown = PIPELINE
): GatesBlock {
  return Object.fromEntries(
    Object.entries(block).map(([id, gate]) => [
      id,
      gateWithExecutor(gate, executor),
    ])
  );
}

/**
 * An evidence record for one half of one entry's proof that held, carrying
 * the keys the register reads it by.
 * @param entryId - The register entry the proof is of
 * @param half - Which half
 * @param extra - Further keys, or replacements for the ones written here
 * @returns The record
 */
export function proofRecord(
  entryId: string,
  half: ProofHalf,
  extra: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    id: `ev-${entryId}-${half}`,
    criterion: "SI7",
    entry_id: entryId,
    half,
    result: "held",
    completed_at: "2026-11-17T12:00:00.000Z",
    freshness_seconds: 3600,
    ...extra,
  };
}

/**
 * Both halves of one entry's proof.
 * @param entryId - The register entry the proof is of
 * @param extra - Further keys for both records
 * @returns The two records, the violating half first
 */
export function bothHalves(
  entryId: string,
  extra: Readonly<Record<string, unknown>> = {}
): readonly Readonly<Record<string, unknown>>[] {
  return [
    proofRecord(entryId, "violation", extra),
    proofRecord(entryId, "clean", extra),
  ];
}

/**
 * Build the register of a declaration with the given evidence on record.
 * @param block - The `gates` block
 * @returns The register, or the problems it was refused for
 */
export async function buildExecutorRegister(
  block: GatesBlock
): Promise<ControlRegisterBuild> {
  return buildControlRegister({
    declaration: declarationOf(block),
    registry: await shippedGates(),
    catalogue: loadCriterionCatalogue(),
  });
}

/**
 * Build the register of a declaration, failing the case when it is refused.
 * @param block - The `gates` block
 * @returns The register
 */
export async function registerForGates(
  block: GatesBlock
): Promise<ControlRegister> {
  const built = await buildExecutorRegister(block);
  if (built.problems !== null) throw new Error(built.problems.join("\n"));
  return built.register;
}

/**
 * The entries of a register that read unproved.
 * @param register - The register
 * @returns Their identifiers, in register order
 */
export function unprovedIds(register: ControlRegister): readonly string[] {
  return register.entries
    .filter(entry => entry.status === "unproved")
    .map(entry => entry.id);
}
