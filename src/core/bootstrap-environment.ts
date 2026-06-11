export const LISA_BOOTSTRAP_ENV = "LISA_BOOTSTRAP";

export const BUILD_ENV_FINGERPRINTS: readonly string[] = [
  "CI",
  "CODEBUILD_BUILD_ID",
  "GITHUB_ACTIONS",
  "EAS_BUILD",
  "VERCEL",
  "BUILDKITE",
  "JENKINS_URL",
  "AMPLIFY_APP_ID",
  "AWS_BRANCH",
];

export const BOOTSTRAP_SKIP_NOTICE =
  "lisa: skipped (non-interactive environment; set LISA_BOOTSTRAP=1 to force)";

/**
 * Runtime state used by the bootstrap guard.
 */
export interface BootstrapEnvironment {
  /** Environment variables visible to the current process. */
  readonly env: NodeJS.ProcessEnv;
  /** Whether stdin is attached to an interactive TTY. */
  readonly stdinIsTTY: boolean;
}

/**
 * Options for deciding whether the apply entry point should be skipped.
 */
export interface BootstrapGuardOptions {
  /** Whether the caller requested validate-only mode. */
  readonly validateOnly: boolean;
  /** Injectable runtime state for tests. Defaults to the current process. */
  readonly environment?: BootstrapEnvironment;
}

/**
 * Read process.env through one explicit, reviewable exception to the app-template
 * config access ban. Lisa's CLI bootstrap guard must inspect externally supplied
 * build-system fingerprints before any project config is available.
 * @returns The current process environment
 */
function readProcessEnv(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- CLI bootstrap guard must read externally supplied build env vars once
  return process.env;
}

/**
 * Decide whether the Lisa apply entry point should refuse to run.
 *
 * Validate mode is intentionally exempt because it never writes project files.
 * Real apply must be explicitly opted in when running without a TTY or under a
 * known build-system fingerprint.
 * @param options - Guard options and injectable runtime state
 * @returns The skip notice when apply should be skipped, otherwise undefined
 */
export function getBootstrapApplySkipNotice(
  options: BootstrapGuardOptions
): string | undefined {
  if (options.validateOnly) return undefined;

  const environment = options.environment ?? {
    env: readProcessEnv(),
    stdinIsTTY: process.stdin.isTTY === true,
  };

  if (environment.env[LISA_BOOTSTRAP_ENV] === "1") return undefined;

  const hasBuildEnvFingerprint = BUILD_ENV_FINGERPRINTS.some(name => {
    const value = environment.env[name];
    return value !== undefined && value !== "";
  });

  if (!environment.stdinIsTTY || hasBuildEnvFingerprint) {
    return BOOTSTRAP_SKIP_NOTICE;
  }

  return undefined;
}
