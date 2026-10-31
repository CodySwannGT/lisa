/**
 * Telegram findings for the session-manager notifications doctor check
 * (#4448), split out of `doctor-session-manager` when Telegram became optional
 * (#4555). With no notification channel only {@link plaintextTokenFindings}
 * runs: a plaintext token is worth flagging whether or not a bot is set up.
 *
 * The manager is the only Claude session that may poll the project's Telegram
 * bot. Two sessions polling one bot steal each other's messages, and a worker
 * that inherits the token can impersonate the manager. Setup and `start`
 * enforce isolation when they run; these findings catch drift afterwards: a
 * plugin later enabled at user scope, a token copied into the shared default
 * dir, a token exported from a shell profile, or a loosened file mode.
 *
 * Where the token lives (#4555): with a secrets provider configured
 * (`secrets.provider` set and not `env`) it belongs in the provider as
 * `TELEGRAM_BOT_TOKEN_<NAME>`, so a plaintext token file in the state dir is
 * a leftover that `store-token` migrates (and `start` refuses to run
 * beside). With no provider that file is still how the token is stored, and
 * it is flagged as plaintext. Doctor never reads the vault: it cannot prove
 * the secret exists, only that no plaintext copy is left.
 *
 * Token files are only ever `stat`-ed, never read, so the token value cannot
 * reach the detail text; environment values are reported by name only.
 */
import * as path from "node:path";
import {
  type Finding,
  isRecord,
  modeOf,
  readJson,
} from "./doctor-session-manager-trust.js";

const PLUGIN_ID = "telegram@claude-plugins-official";
const TOKEN_FILE = ".env";
/** The plugin's token variable; any `TELEGRAM_BOT_TOKEN*` name is flagged. */
const TOKEN_VAR = "TELEGRAM_BOT_TOKEN";
const STATE_DIR_VAR = "TELEGRAM_STATE_DIR";
/** Group + other permission bits are the low six bits of a file mode. */
const GROUP_OTHER_SPAN = 0o100;
/** All permission bits (owner, group, other) are the low nine. */
const PERMISSION_SPAN = 0o1000;

/** Resolved inputs the Telegram findings read. */
export interface TelegramContext {
  readonly claudeDir: string;
  readonly sharedDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly read: (file: string) => Promise<string>;
  readonly statFile: (file: string) => Promise<{ readonly mode: number }>;
  /** The configured secrets provider, or undefined when none (or `env`). */
  readonly secretsProvider: string | undefined;
  /** The provider secret name for this manager. */
  readonly secretName: string;
}

/**
 * The provider secret name for a manager: `TELEGRAM_BOT_TOKEN_<NAME>` with
 * the name upper-snaked. Must agree with the session-manager CLI's
 * `telegramSecretName` (token-store.mjs); a test pins the two together.
 * @param managerName - `sessionManager.name`
 * @returns Secret name
 */
export function telegramSecretNameFor(managerName: unknown): string {
  const suffix = String(managerName)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_");
  return `${TOKEN_VAR}_${suffix}`;
}

/**
 * The secrets provider the session-manager CLI will use for this project, or
 * undefined when it uses none (`env`, or no provider at all). Decided exactly
 * the way the CLI's `loadTokenSecrets` does through `lisa-secrets-access`'s
 * `readConfig`: only the committed `.lisa.config.json` counts (the local
 * override is never read for `secrets`), its `secrets.provider` defaulting
 * to `env`; with no committed file at all, the environment fallback
 * (`LISA_TENANT` or `LISA_SECRETS_NAMESPACE` names a tenant, and
 * `LISA_PROVIDER` / `LISA_SECRETS_PROVIDER` its provider, default
 * `bitwarden`). A test pins this to the CLI. Known gap: with no config file
 * at the root the CLI also looks under `LISA_PROJECT_DIR` /
 * `CLAUDE_PROJECT_DIR`; doctor only looks at the project it was pointed at.
 * @param targetPath - Project root
 * @param read - Text reader
 * @param env - Doctor's environment
 * @returns Provider name, or undefined for none
 */
