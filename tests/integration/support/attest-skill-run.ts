/**
 * Running the attest skill's own commands against a fixture repository.
 *
 * Attesting is carried out by an agent, and a suite cannot hold a model.
 * What it can do is everything else: run each shell block of the skill,
 * exactly as the skill writes it and in the skill's order, with a stand-in
 * doing the few things only the agent does. The stand-in follows the skill
 * to the letter:
 *
 * - it passes an option that reaches outside the repository only when the
 *   operator said yes to it;
 * - it stops where the skill says stop;
 * - when the check of the verdict does not pass, it runs the proofs again
 *   once and the check again, as the skill says, and gives up after that;
 * - it reads the verdict file only after a check that exited 0, and what it
 *   read then is the only verdict it "presents";
 * - in a before-enforce run it puts the offered findings into the audit
 *   report the way the skill describes, then lets the skill's own check
 *   judge the report.
 *
 * Nothing here copies a command out of the skill. The blocks are read from
 * the shipped document, so a command the skill gains is run by every case
 * that uses this module, and one it loses stops being run
 * (CodySwannGT/lisa#5001).
 * @module tests/integration/support/attest-skill-run
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  AuditFinding,
  AuditMechanism,
} from "../../../src/controls/audit-report-types.js";
import { AUDIT_REPORT_JSON_PATH } from "../../../src/controls/audit-report-types.js";
import type { BeforeEnforceRun } from "../../../src/controls/before-enforce-types.js";
import {
  VERDICT_PATH,
  type Verdict,
} from "../../../src/controls/verdict-types.js";
import {
  attestSkillShellBlocks,
  attestSkillSteps,
} from "../../helpers/attest-skill.js";
import { fencedBlocks } from "../../helpers/audit-skill.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { operatorEnv } from "../../support/carrier-install.js";
import { GIT_BIN } from "../../support/git-executable.js";
import type { SkillStep } from "./audit-skill-run.js";

const BASH = "/bin/bash";

/**
 * How long one block may take before the case gives up on it. It stays under
 * half of a case's own budget, so a block that hangs is reported by name and
 * not as a bare case timeout.
 */
const BLOCK_BUDGET_MS = 25_000;

/** The block that runs the proofs. */
export const PROOFS_BLOCK = "lisa controls attest --json";

/** The block that compares the register with what is installed. */
export const RECONCILE_BLOCK = "lisa controls reconcile";

/** The block that checks the verdict. */
export const CHECK_BLOCK = "lisa controls attest --check";

/** The block that looks for checks nothing enforces yet. */
export const BEFORE_ENFORCE_BLOCK =
  "lisa controls attest --before-enforce --json";

/** The block that has the audit report checked. */
export const REPORT_CHECK_BLOCK = "lisa controls report-check";

/** The block that lists what changed. */
export const CHANGED_BLOCK = "git status --porcelain --untracked-files=all";

/** The exit code that means nothing ran. */
const NOTHING_RAN = 2;

/** The options that reach outside the repository. */
const OPT_INS = ["--pull-request-canaries", "--acknowledge-external-effects"];

/** What stands in for the operator and for the world around a run. */
export interface AttestStandIn {
  /** The outside-reaching options the operator said yes to. None by default. */
  readonly agreedTo?: readonly string[];
  /**
   * Called after every run of the proofs, before anything else: where a case
   * edits a result file by hand, as someone tampering with it would.
   */
  readonly afterProofs?: () => void;
}

/** What an attest run of the skill came to. */
export interface AttestSkillRunResult {
  /** Every block that ran, in order, with what it printed. */
  readonly steps: readonly SkillStep[];
  /**
   * The verdict the stand-in read from the verdict file after a check that
   * exited 0; `null` when no check passed, so no verdict is presented.
   */
  readonly presented: Verdict | null;
}

/**
 * Run one shell block from the repository root.
 * @param repoPath - The repository
 * @param lisaFolder - A folder holding the `lisa` command
 * @param block - The block, exactly as the skill writes it
 * @returns The block with what it printed and how it exited
 */
function runBlock(
  repoPath: string,
  lisaFolder: string,
  block: string
): SkillStep {
  // The update check is deliberately not switched off here: a command that
  // ran it would leave a file in the repository, and a case that compares
  // git status has to be able to see that.
  const { LISA_SKIP_UPDATE_CHECK: _switchedOff, ...inherited } = operatorEnv();
  const child = boundedSpawnSync({
    label: `attest skill step: ${block}`,
    command: BASH,
    args: ["-c", block],
    baseMs: BLOCK_BUDGET_MS,
    cwd: repoPath,
    env: {
      ...inherited,
      // Node is on the PATH because the commit and push hooks the proofs
      // install in their temporary copy are started by git and look for it.
      PATH: [
        lisaFolder,
        path.dirname(process.execPath),
        path.dirname(GIT_BIN),
        "/usr/bin",
        "/bin",
      ].join(":"),
      TMPDIR: tmpdir(),
    },
  });
  return {
    block,
    status: child.status,
    stdout: child.stdout,
    stderr: child.stderr,
  };
}

/**
 * Find the step that ran a given command.
 * @param steps - The steps of one run
 * @param command - The block
 * @param occurrence - Which run of it, counted from 0; the last by default
 * @returns The step
 * @throws {Error} When the run has no such step, so a case can never pass by
 *   not running the command it is about
 */
export function attestStep(
  steps: readonly SkillStep[],
  command: string,
  occurrence = -1
): SkillStep {
  const found = steps
    .filter(step => step.block.trim() === command)
    .at(occurrence);
  if (found === undefined) {
    throw new Error(
      `The attest run has no step running "${command}". Steps: ${steps
        .map(step => step.block.trim())
        .join(" | ")}`
    );
  }
  return found;
}

