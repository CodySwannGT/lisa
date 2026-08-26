/**
 * @file doctor-nightly-e2e-guard-runtime.ts
 * @description Proven shell and environment constraints for static guard calls
 * @module cli/doctor-nightly-e2e-guard-runtime
 */

const EXECUTION_ENVIRONMENT_NAMES = new Set([
  "BASHOPTS",
  "BASH_ENV",
  "CDPATH",
  "ENV",
  "GLOBIGNORE",
  "IFS",
  "PATH",
  "POSIXLY_CORRECT",
  "SHELLOPTS",
]);
const EXECUTION_ENVIRONMENT_PREFIXES = [
  "BASH_FUNC_",
  "DYLD_",
  "LD_",
  "NIX_LD",
  "NODE_",
];

const GITHUB_HOSTED_POSIX_RUNNER =
  /^(?:ubuntu-(?:latest|24\.04|22\.04|20\.04)|macos-(?:latest|15|14|13))$/u;

const EXECUTION_PRESERVING_SHELLS = new Set([
  "bash",
  "bash {0}",
  "bash -e {0}",
  "bash -eo pipefail {0}",
  "bash --noprofile --norc -eo pipefail {0}",
  "sh",
  "sh {0}",
  "sh -e {0}",
  "/bin/bash",
  "/bin/bash {0}",
  "/bin/bash -e {0}",
  "/bin/bash -eo pipefail {0}",
  "/bin/bash --noprofile --norc -eo pipefail {0}",
  "/usr/bin/bash",
  "/usr/bin/bash {0}",
  "/usr/bin/bash -e {0}",
  "/usr/bin/bash -eo pipefail {0}",
  "/usr/bin/bash --noprofile --norc -eo pipefail {0}",
  "/bin/sh",
  "/bin/sh {0}",
  "/bin/sh -e {0}",
  "/usr/bin/sh",
  "/usr/bin/sh {0}",
  "/usr/bin/sh -e {0}",
]);

/** Metadata whose exact values decide whether POSIX parsing is sound. */
export interface NightlyGuardRuntimeContext {
  /** Highest-precedence workflow/job/step shell declaration, when present. */
  readonly shell: unknown;
  /** Job runner label used only when no shell is explicitly declared. */
  readonly runsOn: unknown;
  /** Fully merged workflow/job/step environment visible to the command. */
  readonly environment: Readonly<Record<string, unknown>>;
}

/**
 * Identify environment controls that can replace or alter Node/shell execution.
 * @param name - Case-sensitive process environment name from YAML or shell
 * @returns Whether the name can change how the certified bytes are executed
 */
export const isExecutionChangingEnvironmentName = (name: string): boolean =>
  EXECUTION_ENVIRONMENT_NAMES.has(name) ||
  EXECUTION_ENVIRONMENT_PREFIXES.some(prefix => name.startsWith(prefix));

/**
 * Refuse an effective environment that can turn exact bytes into false proof.
 * @param environment - Merged environment after YAML precedence is applied
 * @returns A bounded refusal naming the first dangerous control, when present
 */
export const nightlyGuardEnvironmentFailure = (
  environment: Readonly<Record<string, unknown>>
): string | undefined => {
  const unsafe = Object.keys(environment)
    .sort((left, right) => left.localeCompare(right))
    .find(isExecutionChangingEnvironmentName);
  return unsafe
    ? `${unsafe} environment control can change or replace certified guard execution`
    : undefined;
};

const normalizedShell = (shell: string): string =>
  shell.trim().split(/\s+/u).join(" ");

/**
 * Require either a finite safe shell template or an exact hosted runner label.
 * @param run - YAML-decoded command; empty steps need no shell inference
 * @param context - Effective shell, runner, and merged environment metadata
 * @returns Why static POSIX execution is unproved, or undefined when proved
 */
export const nightlyGuardPosixContextFailure = (
  run: string,
  context: NightlyGuardRuntimeContext
): string | undefined => {
  if (run.trim().length === 0) return undefined;
  if (context.shell !== undefined) {
    return typeof context.shell === "string" &&
      EXECUTION_PRESERVING_SHELLS.has(normalizedShell(context.shell))
      ? undefined
      : "step shell is unknown, non-POSIX, or not an execution-preserving bash/sh template";
  }
  if (
    typeof context.runsOn !== "string" ||
    !GITHUB_HOSTED_POSIX_RUNNER.test(context.runsOn)
  ) {
    return "runner is self-hosted, array-valued, custom, dynamic, or unknown; an explicit supported POSIX shell is required";
  }
  return undefined;
};
