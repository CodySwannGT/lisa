/**
 * Doctor check for the session manager's notification channel (#4448,
 * #4555).
 *
 * Telegram is optional. With no channel (`notify.provider` `"none"`, or no
 * `notify` block) there is no bot, token, state dir or plugin to check, so the
 * check reports "notifications: none" and runs only the findings that matter
 * either way: managed settings that override the manager's
 * `crossSessionInbound: accept`, and the trust findings (a public repo
 * without `trustedAuthorIds`). With Telegram it also runs the isolation
 * findings in `doctor-session-manager-token` (state dir, where the bot token
 * lives: a leftover plaintext file with a secrets provider configured, or a
 * plaintext file because none is, and its mode; user-scope plugin, shared
 * default dir, exported variables) and the
 * project-scope plugin finding. An unsupported provider, or a `stateDir`
 * without the telegram provider, fails the way the runtime validator refuses
 * it.
 *
 * Gated on a `sessionManager` block in the merged config (the Kane model): a
 * project that never opted in gets `ok` / "not configured" and nothing is read
 * under HOME. HOME, env, file reads and managed-settings paths are injectable
 * so tests never touch the operator's real `~/.claude`.
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
  projectPluginFindings,
  readJson,
  trustFindings,
} from "./doctor-session-manager-trust.js";
import {
  resolveStateDir,
  secretsProviderOf,
  telegramFindings,
  telegramSecretNameFor,
} from "./doctor-session-manager-token.js";
import { mergeSessionManagerBlocks } from "./session-manager-config-merge.js";

const CHECK_NAME = "Session manager notifications?";
/** Detail for a valid setup with no notification channel. */
const NO_CHANNEL = "notifications: none";
const PROVIDERS = ["none", "telegram"] as const;

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

/** The doctor options this check honours. */
export interface SessionManagerDoctorOptions {
  /** `lisa doctor --offline`: skip the visibility probe, a network call. */
  readonly offline?: boolean;
}

/** The notification mode a block runs with, or why it cannot run. */
interface NotifyMode {
  /** The provider, or undefined when the block cannot run as declared. */
  readonly provider: (typeof PROVIDERS)[number] | undefined;
  readonly problems: readonly Finding[];
}

/**
 * Read the notification provider the way the runtime validator does: absent
 * or `"none"` is no channel, `"telegram"` is the bot, anything else fails, and
 * a `stateDir` without telegram fails because no bot would use it.
 * @param notify - The merged `notify` block, or `{}`
 * @returns The provider (undefined when the block cannot run) and problems
 */
function notifyMode(notify: Record<string, unknown>): NotifyMode {
  const raw = notify.provider ?? "none";
  const provider = PROVIDERS.find(name => name === raw);
  if (provider === undefined) {
    return {
      provider,
      problems: [
        {
          status: "fail",
          text: `sessionManager.notify.provider ${JSON.stringify(raw)} is not supported; use "none" (no notification channel) or "telegram"`,
        },
      ],
    };
  }
  if (provider === "none" && notify.stateDir !== undefined) {
    return {
      provider: undefined,
      problems: [
        {
          status: "fail",
          text: 'sessionManager.notify.stateDir is set, but notify.provider is not "telegram", so no bot would use it; set notify.provider to "telegram" or remove notify.stateDir',
        },
      ],
    };
  }
  return { provider, problems: [] };
}

/**
 * Findings about managed settings, which outrank the manager's `--settings`
 * whether or not it has a notification channel.
 * @param read - Text reader
 * @param managedPaths - Managed-settings files, in precedence order
 * @returns Findings
 */
async function managedFindings(
  read: (file: string) => Promise<string>,
  managedPaths: readonly string[]
): Promise<readonly Finding[]> {
  const managed = await Promise.all(
    managedPaths.map(async file => ({
      file,
      inbound: (await readJson(read, file))?.crossSessionInbound,
    }))
  );
  return managed
    .filter(({ inbound }) => inbound !== undefined && inbound !== "accept")
    .map(({ file, inbound }) => ({
      status: "warn" as const,
      text: `managed settings ${file} set crossSessionInbound to ${JSON.stringify(inbound)}, which outranks the manager's "accept", so worker messages would be held`,
    }));
}

/**
 * The home directory doctor resolves `~` against.
 * @param deps - Injected environment and HOME
 * @returns Home directory
 */
function homeOf(deps: SessionManagerDoctorDependencies): string {
  return deps.home ?? deps.env.HOME ?? os.homedir();
}

