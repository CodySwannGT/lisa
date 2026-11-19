/**
 * The gate runner's own parts, as the paired-proof runner uses them.
 *
 * A proof is only worth something if it starts a check the way the gate does
 * and reads the answer the way the gate does. Neither is restated here. This
 * module imports the gate runner script Lisa ships
 * (`all/copy-overwrite/scripts/lisa-run-gates.mjs`) from the running Lisa
 * package, the same way the gate registry is imported, and calls it:
 *
 * - `spawnArgv` starts an argument list with no shell, under the process
 *   supervisor, with a time limit that takes the whole process tree with it.
 * - `partDirectory` resolves an entry's folder inside the workspace and
 *   refuses one that leads out of it.
 * - `judgePart` reads an answer by the rules every gate is read by: exit 0
 *   from a run that says it ran nothing is not a pass, and a kill is not a
 *   failure.
 * - `declaredFailure`, from the runner's diagnosis module, is what decides
 *   whether output carries a declared failure text.
 *
 * So a proof and a gate can never disagree about what an answer means.
 * @module controls/proof-tools
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveGateRegistryPath } from "../cli/gate-registry-source.js";
import type { ProofAnswer, ProofJudgement } from "./proof-types.js";

/** The gate runner script, beside the gate registry in the Lisa package. */
const GATE_RUNNER_FILE = "lisa-run-gates.mjs";

/** The runner's diagnosis module, from the folder the runner is in. */
const DIAGNOSIS_FILE = path.join("lib", "gate-failure-diagnosis.mjs");

/** What a started command answered, before it is known what was started. */
type StartedAnswer = Omit<ProofAnswer, "command" | "cwd">;

/** The folder a command starts in, or why there is none. */
type StartFolder =
  | { readonly directory: string }
  | { readonly problem: string };

/** The failure text an entry declares, and the gate it belongs to. */
interface DeclaredShape {
  readonly gate: string;
  /** The declared failure text; empty when the entry declares none. */
  readonly shape: readonly string[];
}

/** Reads an answer the way the gate runner does. */
export type ProofJudge = (
  answer: ProofAnswer,
  declared: DeclaredShape
) => ProofJudgement;

/** What the paired-proof runner takes from the gate runner. */
export interface ProofTools {
  /**
   * Start an argument list in a folder, with no shell, showing nothing while
   * it runs, and stop it at its time limit.
   */
  readonly start: (
    argv: readonly string[],
    options: { readonly cwd: string; readonly timeoutMs: number }
  ) => StartedAnswer;
  /** Resolve an entry's folder inside a root, refusing one that leads out. */
  readonly folder: (root: string, scope: string) => StartFolder;
  readonly judge: ProofJudge;
}

/** The slice of the shipped gate runner this module calls. */
interface GateRunnerModule {
  readonly STATE: {
    readonly PASSED: string;
    readonly FAILED: string;
    readonly KILLED: string;
  };
  readonly spawnArgv: (
    argv: readonly string[],
    options: {
      readonly cwd: string;
      readonly timeoutMs: number;
      readonly quiet: boolean;
    }
  ) => StartedAnswer;
  readonly partDirectory: (root: string, scope: string) => StartFolder;
  readonly judgePart: (
    argv: readonly string[],
    answer: StartedAnswer,
    declarations: readonly DeclaredShape[],
    cwd: string
  ) => { readonly state: string };
}

/** The slice of the runner's diagnosis module this module calls. */
interface DiagnosisModule {
  readonly declaredFailure: (
    output: string | null,
    declarations: readonly DeclaredShape[]
  ) => { readonly evidence?: readonly string[] } | null;
}

/**
 * Build the judge from the shipped runner and its diagnosis module.
 * @param runner - The gate runner
 * @param diagnosis - Its diagnosis module
 * @returns The judge
 */
function judgeWith(
  runner: GateRunnerModule,
  diagnosis: DiagnosisModule
): ProofJudge {
  const verdicts: Readonly<Record<string, ProofJudgement["verdict"]>> = {
    [runner.STATE.PASSED]: "passed",
    [runner.STATE.FAILED]: "failed",
    [runner.STATE.KILLED]: "killed",
  };
  return (answer, declared) => {
    const declarations = declared.shape.length > 0 ? [declared] : [];
    const { command, cwd, ...raw } = answer;
    const { state } = runner.judgePart(command, raw, declarations, cwd);
    const match = diagnosis.declaredFailure(answer.output, declarations);
    return {
      verdict: verdicts[state] ?? "not-measured",
      declared: match !== null,
      matched: [...(match?.evidence ?? [])],
    };
  };
}

/**
 * Import the gate runner from the running Lisa package.
 * @returns What the paired-proof runner takes from it
 * @throws {Error} When this copy of Lisa does not hold the script
 */
export async function loadProofTools(): Promise<ProofTools> {
  const registry = resolveGateRegistryPath();
  if (registry === null) {
    throw new Error(
      "The gate runner is missing from this copy of Lisa (expected all/copy-overwrite/scripts/lisa-run-gates.mjs). Reinstall Lisa."
    );
  }
  const scripts = path.dirname(registry);
  const [runner, diagnosis] = (await Promise.all([
    import(pathToFileURL(path.join(scripts, GATE_RUNNER_FILE)).href),
    import(pathToFileURL(path.join(scripts, DIAGNOSIS_FILE)).href),
  ])) as [GateRunnerModule, DiagnosisModule];
  return {
    start: (argv, { cwd, timeoutMs }) =>
      runner.spawnArgv([...argv], { cwd, timeoutMs, quiet: true }),
    folder: (root, scope) => runner.partDirectory(root, scope),
    judge: judgeWith(runner, diagnosis),
  };
}