export async function secretsProviderAt(
  targetPath: string,
  read: (file: string) => Promise<string>,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  const committed = await readJson(
    read,
    path.join(targetPath, ".lisa.config.json")
  );
  const provider =
    committed === undefined
      ? providerFromEnvironment(env)
      : committedProvider(committed);
  return provider === "env" ? undefined : provider;
}

/**
 * `secrets.provider` in the committed config, defaulting to `env`.
 * @param committed - Parsed `.lisa.config.json`
 * @returns Provider name
 */
function committedProvider(committed: Record<string, unknown>): string {
  const secrets = committed.secrets;
  const provider = isRecord(secrets) ? secrets.provider : undefined;
  return typeof provider === "string" ? provider : "env";
}

/**
 * The provider `readConfig` falls back to with no config file.
 * @param env - Environment
 * @returns Provider name (`env` when no tenant is named)
 */
function providerFromEnvironment(env: NodeJS.ProcessEnv): string {
  const tenant = (env.LISA_TENANT ?? env.LISA_SECRETS_NAMESPACE ?? "").trim();
  if (tenant === "") return "env";
  const named = (env.LISA_PROVIDER ?? env.LISA_SECRETS_PROVIDER ?? "").trim();
  return named === "" ? "bitwarden" : named;
}

/**
 * Resolve the configured state dir to an absolute path, expanding `~`.
 * @param raw - Configured `notify.stateDir`
 * @param home - Home directory
 * @param projectRoot - Base for a relative path
 * @returns Absolute path, or undefined when unset
 */
export function resolveStateDir(
  raw: unknown,
  home: string,
  projectRoot: string
): string | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const dir = raw.trim();
  if (dir === "~") return home;
  if (dir.startsWith("~/")) return path.resolve(home, dir.slice(2));
  return path.resolve(projectRoot, dir);
}

/**
 * Findings about the configured per-project state dir and its token file.
 * @param ctx - Resolved inputs
 * @param stateDir - Absolute state dir, or undefined when unset
 * @returns Findings
 */
async function stateDirFindings(
  ctx: TelegramContext,
  stateDir: string | undefined
): Promise<readonly Finding[]> {
  if (stateDir === undefined) {
    return [
      {
        status: "fail",
        text: "sessionManager.notify.stateDir is not set; run /lisa:setup:session-manager to give this project its own Telegram state dir",
      },
    ];
  }
  if (stateDir === ctx.sharedDir) {
    return [
      {
        status: "fail",
        text: `notify.stateDir is the shared default ${ctx.sharedDir}, so every Telegram session on this machine would poll one bot; point it at a per-project dir such as ${ctx.sharedDir}-<project>`,
      },
    ];
  }
  return tokenFileFindings(ctx, path.join(stateDir, TOKEN_FILE));
}

/**
 * Findings about the plaintext token file, which means different things with
 * and without a secrets provider.
 * @param ctx - Resolved inputs
 * @param tokenFile - The token file in the state dir
 * @returns Findings
 */
async function tokenFileFindings(
  ctx: TelegramContext,
  tokenFile: string
): Promise<readonly Finding[]> {
  const mode = await modeOf(ctx.statFile, tokenFile);
  const provider = ctx.secretsProvider;
  if (provider !== undefined) {
    return mode === undefined
      ? []
      : [
          {
            status: "warn",
            text: `a plaintext token file ${tokenFile} is left over, but the token belongs in ${provider} as ${ctx.secretName}; run session-manager.mjs store-token to move it there (it verifies the copy, then deletes the file), because start refuses to run while it exists`,
          },
        ];
  }
  if (mode === undefined) {
    return [
      {
        status: "warn",
        text: `token file ${tokenFile} is missing, so the manager cannot start; store the bot token with /lisa:setup:session-manager`,
      },
    ];
  }
  const plaintext: Finding = {
    status: "warn",
    text: `token file ${tokenFile} holds the bot token in plaintext because no secrets provider is configured; configure secrets.provider (see lisa-secrets-access), then run session-manager.mjs store-token to move it into the provider`,
  };
  if (mode % GROUP_OTHER_SPAN === 0) return [plaintext];
  const octal = (mode % PERMISSION_SPAN).toString(8).padStart(3, "0");
  return [
    plaintext,
    {
      status: "warn",
      text: `token file ${tokenFile} has mode 0${octal}, open to other users; run chmod 600 ${tokenFile}`,
    },
  ];
}

