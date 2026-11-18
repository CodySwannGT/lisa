/**
 * Running every required check once on the head of the default branch, to
 * list the ones that fail there.
 *
 * Making a check required does not make the code pass it. A repository that
 * has never been held to its own lint rules goes red the moment they are
 * enforced, and the operator should learn that from this report, not from
 * the first commit somebody cannot make. So each required check is run once,
 * against a fresh copy of the default branch's last commit
 * (`./enforce-head-copy.ts`), and the ones that fail are listed with what
 * their command printed.
 *
 * ## Which checks
 *
 * Every register entry that is `required` at some moment and is measured by
 * a command the repository declares. Each is listed on every run, not only
 * on the run that first wired it: the list is the backlog, and it is still
 * the backlog the second time.
 *
 * A check that runs through the project's task runner is not run: it needs
 * the project's dependencies installed, and a fresh copy has none. It is
 * listed as not measured, never as failing.
 *
 * ## How a result is read
 *
 * The command is started and its answer judged by the gate runner's own
 * functions (`./proof-tools.ts`), so this list and the gate agree on what an
 * answer means. A command is listed as failing when it ran to an end and the
 * runner does not judge it as passing, because that is exactly when the gate
 * stops a change. `judged` says which of two things happened: `failed`, the
 * runner read a broken rule in the output; or `unproved`, the command ended
 * with an error and nothing in its output is a failure the runner knows or
 * the entry declares, so a broken rule cannot be told from a broken command.
 * One that could not be started, ran out of time or was killed gave no
 * answer and is listed as not measured, never as failing.
 *
 * What a command printed is kept through `prepareEvidenceExcerpt`, the one
 * place check output is made ready to be kept, after the copy's own path
 * has been replaced by {@link COPY_PLACEHOLDER}.
 * @module controls/enforce-head-run
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  removeOnTermination,
  type SignalSource,
} from "./commands/attest-interruption.js";
import { readDefaultBranchHead } from "./enforce-head.js";
import { buildHeadCopy } from "./enforce-head-copy.js";
import {
  ENFORCE_REPORT_INVOCATION,
  type CurrentlyFailing,
  type DefaultBranchHead,
  type FailingGate,
  type UnmeasuredGate,
} from "./enforce-types.js";
import { prepareEvidenceExcerpt } from "./evidence-write.js";
import { PROOF_TIME_LIMIT_CEILING_SECONDS } from "./proof-plan.js";
import { loadProofTools, type ProofTools } from "./proof-tools.js";
import {
  mechanismAt,
  type ControlRegister,
  type ControlRegisterEntry,
} from "./register-types.js";

/** The start of the name of every run's temporary folder. */
export const HEAD_SCRATCH_PREFIX = "lisa-enforce-head-";

/** What stands in for the copy's own path in what a command printed. */
export const COPY_PLACEHOLDER = "<copy>";

/** How long one check may run when its entry declares no time limit. */
export const HEAD_CHECK_SECONDS = 10 * 60;

/** How often removing the folder is tried again when it is busy. */
const REMOVE_RETRIES = 5;

/** What the run needs from outside, each replaceable in a test. */
export interface HeadRunDependencies {
  /** Loads the gate runner's own parts. */
  readonly loadTools?: () => Promise<ProofTools>;
  /** Names the run's temporary folder, which must not exist yet. */
  readonly scratch?: () => string;
  /** Where signals come from; this process's own when left out. */
  readonly signals?: SignalSource;
  /** Tells the operator one line that is not a result. */
  readonly notice?: (line: string) => void;
}

/** One required check to run: an entry and the command that measures it. */
interface RequiredCheck {
  readonly entry: ControlRegisterEntry;
  readonly command: readonly string[];
}

/** What running one check came to. */
type CheckResult =
  | { readonly kind: "passing" }
  | { readonly kind: "failing"; readonly gate: FailingGate }
  | { readonly kind: "not-measured"; readonly gate: UnmeasuredGate };

