/**
 * Running `claude --bg` for `spawn` and `resume`, with the one failure that
 * is an operator setup step rather than a worker failure called out.
 *
 * Claude Code asks once per directory whether to trust the workspace. Until
 * someone has accepted that prompt in the repo dir, `claude --bg` there exits
 * 1 with (2.1.296) "Workspace not trusted. Run `claude` in <dir> once and
 * accept the trust prompt, then retry." A background session cannot show the
 * prompt, so retrying never helps: that refusal becomes exit 2 (setup) with
 * the exact step, and the manager skill escalates it instead of counting a
 * failed attempt. Every other failure keeps the exit-1 message `mustRun`
 * gives.
 * @module session-manager/worker-launch
 */
import { CliError, EXIT, run } from "./cli-runtime.mjs";

/** How claude words the refusal; matched loosely across versions. */
const UNTRUSTED_WORKSPACE = /workspace (?:is )?not trusted/i;

/**
 * Whether a failed `claude --bg` run was refused for workspace trust.
 * @param {{ stdout: string, stderr: string }} result - Run outcome
 * @returns {boolean} True for the trust refusal
 */
export function isUntrustedWorkspace(result) {
  return UNTRUSTED_WORKSPACE.test(`${result.stderr}\n${result.stdout}`);
}

/**
 * Run a worker spawn or resume spec and return its stdout.
 *
 * Runs the command exactly once: a failure is reported, never retried, so a
 * flaky refusal can never start a second worker.
 * @param {{ command: string, args: string[], cwd: string,
 *   env: Record<string, string | undefined> }} spec - From
 *   `buildWorkerSpawn` or `buildWorkerResume`
 * @returns {string} stdout
 */
export function runWorkerSession(spec) {
  const result = run(spec.command, spec.args, spec);
  if (result.missing) {
    throw new CliError(`${spec.command} is not on PATH.`, EXIT.FAILURE);
  }
  if (result.status === 0) return result.stdout;
  if (isUntrustedWorkspace(result)) {
    throw new CliError(
      `Claude Code's workspace trust has not been accepted in ${spec.cwd}, ` +
        `so claude --bg refused to start a worker there. This is a one-time ` +
        `step per repo: run \`claude\` once in ${spec.cwd}, accept the trust ` +
        `prompt, exit, then retry.`,
      EXIT.SETUP
    );
  }
  const detail = result.stderr.trim() || `exit ${result.status}`;
  throw new CliError(
    `${spec.command} ${spec.args[0] ?? ""} failed: ${detail}`,
    EXIT.FAILURE
  );
}
