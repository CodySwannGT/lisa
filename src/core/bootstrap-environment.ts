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

// Names the missing Claude Code plugin registration outright (#4504): install
// is hands-off by design, so a fresh clone has no Lisa commands until an
// explicit `lisa apply .` registers them for that folder.
const INSTALL_SKIP_NOTICE =
  "lisa: installation leaves unrelated project templates unchanged, and Claude Code " +
  "plugins are not registered by dependency install. Run `lisa apply .` in this " +
  "project to register them and apply updates, or `lisa doctor` to check freshness.";

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
  /** Whether the caller explicitly declared an install lifecycle. */
  readonly postinstall?: boolean;
  /** Whether the operator explicitly requested writes during installation. */
  readonly fullApply?: boolean;
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
 * @returns Typed skip reason and notice, otherwise undefined
 */
export function getBootstrapApplySkip(
  options: BootstrapGuardOptions
):
  | { readonly kind: "install" | "environment"; readonly notice: string }
  | undefined {
  if (options.validateOnly) return undefined;

  const environment = options.environment ?? {
    env: readProcessEnv(),
    stdinIsTTY: process.stdin.isTTY === true,
  };

  // Bun install and direct `bun run <binary>` omit the lifecycle name. Prefer
  // a conservative skip; the existing full-apply flag can explicitly opt in.
  const isUnnamedBun =
    !environment.env.npm_lifecycle_event &&
    environment.env.npm_config_user_agent?.startsWith("bun/") === true;
  const isInstall =
    options.postinstall === true ||
    environment.env.LISA_POSTINSTALL === "1" ||
    environment.env.npm_lifecycle_event === "postinstall" ||
    isUnnamedBun;
  if (isInstall && options.fullApply !== true) {
    const notice = isUnnamedBun
      ? `${
          INSTALL_SKIP_NOTICE
        } Bun did not name its lifecycle; for an intentional apply use ` +
        `\`bunx lisa apply .\` or pass \`--full-apply\`.`
      : INSTALL_SKIP_NOTICE;
    return { kind: "install", notice };
  }

  if (environment.env[LISA_BOOTSTRAP_ENV] === "1") return undefined;

  const hasBuildEnvFingerprint = BUILD_ENV_FINGERPRINTS.some(name => {
    const value = environment.env[name];
    return value !== undefined && value !== "";
  });

  if (!environment.stdinIsTTY || hasBuildEnvFingerprint) {
    return { kind: "environment", notice: BOOTSTRAP_SKIP_NOTICE };
  }

  return undefined;
}

/**
 * Preserve the public notice-only bootstrap API.
 * @param options - Guard options and injectable runtime state
 * @returns Skip notice, when any
 */
export function getBootstrapApplySkipNotice(
  options: BootstrapGuardOptions
): string | undefined {
  return getBootstrapApplySkip(options)?.notice;
}
