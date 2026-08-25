/**
 * Read-only probe: is one named merge driver's command registered here?
 *
 * The generalised counterpart to
 * `probeLearningsMergeDriverRegistration`, which answers the same question for
 * one hardcoded driver. Split out so a roster derived from `.gitattributes` can
 * ask it about a driver nobody has written code for yet.
 * @module core/merge-driver-registration
 */

/** Whether a driver command is resolvable in this checkout. */
export type MergeDriverRegistrationState = "registered" | "unregistered";

const GIT_COMMAND_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};

/**
 * Report whether `merge.<driver>.driver` resolves in this checkout.
 *
 * Deliberately scope-agnostic: registration is written to local config, but git
 * resolves a merge driver from any config scope, so asking with `--local` would
 * report a working global registration as missing.
 *
 * `execFile` (not `exec`) keeps the driver name a literal argument rather than
 * shell text, matching the house pattern for git invocations.
 * @param projectRoot - Project directory to inspect
 * @param driver - Merge-driver name from `.gitattributes`
 * @returns Whether the command is registered
 */
export async function probeMergeDriverRegistration(
  projectRoot: string,
  driver: string
): Promise<MergeDriverRegistrationState> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run(
      "git",
      ["config", "--get", `merge.${driver}.driver`],
      { cwd: projectRoot, env: GIT_COMMAND_ENV }
    );
    return stdout.trim() === "" ? "unregistered" : "registered";
  } catch {
    return "unregistered";
  }
}
