/**
 * Running `lisa controls attest --before-enforce` in-process against fixture
 * repositories (CodySwannGT/lisa#5001).
 *
 * The suites about the before-enforce run all need the same things: a
 * fixture with a check declared and its proof patches committed, a run of
 * the command with what it printed, and the result it printed as data. They
 * are written once here.
 * @module tests/unit/controls/support/before-enforce-run
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  runAttestBeforeEnforce,
  type BeforeEnforceDependencies,
  type BeforeEnforceOptions,
} from "../../../../src/controls/commands/attest-before-enforce.js";
import type {
  BeforeEnforceEntry,
  BeforeEnforceRun,
} from "../../../../src/controls/before-enforce-types.js";
import { buildProofCopy } from "../../../../src/controls/proof-copy.js";
import {
  buildProofFixture,
  type ProofFiles,
} from "../../../helpers/control-proofs.js";
import type { GatesBlock } from "../../../helpers/control-register.js";
import { steppingClock } from "./proof-run.js";
import { keep, type Run } from "./report-check-run.js";

/** What one run printed, and the result it printed when it printed one. */
export interface BeforeEnforceRunResult extends Run {
  /** The JSON document on stdout, or `null` when there is none. */
  readonly result: BeforeEnforceRun | null;
}

/**
 * Build F-none with the given checks declared and committed, and remember it
 * for removal.
 * @param gates - The gates block
 * @param files - The proof files; a working pair by default
 * @returns The repository's path
 */
export function declared(gates: GatesBlock, files?: ProofFiles): string {
  return keep(buildProofFixture(gates, files)).repoPath;
}

/**
 * Run the command in-process, as JSON, and capture what it prints.
 * @param target - The repository
 * @param options - The command's options
 * @param dependencies - Replaceable collaborators
 * @returns Exit code, printed lines, and the result as data
 */
export async function beforeEnforce(
  target: string | undefined,
  options: BeforeEnforceOptions = {},
  dependencies: BeforeEnforceDependencies = {}
): Promise<BeforeEnforceRunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runAttestBeforeEnforce(
    target,
    { json: true, ...options },
    {
      clock: steppingClock(),
      stdout: line => {
        stdout.push(line);
      },
      stderr: line => {
        stderr.push(line);
      },
      ...dependencies,
    }
  );
  const [document] = stdout;
  return {
    code,
    stdout,
    stderr,
    result:
      options.json !== false && document !== undefined
        ? (JSON.parse(document) as BeforeEnforceRun)
        : null,
  };
}

/**
 * The only entry of a result.
 * @param run - What the command printed
 * @returns The entry
 * @throws {Error} When there is not exactly one, so a case can never pass on
 *   an entry it did not mean
 */
export function onlyEntry(run: BeforeEnforceRunResult): BeforeEnforceEntry {
  const entries = run.result?.entries ?? [];
  const [entry] = entries;
  if (entries.length !== 1 || entry === undefined) {
    throw new Error(
      `Expected one entry, found ${String(entries.length)}. stderr: ${run.stderr.join(" | ")}`
    );
  }
  return entry;
}

/**
 * A way of building the fresh clone that then puts a hook file in it, the
 * way a repository whose clone really did carry a hook would have one.
 * @param hook - The hook's file name, such as `pre-commit`
 * @param script - The hook's content
 * @returns The builder
 */
export function cloneWithHook(
  hook: string,
  script: string
): typeof buildProofCopy {
  return async (root, folder, dependencies) => {
    const built = await buildProofCopy(root, folder, dependencies);
    if (built.problem === null) {
      const hooks = path.join(built.copy.clone, ".git", "hooks");
      mkdirSync(hooks, { recursive: true });
      writeFileSync(path.join(hooks, hook), script);
      chmodSync(path.join(hooks, hook), 0o755);
    }
    return built;
  };
}
