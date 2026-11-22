/**
 * Configure leaves every check it declares with a pair of test changes that
 * works (CodySwannGT/lisa#5011).
 *
 * The attest step proves a check with two patch files, and nothing but the
 * configure step writes them. So this suite runs the configure skill's own
 * commands, exactly as written and in order, with the built CLI, on a
 * repository where Lisa was never applied. A stand-in does what only the
 * agent does: it declares the one check the audit found, and it makes each
 * test change in the scratch copy. The patch files themselves are written by
 * the skill's own git commands, so a command the skill teaches wrongly fails
 * here.
 *
 * Then the question that matters is asked of the result: does
 * `lisa controls attest` pass that check?
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ProofCheckRun } from "../../src/controls/proof-check-types.js";
import type { ProofRun } from "../../src/controls/proof-types.js";
import { foundAt, reportWith } from "../helpers/control-audit-findings.js";
import { writeAuditReport } from "../helpers/control-audit-report.js";
import {
  checks,
  F_NONE_SOURCE,
  FAILURE_TEXT,
  VIOLATION_MARK,
} from "../helpers/control-proofs.js";
import { configFile, type GatesBlock } from "../helpers/control-register.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { operatorEnv } from "../support/carrier-install.js";
import {
  CHANGED_BLOCK,
  CONFIG,
  REGISTER,
  configureRepository,
  useConfigureRepositories,
  writtenRegister,
} from "./support/configure-repositories.js";
import {
  PROOF_CHECK_BLOCK,
  REGISTER_BLOCK,
  configureStep,
  runConfigureSkillCommands,
  type ConfigureAgent,
} from "./support/configure-skill-run.js";

useIoLatencyBudget();

const lisaFolder = useConfigureRepositories();

const ENTRY = "code-style@.";
const VIOLATION_PATCH = ".lisa/controls/proofs/code-style.violation.patch";
const CLEAN_PATCH = ".lisa/controls/proofs/code-style.clean.patch";
const HARMLESS_LINE = "# a harmless change\n";

/** What the audit found in F-none: a style checker that nothing runs. */
const AUDIT = reportWith(["."], [foundAt("SI7", ".", "ruff.toml")]);

/**
 * The declaration an agent writes for the one check the audit found.
 * @param proof - The pair of test changes, once they are written
 * @returns The `gates` block
 */
function declaration(proof?: Readonly<Record<string, unknown>>): GatesBlock {
  return {
    "code-style": {
      commit: "required",
      criteria: ["SI7"],
      parts: [
        {
          scope: ".",
          command: checks(F_NONE_SOURCE),
          evidence: { locators: [{ path: "ruff.toml", line: 1 }] },
          ...(proof === undefined ? {} : { proof }),
        },
      ],
    },
  };
}

/**
 * A stand-in for the agent: it declares the check, makes the two test
 * changes in the scratch copy, and names the patch files the skill's
 * commands wrote.
 * @param repoPath - The repository being configured
 * @param violatingLine - The line its violating change adds
 * @returns The stand-in
 */
function agent(repoPath: string, violatingLine: string): ConfigureAgent {
  const write = (gates: GatesBlock): void => {
    writeFileSync(path.join(repoPath, CONFIG), configFile(gates));
  };
  const adds =
    (line: string) =>
    (scratchFolder: string): void => {
      appendFileSync(path.join(scratchFolder, F_NONE_SOURCE), line);
    };
  return () => ({
    declare: () => {
      write(declaration());
    },
    changes: [
      { file: VIOLATION_PATCH, edit: adds(violatingLine) },
      { file: CLEAN_PATCH, edit: adds(HARMLESS_LINE) },
    ],
    declareProofs: () => {
      write(
        declaration({
          violation: VIOLATION_PATCH,
          clean: CLEAN_PATCH,
          failure_shape: [FAILURE_TEXT],
        })
      );
    },
  });
}

