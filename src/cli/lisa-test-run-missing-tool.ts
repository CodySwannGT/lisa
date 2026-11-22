/**
 * Name the missing tool when `lisa-test-run` cannot start its payload
 * (CodySwannGT/lisa#4932).
 *
 * Some runners Lisa's scripts call are not npm packages, so no manifest can
 * declare them and no install puts them on PATH: Maestro is installed with its
 * own script. Before this, a host without it saw `spawn maestro ENOENT`, which
 * names neither the problem nor the remedy for the operator standing at the
 * gate. The run still fails — a missing runner is never a pass — but it says
 * which tool is missing and how to install it.
 * @module cli/lisa-test-run-missing-tool
 */

/** Install guidance for runners that no package manager provides. */
const INSTALL_HINTS: Readonly<Record<string, string>> = {
  maestro:
    'install it with `curl -fsSL "https://get.maestro.mobile.dev" | bash` (see https://docs.maestro.dev/getting-started/installing-maestro), then open a new shell so it is on PATH',
};

/**
 * The operator-facing message for a payload whose executable does not exist.
 * @param error - What starting the payload threw
 * @returns A message naming the tool and its install step, or undefined when
 *   the failure is not a missing executable
 */
export function missingToolMessage(error: unknown): string | undefined {
  const { code, path } = (error ?? {}) as { code?: unknown; path?: unknown };
  if (code !== "ENOENT" || typeof path !== "string" || path === "")
    return undefined;
  const hint =
    INSTALL_HINTS[path] ??
    "install it, or add the package that provides it to this project";
  return `\`${path}\` is not installed or not on PATH, so the test run could not start: ${hint}.`;
}