/**
 * The Telegram-only findings, run only when Telegram is the channel.
 * @param targetPath - Project root
 * @param block - Merged `sessionManager` block
 * @param deps - Injected environment, HOME and file access
 * @param read - Text reader
 * @param secretsProvider - Configured secrets provider, undefined for none
 * @returns Findings
 */
async function channelFindings(
  targetPath: string,
  block: Record<string, unknown>,
  deps: SessionManagerDoctorDependencies,
  read: (file: string) => Promise<string>,
  secretsProvider: string | undefined
): Promise<readonly Finding[]> {
  const home = homeOf(deps);
  const claudeDir = deps.env.CLAUDE_CONFIG_DIR
    ? path.resolve(deps.env.CLAUDE_CONFIG_DIR)
    : path.join(home, ".claude");
  const notify = isRecord(block.notify) ? block.notify : {};
  const stateDir = resolveStateDir(notify.stateDir, home, targetPath);
  return [
    ...(await telegramFindings(
      {
        claudeDir,
        sharedDir: path.join(claudeDir, "channels", "telegram"),
        env: deps.env,
        read,
        statFile: deps.stat ?? fsStat,
        secretsProvider,
        secretName: telegramSecretNameFor(block.name),
      },
      stateDir
    )),
    ...(await projectPluginFindings(targetPath, block, read)),
  ];
}

/** Where the bot token lives, for the telegram ok detail. */
interface TokenHome {
  readonly stateDir: string | undefined;
  readonly secretsProvider: string | undefined;
  readonly secretName: string;
}

/**
 * The ok detail for a clean Telegram setup. With a provider, doctor can only
 * say no plaintext copy is left: it never reads the vault (#4555).
 * @param token - Where the token lives
 * @returns Detail text
 */
function telegramOkDetail(token: TokenHome): string {
  const where =
    token.secretsProvider === undefined
      ? "token file mode 0600 or tighter"
      : `bot token kept in ${token.secretsProvider} as ${token.secretName} with no plaintext copy (doctor never reads the vault, so the secret itself is not checked)`;
  return `isolated: per-project state dir ${String(token.stateDir)}, ${where}, plugin not enabled at user scope`;
}

/**
 * The check's verdict once every finding is in.
 * @param provider - Notification provider, undefined when unsupported
 * @param findings - Every finding
 * @param token - Where the bot token lives, for the telegram ok detail
 * @returns Doctor check result
 */
function verdict(
  provider: NotifyMode["provider"],
  findings: readonly Finding[],
  token: TokenHome
): DoctorCheck {
  if (findings.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: provider === "none" ? NO_CHANNEL : telegramOkDetail(token),
    };
  }
  const text = findings.map(f => f.text).join("; ");
  return {
    name: CHECK_NAME,
    status: findings.some(f => f.status === "fail") ? "fail" : "warn",
    detail: provider === "none" ? `${NO_CHANNEL}; ${text}` : text,
  };
}

/**
 * Check the notification channel of a configured session manager.
 * @param targetPath - Project root
 * @param deps - Injected environment, HOME and file access
 * @param options - Doctor options; `offline` skips the visibility probe
 * @returns Doctor check result
 */
export async function checkSessionManagerIsolation(
  targetPath: string,
  deps: SessionManagerDoctorDependencies,
  options: SessionManagerDoctorOptions = {}
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
    const notify = isRecord(block.notify) ? block.notify : {};
    const mode = notifyMode(notify);
    const secretsProvider = secretsProviderOf({ ...committed, ...local });
    const findings = [
      ...mode.problems,
      ...(mode.provider === "telegram"
        ? await channelFindings(targetPath, block, deps, read, secretsProvider)
        : []),
      ...(await managedFindings(
        read,
        deps.managedSettingsPaths ?? DEFAULT_MANAGED_SETTINGS_PATHS
      )),
      ...(await trustFindings(
        { ...committed, ...local },
        block,
        options.offline === true
          ? undefined
          : (deps.probeRepoVisibility ?? ghRepoVisibility)
      )),
    ];
    return verdict(mode.provider, findings, {
      stateDir: resolveStateDir(notify.stateDir, homeOf(deps), targetPath),
      secretsProvider,
      secretName: telegramSecretNameFor(block.name),
    });
  } catch (error) {
    return {
      name: CHECK_NAME,
      status: "warn",
      detail: `could not evaluate the session-manager notifications: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