/** What an attest run has gathered so far. */
interface RunState extends AttestSkillRunResult {
  /** Whether the run is over: the skill said stop. */
  readonly stopped: boolean;
}

/**
 * Run the proofs, then let whatever tampers with their results do so.
 * @param run - Runs one block
 * @param block - The block that runs the proofs, as the skill writes it
 * @param standIn - What tampers after the proofs, if anything
 * @returns The block that ran
 */
function proved(
  run: (block: string) => SkillStep,
  block: string,
  standIn: AttestStandIn
): SkillStep {
  const ran = run(block);
  standIn.afterProofs?.();
  return ran;
}

/**
 * Run the check of the verdict the way the skill says to: once, and when it
 * does not pass, the proofs again and the check again, once.
 * @param run - Runs one block
 * @param standIn - What tampers between the proofs and the check, if anything
 * @returns The blocks that ran, and whether a check passed
 */
function checked(
  run: (block: string) => SkillStep,
  standIn: AttestStandIn
): { readonly steps: readonly SkillStep[]; readonly passed: boolean } {
  const first = run(CHECK_BLOCK);
  if (first.status === 0) return { steps: [first], passed: true };
  if (first.status === NOTHING_RAN) return { steps: [first], passed: false };
  const again = proved(run, PROOFS_BLOCK, standIn);
  const second = run(CHECK_BLOCK);
  return { steps: [first, again, second], passed: second.status === 0 };
}

/**
 * Run every shell block of the skill's attest run, in order, from a
 * repository root.
 * @param repoPath - The repository
 * @param lisaFolder - A folder holding the `lisa` command
 * @param standIn - The operator's answers, and anything that tampers
 * @returns Every block that ran, and the verdict that was presented
 */
export function runAttestSkill(
  repoPath: string,
  lisaFolder: string,
  standIn: AttestStandIn = {}
): AttestSkillRunResult {
  const run = (block: string): SkillStep =>
    runBlock(repoPath, lisaFolder, block);
  const { steps, presented } = attestSkillShellBlocks(
    "attest"
  ).reduce<RunState>(
    (state, block) => {
      const command = block.trim();
      const asked = OPT_INS.filter(option => command.includes(option));
      const declined = asked.some(
        option => !(standIn.agreedTo ?? []).includes(option)
      );
      if (state.stopped || declined) return state;
      if (command === CHECK_BLOCK) {
        const check = checked(run, standIn);
        return {
          steps: [...state.steps, ...check.steps],
          // Read here and nowhere else: after a check that exited 0.
          presented: check.passed
            ? (JSON.parse(
                readFileSync(path.join(repoPath, VERDICT_PATH), "utf8")
              ) as Verdict)
            : null,
          stopped: !check.passed,
        };
      }
      const proofs = command.startsWith(PROOFS_BLOCK);
      const ran = proofs ? proved(run, block, standIn) : run(block);
      return {
        ...state,
        steps: [...state.steps, ran],
        stopped: proofs && ran.status === NOTHING_RAN,
      };
    },
    { steps: [], presented: null, stopped: false }
  );
  return { steps, presented };
}

/**
 * Put offered findings into an audit report the way the skill describes:
 * replace the finding at the same requirement and place, and keep after it
 * any mechanism the replaced finding listed that the offered one does not.
 * @param repoPath - The repository
 * @param offered - The findings a before-enforce run offered
 */
function mergeIntoReport(
  repoPath: string,
  offered: readonly AuditFinding[]
): void {
  const file = path.join(repoPath, AUDIT_REPORT_JSON_PATH);
  const report = JSON.parse(readFileSync(file, "utf8")) as {
    readonly findings: readonly AuditFinding[];
  };
  const same = (left: AuditMechanism, right: AuditMechanism): boolean =>
    JSON.stringify(left) === JSON.stringify(right);
  const findings = report.findings.map(finding => {
    const replacement = offered.find(
      each =>
        each.criterion === finding.criterion && each.scope === finding.scope
    );
    return replacement === undefined
      ? finding
      : {
          ...replacement,
          mechanisms: [
            ...replacement.mechanisms,
            ...finding.mechanisms.filter(
              old => !replacement.mechanisms.some(kept => same(kept, old))
            ),
          ],
        };
  });
  writeFileSync(file, `${JSON.stringify({ ...report, findings }, null, 2)}\n`);
}

/**
 * Run the skill's before-enforce run from a repository root: the preflight
 * both runs share, then every shell block of the before-enforce steps, in
 * order.
 * @param repoPath - The repository
 * @param lisaFolder - A folder holding the `lisa` command
 * @returns Every block that ran, with what it printed and how it exited
 */
export function runBeforeEnforceSkill(
  repoPath: string,
  lisaFolder: string
): readonly SkillStep[] {
  const [preflight] = attestSkillSteps("attest");
  const blocks = [
    ...fencedBlocks(preflight?.body ?? "")
      .filter(block => block.language === "bash")
      .map(block => block.content),
    ...attestSkillShellBlocks("before-enforce"),
  ];
  return blocks.reduce<{
    readonly steps: readonly SkillStep[];
    readonly stopped: boolean;
  }>(
    (state, block) => {
      if (state.stopped) return state;
      const ran = runBlock(repoPath, lisaFolder, block);
      const steps = [...state.steps, ran];
      if (block.trim() !== BEFORE_ENFORCE_BLOCK) {
        return { steps, stopped: false };
      }
      if (ran.status === NOTHING_RAN) return { steps, stopped: true };
      mergeIntoReport(
        repoPath,
        (JSON.parse(ran.stdout) as BeforeEnforceRun).audit_findings
      );
      return { steps, stopped: false };
    },
    { steps: [], stopped: false }
  ).steps;
}
