/**
 * Proving a check through a real commit or a real push, in the disposable
 * copy.
 *
 * The workspace in `./proof-workspace.ts` starts an entry's own command. That
 * shows the command works and says nothing about whether anything runs it.
 * This one triggers the moment itself: it stages the planted change and runs
 * `git commit`, or commits and runs `git push` to the stand-in remote, so
 * what answers is the installed chain, from git's hook through the carrier
 * and the gate runner to the check.
 *
 * ## What counts as an answer
 *
 * A hook can refuse a commit for many reasons, and only one of them is this
 * check finding its rule broken. So an answer is handed on to be judged only
 * when three things agree:
 *
 * 1. git's exit status: non-zero for a refusal, zero for a change let
 *    through.
 * 2. what git did: after a refusal there is no new commit, or the stand-in
 *    remote's branch has not moved; after a change let through there is one,
 *    or the branch has moved to it. The exit status alone is not trusted.
 * 3. the gate runner's own report line for this check: `FAILED` for a
 *    refusal, `PASSED` for a change let through.
 *
 * Where they disagree, or the runner's report has no line for this check at
 * all (Node is missing, the carrier could not find the runner, some other
 * check refused the commit first), the half is reported as a check that
 * could not be started, with a sentence saying which. The declared failure
 * text is then still matched by the paired-proof runner, exactly as it is
 * for a command started directly.
 *
 * ## What is not proved this way
 *
 * A moment at which git runs no carrier in the copy, and a check declared
 * optional there, which reports and never refuses. Neither falls back to
 * starting the check's command: that would be a different proof under the
 * same name.
 *
 * ## A change that rewrites the check
 *
 * Everything that answers here is read from the copy: the declaration, the
 * hook scripts, the gate runner. A planted change that edits one of them
 * changes what answers, and so does one that edits the script the check's
 * command runs or puts a file at a path git leaves out of a commit. So the
 * workspace can say what the change planted right now touches that it may
 * not (`changeFinding`), and the paired-proof runner asks before it starts
 * any check (`./proof-preflight.ts`). The rule itself is in
 * `./proof-change-rule.ts`.
 *
 * ## The same commit or push, answered by git alone
 *
 * Before anything is installed there is no carrier and no gate runner to
 * report, and the question is a different one: does a bad change get
 * through at all? Opened with `answeredBy: "git"`, the workspace makes the
 * same real commit or push whatever is wired in the copy, and hands the
 * answer on when the first two things above agree. It asks nothing of a
 * runner's report. `./before-enforce-run.ts` reads those answers, and they
 * are never read as a proof's.
 * @module controls/proof-copy-workspace
 */
import { rmSync } from "node:fs";
import path from "node:path";

import { CARRIER_MOMENTS, type CarrierMoment } from "./carrier-types.js";
import { changeFinding } from "./proof-change-rule.js";
import {
  copyGit,
  gitSaid,
  type GitExit,
  type RunGit,
} from "./proof-copy-git.js";
import type { ProofCopy } from "./proof-copy.js";
import { restorePreparedCopy } from "./proof-copy-prepared-state.js";
import {
  contradictionDetail,
  optionalDetail,
  proofCommitMessage,
  PROOF_REMOTE_PLACEHOLDER,
  unattributedDetail,
  unwiredDetail,
} from "./proof-copy-wording.js";
import {
  applyPreparedProofPatch,
  applyProofPatch,
  isolatedGit,
} from "./proof-patch.js";
import { preparePushProof } from "./proof-push-fixture.js";
import type { ProofTools } from "./proof-tools.js";
import type {
  PatchOutcome,
  ProofAnswer,
  ProofTrigger,
  ProofWorkspace,
} from "./proof-types.js";
import { mechanismAt, type ControlRegisterEntry } from "./register-types.js";

/** The start of a line the gate runner prints for a check that ran. */
const RUNNER_VERDICT = /^ {2}(PASSED|FAILED) +(?:required|optional) +/u;