/**
 * Name a temporary folder for one run. Nothing is created.
 * @returns A path in the machine's temporary folder that no other run uses
 */
function headScratchFolder(): string {
  return path.join(tmpdir(), `${HEAD_SCRATCH_PREFIX}${randomUUID()}`);
}

/**
 * Name the mechanism that measures an entry where it is required.
 * @param entry - The register entry
 * @returns Its mechanism at the first moment it is required, or `null` when
 *   it is required nowhere
 */
function requiredMechanism(
  entry: ControlRegisterEntry
): ReturnType<typeof mechanismAt> | null {
  const point = entry.enforcement_points.find(
    each => each.level === "required"
  );
  return point === undefined ? null : mechanismAt(entry, point);
}

/**
 * Sort a register's required entries into the ones to run and the ones that
 * cannot be run in a fresh copy.
 * @param register - The control register
 * @returns The checks to run, and the task-runner checks left out
 */
function requiredChecks(register: ControlRegister): {
  readonly run: readonly RequiredCheck[];
  readonly left: readonly UnmeasuredGate[];
} {
  const required = register.entries.flatMap(entry => {
    const mechanism = requiredMechanism(entry);
    return mechanism === null ? [] : [{ entry, mechanism }];
  });
  return {
    left: required
      .filter(({ mechanism }) => mechanism.kind === "task")
      .map(({ entry }) => ({
        entry_id: entry.id,
        reason:
          "It runs through the project's own task runner, which needs the project's dependencies installed. A fresh copy of the default branch has none, so it was not run there.",
      })),
    run: required.flatMap(({ entry, mechanism }) =>
      mechanism.kind === "command" ? [{ command: mechanism.argv, entry }] : []
    ),
  };
}

/**
 * Run one check in the copy and read its answer.
 * @param check - The entry and its command
 * @param checkout - The copy's folder
 * @param tools - The gate runner's own parts
 * @returns Whether it passes, fails or gave no answer
 */
function runCheck(
  check: RequiredCheck,
  checkout: string,
  tools: ProofTools
): CheckResult {
  const { command, entry } = check;
  const unmeasured = (reason: string): CheckResult => ({
    gate: { entry_id: entry.id, reason },
    kind: "not-measured",
  });
  const folder = tools.folder(checkout, entry.scope);
  if ("problem" in folder) {
    return unmeasured(
      `It could not be started on the default branch: ${folder.problem}.`
    );
  }
  const seconds = Math.min(
    entry.proof.timeout_seconds ?? HEAD_CHECK_SECONDS,
    PROOF_TIME_LIMIT_CEILING_SECONDS
  );
  const answer = tools.start(command, {
    cwd: folder.directory,
    timeoutMs: seconds * 1000,
  });
  if (answer.timedOut === true) {
    return unmeasured(
      `It did not finish within ${seconds} seconds and was stopped, so it is not counted as failing.`
    );
  }
  if (answer.notStarted !== undefined) {
    return unmeasured(`It could not be started: ${answer.notStarted}.`);
  }
  const shape = entry.proof.failure_shape ?? [];
  const judged = tools.judge(
    { ...answer, command, cwd: folder.directory },
    { gate: entry.gate, shape }
  );
  if (judged.verdict === "passed") return { kind: "passing" };
  // A command the runner would not stand behind and that never ran to an end
  // says nothing about the code. One that ran to an end and was not judged
  // as passing stops a change, whether or not the runner can name the rule.
  if (judged.verdict === "killed" || typeof answer.code !== "number") {
    return unmeasured(
      "It ended without an answer that can be relied on, so it is not counted as failing."
    );
  }
  return {
    gate: {
      command,
      criteria: entry.criteria,
      entry_id: entry.id,
      exit_status: answer.code,
      gate: entry.gate,
      judged: judged.verdict === "failed" ? "failed" : "unproved",
      matched_failure_shape: shape.length === 0 ? null : judged.declared,
      scope: entry.scope,
      ...prepareEvidenceExcerpt(
        (answer.output ?? "").replaceAll(checkout, COPY_PLACEHOLDER),
        false
      ),
    },
    kind: "failing",
  };
}

