/**
 * Running paired proofs in-process against fixture repositories, with the
 * gate runner Lisa ships and a real disposable copy to plant changes in
 * (CodySwannGT/lisa#4995).
 * @module tests/unit/controls/support/proof-run
 */
import { runPairedProofs } from "../../../../src/controls/proof-runner.js";
import { loadProofTools } from "../../../../src/controls/proof-tools.js";
import type {
  ProofEntryResult,
  ProofRun,
} from "../../../../src/controls/proof-types.js";
import { directProofWorkspace } from "../../../../src/controls/proof-workspace.js";
import { generateControlRegister } from "../../../../src/controls/register.js";
import type { ControlAuditFixtureName } from "../../../helpers/control-audit-fixtures.js";
import {
  buildProofFixture,
  type ProofFiles,
  workspaceCopy,
} from "../../../helpers/control-proofs.js";
import type { GatesBlock } from "../../../helpers/control-register.js";
import { keep } from "./report-check-run.js";

const copies: (() => void)[] = [];

/**
 * A clock that starts at a fixed moment and moves one second each time it is
 * read, so every time in a result is known in advance.
 * @param start - The first reading
 * @returns The clock
 */
export function steppingClock(start = "2026-01-01T00:00:00.000Z"): () => Date {
  const state = { reads: 0 };
  return () => {
    const now = new Date(Date.parse(start) + state.reads * 1000);
    state.reads += 1;
    return now;
  };
}

/** Remove every workspace copy a case made. Call from `afterEach`. */
export function removeCopies(): void {
  copies.splice(0).forEach(cleanup => {
    cleanup();
  });
}

/** A fixture repository with a disposable copy of it beside it. */
export interface ProofSetting {
  /** The repository the register and the patch files are read from. */
  readonly repoPath: string;
  /** The disposable copy the changes are planted in. */
  readonly workspace: string;
}

/** How a setting may differ from F-none with a working pair of patches. */
export interface ProofSettingOptions {
  readonly files?: ProofFiles;
  readonly fixture?: ControlAuditFixtureName;
  /** Whether the copy keeps the repository's `.git`. */
  readonly withGit?: boolean;
}

/**
 * Build a fixture with a gates declaration and its proof files, and a
 * disposable copy of it. Both are removed after the case.
 * @param gates - The gates block
 * @param options - How the setting differs from the default
 * @returns The repository and its copy
 */
export function setting(
  gates: GatesBlock,
  options: ProofSettingOptions = {}
): ProofSetting {
  const { repoPath } = keep(
    buildProofFixture(gates, options.files, options.fixture)
  );
  const copy = workspaceCopy(repoPath, options.withGit);
  copies.push(copy.cleanup);
  return { repoPath, workspace: copy.directory };
}

/**
 * Run every proof the declaration of a setting calls for.
 * @param where - The repository and its copy
 * @param options - What the run is given beyond them
 * @param options.acknowledgeExternalEffects - Allow proofs that reach outside
 * @param options.clock - The clock; one that steps a second per reading by
 *   default
 * @returns The results
 */
export async function prove(
  where: ProofSetting,
  options: {
    readonly acknowledgeExternalEffects?: boolean;
    readonly clock?: () => Date;
  } = {}
): Promise<ProofRun> {
  const generated = await generateControlRegister(where.repoPath);
  if (generated.problems !== null) {
    throw new Error(generated.problems.join("\n"));
  }
  const tools = await loadProofTools();
  return runPairedProofs({
    register: generated.register,
    root: where.repoPath,
    workspace: directProofWorkspace(where.workspace, tools),
    judge: tools.judge,
    clock: options.clock ?? steppingClock(),
    ...(options.acknowledgeExternalEffects === undefined
      ? {}
      : { acknowledgeExternalEffects: options.acknowledgeExternalEffects }),
  });
}

/**
 * Build a setting and run its proofs.
 * @param gates - The gates block
 * @param options - How the setting differs from the default
 * @returns The results, and where they were run
 */
export async function proved(
  gates: GatesBlock,
  options: ProofSettingOptions = {}
): Promise<ProofRun & { readonly where: ProofSetting }> {
  const where = setting(gates, options);
  return { ...(await prove(where)), where };
}

/**
 * The one entry of a run that has exactly one.
 * @param run - The results
 * @returns The entry
 */
export function only(run: ProofRun): ProofEntryResult {
  const [entry, ...others] = run.entries;
  if (entry === undefined || others.length > 0) {
    throw new Error(`expected one entry, got ${run.entries.length}`);
  }
  return entry;
}