/**
 * Configure F-none after its audit, with the stand-in agent.
 * @param violatingLine - The line the stand-in's violating change adds
 * @returns The repository and the steps that ran
 */
function configure(violatingLine = `${VIOLATION_MARK} = 1\n`): {
  readonly repoPath: string;
  readonly steps: ReturnType<typeof runConfigureSkillCommands>;
} {
  const repoPath = configureRepository("F-none");
  writeAuditReport(repoPath, AUDIT);
  return {
    repoPath,
    steps: runConfigureSkillCommands(
      repoPath,
      lisaFolder(),
      agent(repoPath, violatingLine)
    ),
  };
}

describe("configure on a repository with one discovered check", () => {
  it("leaves the check with a pair that proof-check calls ready and that attest then passes", () => {
    const { repoPath, steps } = configure();
    const checked = configureStep(steps, PROOF_CHECK_BLOCK);
    const attest = boundedSpawnSync({
      label: "lisa controls attest --json (after configure)",
      command: path.join(lisaFolder(), "lisa"),
      args: ["controls", "attest", "--json"],
      baseMs: 30_000,
      cwd: repoPath,
      env: { ...operatorEnv(), LISA_SKIP_UPDATE_CHECK: "1" },
    });

    expect(steps.filter(step => step.status !== 0)).toEqual([]);
    expect(checked.status).toBe(0);
    expect(
      (JSON.parse(checked.stdout) as ProofCheckRun).parts.map(part => [
        part.entry_id,
        part.result,
      ])
    ).toEqual([[ENTRY, "ready"]]);
    expect(writtenRegister(repoPath).entries[0]?.proof).toMatchObject({
      violation: VIOLATION_PATCH,
      clean: CLEAN_PATCH,
      failure_shape: [FAILURE_TEXT],
    });
    expect(
      (JSON.parse(attest.stdout) as ProofRun).entries.map(entry => [
        entry.entry_id,
        entry.outcome,
      ])
    ).toEqual([[ENTRY, "passed"]]);
    expect(attest.status).toBe(0);
  });

  it("writes each patch with the skill's own commands, and each holds only the stand-in's edit", () => {
    const { repoPath } = configure();
    const added = (file: string): readonly string[] =>
      readFileSync(path.join(repoPath, file), "utf8")
        .split("\n")
        .filter(line => line.startsWith("+") && !line.startsWith("+++"));

    expect(added(VIOLATION_PATCH)).toEqual([`+${VIOLATION_MARK} = 1`]);
    expect(added(CLEAN_PATCH)).toEqual([`+${HARMLESS_LINE.trimEnd()}`]);
  });

  it("changes nothing but the declaration, the two patch files and the register, and leaves no test change in a source file", () => {
    const { repoPath, steps } = configure();

    expect(
      configureStep(steps, CHANGED_BLOCK).stdout.trim().split("\n")
    ).toEqual([
      `?? ${CONFIG}`,
      "?? .lisa/audit/report.json",
      `?? ${CLEAN_PATCH}`,
      `?? ${VIOLATION_PATCH}`,
      `?? ${REGISTER}`,
    ]);
    expect(
      readFileSync(path.join(repoPath, F_NONE_SOURCE), "utf8")
    ).not.toMatch(new RegExp(`${VIOLATION_MARK}|a harmless change`, "u"));
  });

  it("stops before the register when the violating change is one the check does not catch", () => {
    const { repoPath, steps } = configure("# not a violation at all\n");
    const checked = configureStep(steps, PROOF_CHECK_BLOCK);

    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain(
      `proof-check: ${ENTRY} is not ready. The check passed on the violating change, so it does not catch it. Make the change break the rule the check enforces.`
    );
    expect(steps.at(-1)).toBe(checked);
    expect(steps.some(step => step.block.trim() === REGISTER_BLOCK)).toBe(
      false
    );
    expect(existsSync(path.join(repoPath, REGISTER))).toBe(false);
  });
});
