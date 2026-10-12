/**
 * Doctor check for the session manager's Telegram isolation (#4448).
 *
 * The manager is the only Claude session that may poll the project's Telegram
 * bot. Two sessions polling one bot steal each other's messages, and a worker
 * that inherits the token can impersonate the manager. Setup and `start`
 * enforce isolation when they run; this check catches drift afterwards: a
 * plugin later enabled at user scope, a token copied into the shared default
 * dir, a token exported from a shell profile, a loosened file mode, or managed
 * settings that override the manager's `crossSessionInbound: accept`. Trust
 * findings (a public repo without `trustedAuthorIds`, the plugin enabled in
 * project-scope settings) live in `doctor-session-manager-trust`.
 *
 * Gated on a `sessionManager` block in the merged config (the Kane model): a
 * project that never opted in gets `ok` / "not configured" and nothing is read
 * under HOME. Token files are only ever `stat`-ed, never read, so the token
 * value cannot reach the detail text; environment values are reported by name
 * only. HOME, env, file reads and managed-settings paths are injectable so
 * tests never touch the operator's real `~/.claude`.
 */
import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { DoctorCheck } from "./doctor.js";
import {
  type Finding,
  type RepoVisibilityProbe,
  ghRepoVisibility,
  isRecord,
  modeOf,
  projectPluginFindings,
  readJson,
  trustFindings,
} from "./doctor-session-manager-trust.js";
import { mergeSessionManagerBlocks } from "./session-manager-config-merge.js";

const CHECK_NAME = "Session manager Telegram isolation?";
const PLUGIN_ID = "telegram@claude-plugins-official";
const TOKEN_FILE = ".env";
const ENV_NAMES = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_STATE_DIR"] as const;
/** Group + other permission bits are the low six bits of a file mode. */
const GROUP_OTHER_SPAN = 0o100;
/** All permission bits (owner, group, other) are the low nine. */
const PERMISSION_SPAN = 0o1000;

/** Managed settings outrank `--settings`, so they can undo the manager's. */
export const DEFAULT_MANAGED_SETTINGS_PATHS: readonly string[] = [
  "/Library/Application Support/ClaudeCode/managed-settings.json",
  "/etc/claude-code/managed-settings.json",
];

/** Collaborators for the session-manager doctor check. */
export interface SessionManagerDoctorDependencies {
  /** Environment doctor runs in; also the source of HOME by default. */
  readonly env: NodeJS.ProcessEnv;
  /** Home directory; defaults to `env.HOME`, then `os.homedir()`. */
  readonly home?: string;
  /** Text reader for JSON config and settings files. */
  readonly readFile?: (file: string) => Promise<string>;
  /** Mode reader for token files; never reads their contents. */
  readonly stat?: (file: string) => Promise<{ readonly mode: number }>;
  /** Managed-settings files to inspect, in precedence order. */
  readonly managedSettingsPaths?: readonly string[];
  /** Repo visibility probe; defaults to `gh repo view --json visibility`. */
  readonly probeRepoVisibility?: RepoVisibilityProbe;
}

/** Resolved inputs shared by the finding collectors. */
interface Context {
  readonly claudeDir: string;
  readonly sharedDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly read: (file: string) => Promise<string>;
  readonly statFile: (file: string) => Promise<{ readonly mode: number }>;
  readonly managedPaths: readonly string[];
}

/**
 * Resolve the configured state dir to an absolute path, expanding `~`.
 * @param raw - Configured `notify.stateDir`
 * @param home - Home directory
 * @param projectRoot - Base for a relative path
 * @returns Absolute path, or undefined when unset
 */
function resolveStateDir(
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
  ctx: Context,
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
async function userScopeFindings(ctx: Context): Promise<readonly Finding[]> {
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
 * Findings about the shell environment and managed settings.
 * @param ctx - Resolved inputs
 * @returns Findings
 */
async function environmentFindings(ctx: Context): Promise<readonly Finding[]> {
  const exported = ENV_NAMES.filter(name => (ctx.env[name] ?? "") !== "").map(
    name => ({
      status: "warn" as const,
      text: `${name} is set in this shell's environment, so workers may inherit it; remove the export from your shell profile`,
    })
  );
  const managed = await Promise.all(
    ctx.managedPaths.map(async file => ({
      file,
      inbound: (await readJson(ctx.read, file))?.crossSessionInbound,
    }))
  );
  const held = managed
    .filter(({ inbound }) => inbound !== undefined && inbound !== "accept")
    .map(({ file, inbound }) => ({
      status: "warn" as const,
      text: `managed settings ${file} set crossSessionInbound to ${JSON.stringify(inbound)}, which outranks the manager's "accept", so worker messages would be held`,
    }));
  return [...exported, ...held];
}

/**
 * Check Telegram isolation for a configured session manager.
 * @param targetPath - Project root
 * @param deps - Injected environment, HOME and file access
 * @returns Doctor check result
 */
export async function checkSessionManagerIsolation(
  targetPath: string,
  deps: SessionManagerDoctorDependencies
): Promise<DoctorCheck> {
  const read = deps.readFile ?? (file => fsReadFile(file, "utf8"));
  try {
    const committed = await readJson(
      read,
      path.join(targetPath, ".lisa.config.json")
    );
    const local = await readJson(
      read,
      path.join(targetPath, ".lisa.config.local.json")
    );
    const block = mergeSessionManagerBlocks(committed, local);
    if (block === undefined) {
      return { name: CHECK_NAME, status: "ok", detail: "not configured" };
    }
    const home = deps.home ?? deps.env.HOME ?? os.homedir();
    const claudeDir = deps.env.CLAUDE_CONFIG_DIR
      ? path.resolve(deps.env.CLAUDE_CONFIG_DIR)
      : path.join(home, ".claude");
    const ctx: Context = {
      claudeDir,
      sharedDir: path.join(claudeDir, "channels", "telegram"),
      env: deps.env,
      read,
      statFile: deps.stat ?? fsStat,
      managedPaths: deps.managedSettingsPaths ?? DEFAULT_MANAGED_SETTINGS_PATHS,
    };
    const notify = isRecord(block.notify) ? block.notify : {};
    const stateDir = resolveStateDir(notify.stateDir, home, targetPath);
    const findings = [
      ...(await stateDirFindings(ctx, stateDir)),
      ...(await userScopeFindings(ctx)),
      ...(await environmentFindings(ctx)),
      ...(await projectPluginFindings(targetPath, block, read)),
      ...(await trustFindings(
        { ...committed, ...local },
        block,
        deps.probeRepoVisibility ?? ghRepoVisibility
      )),
    ];
    if (findings.length === 0) {
      return {
        name: CHECK_NAME,
        status: "ok",
        detail: `isolated: per-project state dir ${String(stateDir)}, token file mode 0600 or tighter, plugin not enabled at user scope`,
      };
    }
    return {
      name: CHECK_NAME,
      status: findings.some(f => f.status === "fail") ? "fail" : "warn",
      detail: findings.map(f => f.text).join("; "),
    };
  } catch (error) {
    return {
      name: CHECK_NAME,
      status: "warn",
      detail: `could not evaluate session-manager isolation: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
