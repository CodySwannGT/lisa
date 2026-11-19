/**
 * Checking the pull-request executor a register names, on a platform Lisa
 * ships no pipeline for.
 *
 * On any platform but GitHub the file that runs the gates on a pull request
 * is written by the host, to a contract, and the register records where it
 * is. Whether the platform runs that file, and whether a failing run stops a
 * merge, are settings of the platform this command cannot read. What it can
 * read is the checkout: the file is there, or it is not, and it holds the
 * one invocation the contract requires, or it does not.
 *
 * So a `wired` answer here means exactly this: the file exists and one of
 * its lines that is not a comment runs the gate runner for the pull-request
 * moment. It is a reading of text. It does not show that the pipeline runs,
 * and the answer says so.
 * @module controls/reconcile-executor
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { pathKind } from "./audit-report-file.js";
import { CARRIER_RUNNER_FILE, CARRIER_RUNNER_PATH } from "./carrier-types.js";
import { platformLabel } from "./protect-platform.js";
import { PULL_REQUEST_MOMENT } from "./pull-request-executor.js";
import type { PointVerdict } from "./reconcile-types.js";
import type { PullRequestExecutor } from "./register-types.js";

/** The argument that names the moment, as the runner requires it written. */
const MOMENT_ARGUMENT = `--moment=${PULL_REQUEST_MOMENT}`;

/** The invocation the executor contract requires, as it is documented. */
export const EXECUTOR_INVOCATION = `node ${CARRIER_RUNNER_PATH} ${MOMENT_ARGUMENT}`;

/**
 * Tell whether a pipeline file's text runs the gate runner for a pull
 * request.
 * @param text - The file's content
 * @returns Whether a line that is not a comment names the runner and the
 *   pull-request moment
 */
function runsPullRequestGates(text: string): boolean {
  return text
    .split("\n")
    .filter(line => !line.trimStart().startsWith("#"))
    .some(
      line =>
        line.includes(CARRIER_RUNNER_FILE) && line.includes(MOMENT_ARGUMENT)
    );
}

/**
 * Say whether the executor a register names is in place in a checkout.
 * @param root - Real path of the repository
 * @param executor - The file and platform the register names
 * @returns `wired` when the file runs the gate runner's pull-request
 *   command, `not-wired` when it is missing or does not
 */
export async function executorVerdict(
  root: string,
  executor: PullRequestExecutor
): Promise<PointVerdict> {
  const verdict = (state: PointVerdict["state"], reason: string) => ({
    checked: executor.path,
    reason,
    state,
  });
  const named = `${executor.path}, the file the register names as running the checks on a pull request,`;
  const absolute = path.join(root, executor.path);
  const kind = await pathKind(absolute);
  if (kind === "missing") {
    return verdict("not-wired", `${named} is not in this checkout.`);
  }
  if (kind !== "file") {
    return verdict(
      "not-wired",
      `${named} is not an ordinary file, so it was not read.`
    );
  }
  return runsPullRequestGates(await readFile(absolute, "utf8"))
    ? verdict(
        "wired",
        `${executor.path} runs the gate runner's pull-request command. This is a reading of the file's text: it does not show that ${platformLabel(executor.platform)} runs the pipeline or requires it before a merge.`
      )
    : verdict(
        "not-wired",
        `${named} does not start the gate runner for a pull request: none of its lines runs "${EXECUTOR_INVOCATION}".`
      );
}
