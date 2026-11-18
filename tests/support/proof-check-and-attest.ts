/**
 * Asking the built `lisa controls proof-check` and `lisa controls attest`
 * about the same repository, so a suite can hold what the two say to each
 * other.
 *
 * `proof-check` exists so that whoever writes a pair of test changes finds
 * out, before anything is installed, whether the attest step will be able to
 * use it. That is only worth something while the two agree, and a rule both
 * are meant to share is only shared if both built commands apply it.
 * @module tests/support/proof-check-and-attest
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ProofCheckRun } from "../../src/controls/proof-check-types.js";
import type { ProofRun } from "../../src/controls/proof-types.js";
import {
  VERDICT_PATH,
  type Verdict,
} from "../../src/controls/verdict-types.js";
import type { ControlAuditFixtureName } from "../helpers/control-audit-fixtures.js";
import {
  buildProofFixture,
  type ProofFiles,
} from "../helpers/control-proofs.js";
import type { GatesBlock } from "../helpers/control-register.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { operatorEnv } from "./carrier-install.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");

const cleanups: (() => void)[] = [];

/** What one check came to in each command. */
export interface HeldPart {
  /** What `proof-check` called its pair. */
  readonly checked: string;
  /** Why `proof-check` called it that. */
  readonly checkedBecause: string;
  /** The sentence `proof-check` gave. */
  readonly checkedDetail: string;
  /** What `attest` made of its proof. */
  readonly attested: string;
  /** Why `attest` gave its proof that result. */
  readonly attestedBecause: string;
  /** The sentence `attest` gave. */
  readonly attestedDetail: string;
}

/** What the two commands said about one repository. */
export interface Held {
  /** `proof-check`'s exit code. */
  readonly checkCode: number | null;
  /** `attest`'s exit code. */
  readonly attestCode: number | null;
  /** Per register entry, what each command said. */
  readonly parts: Readonly<Record<string, HeldPart>>;
  /**
   * What the verdict `attest` wrote says of each requirement, by its id.
   */
  readonly requirements: Readonly<Record<string, string>>;
}

/**
 * Run one built `lisa controls` command in a repository.
 * @param repoPath - The repository
 * @param args - The arguments after `lisa controls`
 * @param tmp - The temporary folder the command is given
 * @returns Its exit code and standard output
 */
function controls(
  repoPath: string,
  args: readonly string[],
  tmp: string
): { readonly status: number | null; readonly stdout: string } {
  const child = boundedSpawnSync({
    label: `lisa controls ${args.join(" ")} (built CLI)`,
    command: process.execPath,
    args: [DIST_CLI, "controls", ...args],
    baseMs: 30_000,
    cwd: repoPath,
    env: { ...operatorEnv(), LISA_SKIP_UPDATE_CHECK: "1", TMPDIR: tmp },
  });
  return { status: child.status, stdout: child.stdout };
}

/**
 * Build a repository with checks declared and files committed in it, and an
 * empty temporary folder for the commands. Both are removed by
 * {@link removeHeld}.
 * @param gates - The gates block
 * @param files - The patch files, and any other file to commit
 * @param name - Which fixture
 * @returns The repository and the temporary folder
 */
function setting(
  gates: GatesBlock,
  files: ProofFiles,
  name: ControlAuditFixtureName
): { readonly repoPath: string; readonly tmp: string } {
  const built = buildProofFixture(gates, files, name);
  const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-held-")));
  cleanups.push(built.cleanup, () =>
    rmSync(tmp, { force: true, maxRetries: 10, recursive: true })
  );
  return { repoPath: built.repoPath, tmp };
}

/**
 * Build a repository with checks declared and files committed in it, then
 * ask `proof-check` and `attest` about it. The repository and the temporary
 * folder the commands were given are removed by {@link removeHeld}.
 * @param gates - The gates block
 * @param files - The patch files, and any other file to commit
 * @param name - Which fixture
 * @returns What each command said
 */
export function heldTogether(
  gates: GatesBlock,
  files: ProofFiles,
  name: ControlAuditFixtureName = "F-none"
): Held {
  const { repoPath, tmp } = setting(gates, files, name);
  const check = controls(repoPath, ["proof-check"], tmp);
  const attest = controls(repoPath, ["attest", "--json"], tmp);
  const checked = JSON.parse(check.stdout) as ProofCheckRun;
  const attested = JSON.parse(attest.stdout) as ProofRun;
  const verdict = JSON.parse(
    readFileSync(path.join(repoPath, VERDICT_PATH), "utf8")
  ) as Verdict;
  return {
    checkCode: check.status,
    attestCode: attest.status,
    parts: Object.fromEntries(
      checked.parts.map(part => {
        const entry = attested.entries.find(
          each => each.entry_id === part.entry_id
        );
        return [
          part.entry_id,
          {
            checked: part.result,
            checkedBecause: part.reason,
            checkedDetail: part.detail,
            attested: entry?.outcome ?? "",
            attestedBecause: entry?.reason ?? "",
            attestedDetail: entry?.detail ?? "",
          },
        ];
      })
    ),
    requirements: Object.fromEntries(
      verdict.criteria.map(each => [each.criterion, each.verdict])
    ),
  };
}

/** Remove every repository and temporary folder a case made. */
export function removeHeld(): void {
  cleanups.splice(0).forEach(cleanup => {
    cleanup();
  });
}
