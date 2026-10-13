/**
 * Trust findings for the session-manager doctor check (#4448), plus the file
 * and JSON helpers both halves of the check share.
 *
 * The manager dispatches Ready items to workers that run with permissions
 * bypassed, so whoever can write an item effectively runs commands on the
 * operator's machine. On a public GitHub repository that is anyone, unless
 * `sessionManager.trustedAuthorIds` limits dispatch to known authors; that
 * combination is a `fail`, not a warning. Visibility comes from an injected
 * probe (`gh repo view <repo> --json visibility` by default); when it cannot
 * run, the check warns and says why rather than guessing either way. Under
 * `lisa doctor --offline` the probe is never run (it is a network call) and the
 * check warns that visibility was not checked.
 *
 * The Telegram plugin must be enabled only through the manager's own
 * `--settings`. Enabled in a project-scope settings file (at the root or in a
 * routed child repo, where workers start), every session there would start a
 * poller and take the bot away from the manager.
 */
import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

/** A parsed JSON object (config or settings file). */
export type JsonRecord = Record<string, unknown>;

/** One finding; the check reports the worst status of all of them. */
export interface Finding {
  readonly status: "warn" | "fail";
  readonly text: string;
}

/** Returns a repo's visibility (`PUBLIC`, `PRIVATE`, `INTERNAL`) or throws. */
export type RepoVisibilityProbe = (repo: string) => Promise<string>;

const PLUGIN_ID = "telegram@claude-plugins-official";
const SETTINGS_FILES = ["settings.json", "settings.local.json"] as const;
const DEFAULT_REPOS_ROOT = "projects";
/** A child-repo key that cannot climb out of the repos root. */
const SAFE_KEY = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;
const PROBE_TIMEOUT_MS = 15_000;

const execFileAsync = promisify(execFile);

/**
 * Ask `gh` for a repository's visibility.
 * @param repo - `owner/name`
 * @returns Visibility as `gh` prints it
 */
export const ghRepoVisibility: RepoVisibilityProbe = async repo => {
  const { stdout } = await execFileAsync(
    "gh",
    ["repo", "view", repo, "--json", "visibility", "-q", ".visibility"],
    { timeout: PROBE_TIMEOUT_MS }
  );
  return stdout.trim();
};

/**
 * Whether a value is a plain JSON object.
 * @param value - Candidate value
 * @returns True for `{}`-shaped values
 */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether an error means "file does not exist".
 * @param error - Thrown value
 * @returns True for ENOENT
 */
export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * Read and parse a JSON object file, or undefined when it does not exist.
 * @param read - Text reader
 * @param file - Absolute path
 * @returns The parsed object, or undefined when absent
 */
export async function readJson(
  read: (file: string) => Promise<string>,
  file: string
): Promise<JsonRecord | undefined> {
  try {
    const parsed: unknown = JSON.parse(await read(file));
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/**
 * The file's mode, or undefined when it does not exist. Never reads contents.
 * @param statFile - Mode reader
 * @param file - Absolute path
 * @returns Mode bits, or undefined
 */
export async function modeOf(
  statFile: (file: string) => Promise<{ readonly mode: number }>,
  file: string
): Promise<number | undefined> {
  try {
    return (await statFile(file)).mode;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/**
 * Fail for a public GitHub repo whose manager would dispatch any author's
 * item; warn when visibility cannot be determined.
 * @param config - Merged top-level config (`tracker`, `github`)
 * @param block - Merged `sessionManager` block
 * @param probe - Visibility probe, or `undefined` in offline mode, where no
 *   network call may be made
 * @returns Findings
 */
export async function trustFindings(
  config: JsonRecord,
  block: JsonRecord,
  probe: RepoVisibilityProbe | undefined
): Promise<readonly Finding[]> {
  // An empty list filters no author, so it counts as unset here.
  const trusted = block.trustedAuthorIds;
  if (
    config.tracker !== "github" ||
    (Array.isArray(trusted) && trusted.length > 0)
  ) {
    return [];
  }
  const github = isRecord(config.github) ? config.github : {};
  if (typeof github.org !== "string" || typeof github.repo !== "string") {
    return [];
  }
  const repo = `${github.org}/${github.repo}`;
  if (probe === undefined) {
    return [
      {
        status: "warn",
        text: `${repo} visibility not checked (offline); if it is public, set sessionManager.trustedAuthorIds before starting the manager`,
      },
    ];
  }
  const visibility = await probe(repo).then(
    value => ({ value: value.toUpperCase(), why: undefined }),
    (error: unknown) => ({
      value: undefined,
      why: error instanceof Error ? error.message : String(error),
    })
  );
  if (visibility.why !== undefined) {
    return [
      {
        status: "warn",
        text: `could not read the visibility of ${repo} (${visibility.why}); if it is public, set sessionManager.trustedAuthorIds before starting the manager`,
      },
    ];
  }
  if (visibility.value !== "PUBLIC") return [];
  return [
    {
      status: "fail",
      text: `${repo} is public and sessionManager.trustedAuthorIds is not set, so anyone can write a Ready item that a bypass-permissions worker runs; set trustedAuthorIds to the tracker user IDs allowed to author dispatched work`,
    },
  ];
}

/**
 * Directories whose project-scope settings a manager or worker loads: the
 * root, plus each routed child repo.
 * @param root - Project root
 * @param block - Merged `sessionManager` block
 * @returns Absolute directories
 */
function settingsDirs(root: string, block: JsonRecord): readonly string[] {
  const repos = isRecord(block.repos) ? block.repos : {};
  const entries = isRecord(repos.entries) ? repos.entries : {};
  const reposRoot =
    typeof repos.root === "string" ? repos.root : DEFAULT_REPOS_ROOT;
  const base = path.resolve(root);
  const children = Object.keys(entries)
    .filter(key => SAFE_KEY.test(key))
    .map(key => path.resolve(base, reposRoot, key))
    .filter(dir => dir.startsWith(`${base}${path.sep}`));
  return [base, ...children];
}

/**
 * Warn for every project-scope settings file that enables the plugin.
 * @param root - Project root
 * @param block - Merged `sessionManager` block
 * @param read - Text reader
 * @returns Findings
 */
export async function projectPluginFindings(
  root: string,
  block: JsonRecord,
  read: (file: string) => Promise<string>
): Promise<readonly Finding[]> {
  const files = settingsDirs(root, block).flatMap(dir =>
    SETTINGS_FILES.map(name => path.join(dir, ".claude", name))
  );
  const enabled = await Promise.all(
    files.map(async file => {
      const plugins = (await readJson(read, file))?.enabledPlugins;
      return isRecord(plugins) && plugins[PLUGIN_ID] === true ? [file] : [];
    })
  );
  return enabled.flat().map(file => ({
    status: "warn" as const,
    text: `${PLUGIN_ID} is enabled in project settings ${file}, so every session there polls the bot; remove it (the manager enables it for itself)`,
  }));
}