/**
 * Findings about the user-scope plugin and the shared default token file.
 * @param ctx - Resolved inputs
 * @returns Findings
 */
async function userScopeFindings(
  ctx: TelegramContext
): Promise<readonly Finding[]> {
  const settings = await readJson(
    ctx.read,
    path.join(ctx.claudeDir, "settings.json")
  );
  const plugins = settings?.enabledPlugins;
  const sharedToken = path.join(ctx.sharedDir, TOKEN_FILE);
  return [
    ...(isRecord(plugins) && plugins[PLUGIN_ID] === true
      ? [
          {
            status: "warn" as const,
            text: `${PLUGIN_ID} is enabled at user scope, so every Claude session polls the bot; run claude plugin disable ${PLUGIN_ID} -s user (the manager enables it for itself)`,
          },
        ]
      : []),
    ...((await modeOf(ctx.statFile, sharedToken)) === undefined
      ? []
      : [
          {
            status: "warn" as const,
            text: `a token file exists in the shared default dir (${sharedToken}); move it to the per-project state dir and delete it`,
          },
        ]),
  ];
}

/**
 * Findings for Telegram variables exported in doctor's own shell.
 * @param env - Doctor's environment
 * @param includeStateDir - Also flag `TELEGRAM_STATE_DIR` (Telegram only)
 * @returns Findings, naming each variable but never its value
 */
function exportedFindings(
  env: NodeJS.ProcessEnv,
  includeStateDir = true
): readonly Finding[] {
  return Object.keys(env)
    .filter(
      name =>
        (includeStateDir && name === STATE_DIR_VAR) ||
        name.startsWith(TOKEN_VAR)
    )
    .filter(name => (env[name] ?? "") !== "")
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({
      status: "warn" as const,
      text: `${name} is set in this shell's environment, so workers may inherit it; remove the export from your shell profile`,
    }));
}

/**
 * The plaintext-token findings that hold with no notification channel too
 * (the spec's "doctor flags any plaintext token file it finds"): an exported
 * `TELEGRAM_BOT_TOKEN*` variable, by name only, and a token file in the
 * shared Telegram state dir, by existence only (never read). The Telegram
 * requirements themselves (state dir, plugin scope, `TELEGRAM_STATE_DIR`)
 * are skipped, since no bot is configured.
 * @param ctx - The shared dir, environment and mode reader
 * @returns Findings
 */
export async function plaintextTokenFindings(
  ctx: Pick<TelegramContext, "sharedDir" | "env" | "statFile">
): Promise<readonly Finding[]> {
  const sharedToken = path.join(ctx.sharedDir, TOKEN_FILE);
  return [
    ...exportedFindings(ctx.env, false),
    ...((await modeOf(ctx.statFile, sharedToken)) === undefined
      ? []
      : [
          {
            status: "warn" as const,
            text: `a plaintext Telegram token file exists in the shared dir (${sharedToken}); no notification channel is configured, so nothing needs it: delete it`,
          },
        ]),
  ];
}

/**
 * Every Telegram finding: the state dir and its token file, the user-scope
 * plugin and shared default dir, and exported Telegram variables.
 * @param ctx - Resolved inputs
 * @param stateDir - Absolute state dir, or undefined when unset
 * @returns Findings
 */
export async function telegramFindings(
  ctx: TelegramContext,
  stateDir: string | undefined
): Promise<readonly Finding[]> {
  return [
    ...(await stateDirFindings(ctx, stateDir)),
    ...(await userScopeFindings(ctx)),
    ...exportedFindings(ctx.env),
  ];
}
