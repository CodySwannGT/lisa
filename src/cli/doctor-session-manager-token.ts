/**
 * Telegram findings for the session-manager notifications doctor check
 * (#4448), split out of `doctor-session-manager` when Telegram became optional
 * (#4555). None of these run when the manager has no notification channel.
 *
 * The manager is the only Claude session that may poll the project's Telegram
 * bot. Two sessions polling one bot steal each other's messages, and a worker
 * that inherits the token can impersonate the manager. Setup and `start`
 * enforce isolation when they run; these findings catch drift afterwards: a
 * plugin later enabled at user scope, a token copied into the shared default
 * dir, a token exported from a shell profile, or a loosened file mode.
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
const ENV_NAMES = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_STATE_DIR"] as const;
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
  const tokenFile = path.join(stateDir, TOKEN_FILE);
  const mode = await modeOf(ctx.statFile, tokenFile);
  if (mode === undefined) {
    return [
      {
        status: "warn",
        text: `token file ${tokenFile} is missing, so the manager cannot start; store the bot token with /lisa:setup:session-manager`,
      },
    ];
  }
  if (mode % GROUP_OTHER_SPAN === 0) return [];
  const octal = (mode % PERMISSION_SPAN).toString(8).padStart(3, "0");
  return [
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
 * @param ctx - Resolved inputs
 * @returns Findings, naming each variable but never its value
 */
function exportedFindings(ctx: TelegramContext): readonly Finding[] {
  return ENV_NAMES.filter(name => (ctx.env[name] ?? "") !== "").map(name => ({
    status: "warn" as const,
    text: `${name} is set in this shell's environment, so workers may inherit it; remove the export from your shell profile`,
  }));
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
    ...exportedFindings(ctx),
  ];
}