/** What the gate runner's report says of one check. */
type RunnerVerdict = "PASSED" | "FAILED";

/** How a workspace over a disposable copy answers. */
export interface ProofCopyWorkspaceOptions {
  /**
   * `carriers`, the default: an answer counts only when the installed
   * carrier's gate runner reports this check, and nothing is triggered at a
   * moment no carrier runs at. `git`: the commit or push is made whatever is
   * wired, and git's exit status together with what git did is the answer.
   */
  readonly answeredBy?: "carriers" | "git";
}

/**
 * Let anything waiting on this process have its turn.
 *
 * Starting a command blocks until the command ends, and a signal that arrives
 * meanwhile is only acted on once the process is idle. Without this pause a
 * run goes from one blocking command straight into the next, and an
 * interruption would wait for the whole run.
 * @returns A promise that resolves on the next turn
 */
function turn(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

/**
 * Tell whether a moment is one a git hook carries.
 * @param moment - The moment
 * @returns Whether it is `commit` or `push`
 */
function isCarried(moment: string): moment is CarrierMoment {
  return (CARRIER_MOMENTS as readonly string[]).includes(moment);
}

/**
 * Read what the gate runner's report says of one check.
 *
 * The runner prints one line per check that ran: its verdict, its level, its
 * name, then the command. Declared parts name the folder and render the
 * command as a JSON list. Tasks name the gate and render the resolved command.
 * @param output - Everything the commit or push printed
 * @param name - What the gate runner calls the check
 * @param taskCommand - The resolved command when the check is a task
 * @returns Its verdict, or `null` when the report has no single one
 */
export function runnerVerdictOf(
  output: string | null,
  name: string,
  taskCommand?: string
): RunnerVerdict | null {
  const verdicts = new Set(
    (output ?? "").split("\n").flatMap(line => {
      const match = RUNNER_VERDICT.exec(line);
      if (match === null) return [];
      const rest = line.slice(match[0].length);
      if (!rest.startsWith(`${name} `)) return [];
      const command = rest.slice(name.length).trimStart();
      const named =
        taskCommand === undefined
          ? command.startsWith("[")
          : command === taskCommand || command.startsWith(`${taskCommand} (`);
      const verdict: RunnerVerdict =
        match[1] === "PASSED" ? "PASSED" : "FAILED";
      return named ? [verdict] : [];
    })
  );
  const [verdict] = verdicts;
  return verdicts.size === 1 && verdict !== undefined ? verdict : null;
}

/**
 * Say why a check cannot be proved through the hook at a moment, when it
 * cannot.
 * @param copy - The disposable copy
 * @param entry - The register entry
 * @param moment - The moment
 * @returns The reason, or `null` when the hook can be triggered
 */
function notThroughHook(
  copy: ProofCopy,
  entry: ControlRegisterEntry,
  moment: CarrierMoment
): string | null {
  const point = entry.enforcement_points.find(
    candidate => candidate.moment === moment
  );
  if (point?.level === "optional") return optionalDetail(moment);
  const unwired = copy.unwired[moment];
  return unwired === null ? null : unwiredDetail(moment, unwired);
}

/**
 * The git command that triggers a moment, as a person would type it.
 * @param copy - The disposable copy
 * @param entry - The register entry being proved
 * @param moment - The moment
 * @returns `git`, then its arguments
 */
function momentCommand(
  copy: ProofCopy,
  entry: ControlRegisterEntry,
  moment: CarrierMoment
): readonly string[] {
  return moment === "commit"
    ? [
        "git",
        "commit",
        "--quiet",
        "-m",
        proofCommitMessage(entry.id, copy.source.commitTrailers),
      ]
    : [
        "git",
        "push",
        "--quiet",
        "origin",
        `HEAD:refs/heads/${copy.pushBranch}`,
      ];
}

/**
 * Tell whether the change got where the moment would take it.
 * @param copy - The disposable copy
 * @param moment - The moment
 * @returns At commit, whether a new commit exists; at push, whether the
 *   stand-in remote's branch is that commit
 */
function landed(copy: ProofCopy, moment: CarrierMoment): boolean {
  const head = copyGit(copy.clone)(["rev-parse", "HEAD"]);
  const created = head.code === 0 && head.stdout !== copy.base;
  if (moment === "commit") return created;
  const arrived = copyGit(copy.remote)([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${copy.pushBranch}`,
  ]);
  return created && arrived.code === 0 && arrived.stdout === head.stdout;
}

/**
 * Hand an answer on only when git's exit status, what git did and the gate
 * runner's report all say the same thing about this check.
 * @param answer - What the commit or push answered
 * @param facts - What else is known about it
 * @param facts.moment - The moment
 * @param facts.landed - Whether the change got where the moment takes it
 * @param facts.name - What the gate runner calls the check; `null` when
 *   git alone answers and no runner's report is asked for
 * @param facts.taskCommand - The resolved command when the check is a task
 * @returns The answer, or the same answer marked as one that says nothing
 *   about this check
 */
function attributed(
  answer: ProofAnswer,
  facts: {
    readonly moment: CarrierMoment;
    readonly landed: boolean;
    readonly name: string | null;
    readonly taskCommand?: string;
  }
): ProofAnswer {
  const { code } = answer;
  if (code === null || answer.notStarted !== undefined) return answer;
  const refused = code !== 0;
  if (refused === facts.landed) {
    return { ...answer, notStarted: contradictionDetail(facts.moment, code) };
  }
  if (facts.name === null) return answer;
  return runnerVerdictOf(answer.output, facts.name, facts.taskCommand) ===
    (refused ? "FAILED" : "PASSED")
    ? answer
    : {
        ...answer,
        notStarted: unattributedDetail(facts.moment, refused, facts.name),
      };
}

/**
 * Find the name the gate runner prints for an entry at a Git hook moment.
 * @param entry - The control being proved
 * @param moment - The commit or push under proof
 * @returns The gate and, for a task, its resolved command
 */
function carrierTarget(
  entry: ControlRegisterEntry,
  moment: CarrierMoment
): { readonly name: string; readonly taskCommand?: string } {
  const point = entry.enforcement_points.find(
    candidate => candidate.moment === moment
  );
  const mechanism =
    point === undefined ? entry.measuring_mechanism : mechanismAt(entry, point);
  return mechanism.kind === "task"
    ? { name: entry.gate, taskCommand: mechanism.command.trim() }
    : { name: `${entry.gate} in ${entry.scope}` };
}

/**
 * Trigger an entry's moment in the copy with a real commit or push.
 * @param copy - The disposable copy, with the change already staged
 * @param tools - The gate runner's own parts
 * @param request - The entry, its moment and the time limit
 * @param byGit - Whether git alone answers, whatever is wired in the copy
 * @returns What answered
 */
function triggered(
  copy: ProofCopy,
  tools: ProofTools,
  request: ProofTrigger,
  byGit: boolean
): ProofAnswer {
  const { entry, moment, timeoutMs } = request;
  const unstarted = (
    command: readonly string[],
    notStarted: string
  ): ProofAnswer => ({
    command,
    cwd: copy.clone,
    code: null,
    output: null,
    notStarted,
  });
  if (!isCarried(moment)) {
    return unstarted(
      [...request.mechanism.argv],
      `no git hook runs at ${moment}, so there is nothing to commit or push`
    );
  }
  const command = momentCommand(copy, entry, moment);
  const blocked = byGit ? null : notThroughHook(copy, entry, moment);
  if (blocked !== null) return unstarted(command, blocked);
  if (moment === "push") {
    const preparation = preparePushProof(copy, tools, request);
    if (preparation !== null) return unstarted(command, preparation);
  }
  const [, ...args] = command;
  const answer = tools.start([...isolatedGit(copy.clone), ...args], {
    cwd: copy.clone,
    timeoutMs,
  });
  return attributed(
    {
      ...answer,
      command,
      cwd: copy.clone,
      output:
        answer.output?.replaceAll(copy.remote, PROOF_REMOTE_PLACEHOLDER) ??
        null,
    },
    {
      landed: landed(copy, moment),
      moment,
      ...(byGit ? { name: null } : carrierTarget(entry, moment)),
    }
  );
}

/**
 * Put the copy back to its base commit: the working copy, the branch, and
 * the stand-in remote.
 * @param copy - The disposable copy
 * @param inClone - Git in the working copy
 * @returns No problem, or the first command that failed and why
 */
function reset(copy: ProofCopy, inClone: RunGit): PatchOutcome {
  const branch = `refs/heads/${copy.pushBranch}`;
  const failed = [
    // A commit stopped at its time limit can leave its lock behind. Nothing
    // else works in the copy, and what held the lock has been stopped.
    (): GitExit => {
      rmSync(path.join(copy.clone, ".git", "index.lock"), { force: true });
      return { code: 0, stderr: "", stdout: "" };
    },
    () => inClone(["reset", "--quiet", "--hard", copy.base]),
    // Twice forced, and ignored files too: whatever a check left behind goes,
    // including a repository of its own.
    () => inClone(["clean", "-ffdxq"]),
    () =>
      inClone([
        "update-ref",
        `refs/remotes/origin/${copy.pushBranch}`,
        copy.base,
      ]),
    () => copyGit(copy.remote)(["update-ref", branch, copy.base]),
  ].reduce<string | null>((problem, run) => {
    if (problem !== null) return problem;
    const exit = run();
    return exit.code === 0 ? null : gitSaid(exit);
  }, null);
  if (failed !== null) {
    return {
      problem: `the disposable copy could not be put back to its starting commit: ${failed}`,
    };
  }
  const preparation = copy.preparation;
  const restore =
    preparation === undefined
      ? null
      : restorePreparedCopy(copy.clone, preparation);
  return {
    problem:
      restore === null
        ? null
        : `the prepared files could not be restored: ${restore}`,
  };
}

/**
 * A workspace that proves a check through a real commit or push in the
 * disposable copy.
 * @param copy - The disposable copy
 * @param tools - The gate runner's own parts
 * @param options - Who answers; the installed carriers when left out
 * @returns The workspace
 */
export function proofCopyWorkspace(
  copy: ProofCopy,
  tools: ProofTools,
  options: ProofCopyWorkspaceOptions = {}
): ProofWorkspace {
  const inClone = copyGit(copy.clone);
  const byGit = options.answeredBy === "git";
  return {
    root: copy.clone,
    apply: async patch => {
      await turn();
      if (copy.preparation !== undefined) {
        return applyPreparedProofPatch(copy.clone, patch, () =>
          reset(copy, inClone)
        );
      }
      const planted = applyProofPatch(copy.clone, patch);
      if (planted.problem !== null) return planted;
      const staged = inClone(["add", "--all"]);
      if (staged.code === 0) return { problem: null };
      const undone = reset(copy, inClone);
      const after = undone.problem === null ? "" : ` Then ${undone.problem}`;
      return {
        problem: `The change was put in place but could not be staged, so it was taken back out: ${gitSaid(staged)}${after}`,
      };
    },
    changeFinding: async change => {
      await turn();
      return changeFinding({
        ...change,
        checkFiles: copy.checkFiles,
        directory: copy.clone,
        git: inClone,
      });
    },
    trigger: async request => {
      await turn();
      return triggered(copy, tools, request, byGit);
    },
    restore: async () => {
      await turn();
      return reset(copy, inClone);
    },
  };
}