/**
 * Put the results of a run together.
 * @param head - The commit the checks ran against
 * @param results - What each check came to
 * @param left - The checks that were not run at all
 * @returns The section of the report
 */
function measured(
  head: DefaultBranchHead,
  results: readonly CheckResult[],
  left: readonly UnmeasuredGate[]
): CurrentlyFailing {
  const gates = results.flatMap(result =>
    result.kind === "failing" ? [result.gate] : []
  );
  const unanswered = results.flatMap(result =>
    result.kind === "not-measured" ? [result.gate] : []
  );
  const checked = results.length - unanswered.length;
  return {
    checked,
    gates,
    head,
    measured: true,
    not_measured: [...unanswered, ...left],
    reason: `Each required check that is a command of this repository was run once in a fresh copy of ${head.branch} at commit ${head.commit.slice(0, 12)}, read from ${head.ref} as this checkout last saw it. ${gates.length} of ${checked} ${gates.length === 1 ? "does" : "do"} not pass there. Work that is not committed is not in that copy, and neither are installed dependencies.`,
  };
}

/**
 * Say that nothing was measured, and why.
 * @param reason - Why, in a plain sentence
 * @param head - The commit, when it was found
 * @param left - The checks that were not run at all
 * @returns The section of the report
 */
function notMeasured(
  reason: string,
  head: DefaultBranchHead | null,
  left: readonly UnmeasuredGate[]
): CurrentlyFailing {
  return {
    checked: 0,
    gates: [],
    head,
    measured: false,
    not_measured: left,
    reason,
  };
}

/**
 * Run every required check of a register once on the head of the default
 * branch. Nothing in the operator's repository is changed, and the copy is
 * removed on every way out.
 * @param root - Real path of the operator's repository
 * @param register - The control register the declaration generates
 * @param platformBranch - The branch the hosting platform named, or `null`
 * @param dependencies - Replaceable collaborators
 * @returns The checks that fail there, the ones that gave no answer, and
 *   how the measurement was made
 */
export async function measureCurrentlyFailing(
  root: string,
  register: ControlRegister,
  platformBranch: string | null,
  dependencies: HeadRunDependencies = {}
): Promise<CurrentlyFailing> {
  const { left, run } = requiredChecks(register);
  if (run.length === 0) {
    return notMeasured(
      "The register holds no required check that is a command of this repository, so there was nothing to run on the default branch.",
      null,
      left
    );
  }
  const read = readDefaultBranchHead(root, platformBranch);
  if (read.problem !== null) return notMeasured(read.problem, null, left);
  const folder = (dependencies.scratch ?? headScratchFolder)();
  const notice =
    dependencies.notice ?? (line => process.stderr.write(`${line}\n`));
  // Listening before the folder exists, so a run that is told to stop while
  // the copy is being made still removes whatever is there so far.
  const watch = removeOnTermination(folder, {
    say: () => {
      notice(
        existsSync(folder)
          ? `${ENFORCE_REPORT_INVOCATION}: interrupted. The temporary copy the checks ran in could not be removed. Your repository was not changed. Remove this folder by hand: ${folder}`
          : `${ENFORCE_REPORT_INVOCATION}: interrupted. The temporary copy the checks ran in was removed. Your repository was not changed.`
      );
    },
    ...(dependencies.signals === undefined
      ? {}
      : { signals: dependencies.signals }),
  });
  try {
    const built = await buildHeadCopy(root, folder, read.head);
    if (built.problem !== null) {
      return notMeasured(built.problem, read.head, left);
    }
    const tools = await (dependencies.loadTools ?? loadProofTools)();
    return measured(
      read.head,
      run.map(check => runCheck(check, built.checkout, tools)),
      left
    );
  } finally {
    await rm(folder, {
      force: true,
      maxRetries: REMOVE_RETRIES,
      recursive: true,
    });
    watch.release();
  }
}
