/**
 * A fixture repository with one declared check that a file's content can
 * make pass or fail, for the suites about the enforce report
 * (CodySwannGT/lisa#4994).
 *
 * The check is a small program committed with the fixture, so it runs on any
 * machine: it fails, printing what a linter would, when
 * {@link LINTED_FILE} holds the word `violation`.
 * @module tests/unit/controls/support/enforce-repository
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { generateControlRegister } from "../../../../src/controls/register.js";
import type { ControlRegister } from "../../../../src/controls/register-types.js";
import {
  buildControlAuditFixture,
  runControlAuditGit,
  type ControlAuditFixture,
} from "../../../helpers/control-audit-fixtures.js";
import {
  configFile,
  evidenceAt,
  type GatesBlock,
} from "../../../helpers/control-register.js";

/** The file the fixture's check reads. */
export const LINTED_FILE = "src/fixture_none/linted.txt";

/** The fixture's check, from the repository root. */
export const LINT_PROGRAM = "tools/lint.mjs";

/** What the check prints when it finds the rule broken. */
export const LINT_FAILURE = "Found 1 error";

/** Content that breaks the rule. */
export const VIOLATION = "a violation of the house style\n";

/** Content that does not. */
export const CLEAN = "nothing wrong here\n";

/** The command the fixture declares, as the register records it. */
export const LINT_COMMAND = ["node", LINT_PROGRAM] as const;

const LINT_SOURCE = `import { readFileSync } from "node:fs";
const text = readFileSync(${JSON.stringify(LINTED_FILE)}, "utf8");
if (text.includes("violation")) {
  console.log(${JSON.stringify(`${LINTED_FILE}:1: house style broken`)});
  console.log(${JSON.stringify(LINT_FAILURE)});
  process.exit(1);
}
console.log("All checks passed");
`;

/**
 * The declaration of the fixture's one check.
 * @param gate - More keys for the gate, replacing the ones given here
 * @param part - More keys for its one part
 * @returns The `gates` block
 */
export function lintGates(
  gate: Readonly<Record<string, unknown>> = {},
  part: Readonly<Record<string, unknown>> = {}
): GatesBlock {
  return {
    "code-style": {
      commit: "required",
      criteria: ["SI7"],
      parts: [
        {
          scope: ".",
          command: LINT_COMMAND,
          evidence: evidenceAt("ruff.toml"),
          ...part,
        },
      ],
      ...gate,
    },
  };
}

/**
 * Build F-none with the check committed, on a default branch whose last
 * commit either breaks the rule or does not.
 * @param linted - What the checked file holds in that commit
 * @param gates - The declaration committed with it
 * @returns The repository
 */
export function buildLintedRepository(
  linted: string,
  gates: GatesBlock = lintGates()
): ControlAuditFixture {
  return buildControlAuditFixture("F-none", {
    extraFiles: {
      ".lisa.config.json": configFile(gates),
      [LINTED_FILE]: linted,
      [LINT_PROGRAM]: LINT_SOURCE,
    },
  });
}

/**
 * Generate the register of a fixture.
 * @param repoPath - The repository
 * @returns The register its declaration generates
 * @throws {Error} When the declaration is refused
 */
export async function registerOfRepository(
  repoPath: string
): Promise<ControlRegister> {
  const generated = await generateControlRegister(repoPath);
  if (generated.problems !== null) {
    throw new Error(generated.problems.join("\n"));
  }
  return generated.register;
}

/**
 * Change the checked file in the working copy without committing.
 * @param repoPath - The repository
 * @param linted - What the file holds now
 */
export function editLintedFile(repoPath: string, linted: string): void {
  writeFileSync(path.join(repoPath, LINTED_FILE), linted);
}

/**
 * Commit the checked file's content on a new branch and stay on it.
 * @param repoPath - The repository
 * @param branch - The branch to create
 * @param linted - What the file holds on that branch
 */
export function commitOnBranch(
  repoPath: string,
  branch: string,
  linted: string
): void {
  runControlAuditGit(repoPath, ["checkout", "--quiet", "-b", branch]);
  editLintedFile(repoPath, linted);
  runControlAuditGit(repoPath, ["commit", "--quiet", "-am", "change"]);
}

/**
 * Make a folder for one case's temporary files, outside every repository.
 * @returns The folder, and a function that removes it
 */
export function scratchFolder(): {
  readonly folder: string;
  readonly remove: () => void;
} {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-enforce-test-"));
  return {
    folder,
    remove: () => {
      rmSync(folder, { force: true, recursive: true });
    },
  };
}
