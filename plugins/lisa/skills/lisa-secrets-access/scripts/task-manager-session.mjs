/**
 * The session manager in a Lisa-managed project (CodySwannGT/lisa#5211).
 *
 * The readiness gate refuses project work from a session with no ticket
 * bound. The session manager binds no ticket by design: it hands tickets to
 * workers, and each worker binds its own. Its work is operational: reading
 * the queue, spawning workers, writing its ledger. So two things are
 * admitted here with no ticket bound.
 *
 * - The manager's own session. `start` marks it at launch with
 *   `LISA_SESSION_MANAGER=<name>`. Hooks inherit the Claude process's
 *   environment, which a Bash `export` inside the session cannot change, and
 *   workers are spawned without the mark. The mark must equal the project's
 *   configured `sessionManager.name`. The session may do anything except edit
 *   project files: a file-edit tool aimed inside the repository is admitted
 *   only under `.lisa/`, where the manager keeps its state.
 * - The operator's exact `start`, `stop`, `status` and `validate` commands,
 *   from any session, so an operator can run and check on the manager.
 *
 * Nothing here imports the session-manager skill, which is not shipped to
 * every agent: a missing import would fail the whole gate closed.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  outsideEveryRepository,
  realLocation,
  writeTargets,
} from "./task-unbound.mjs";

/** This install's session-manager CLI, beside this skill. */
export const MANAGER_CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "lisa-session-manager",
  "scripts",
  "session-manager.mjs"
);
const OPERATOR = ["start", "stop", "status", "validate"];
const EDIT_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "apply_patch",
  "write",
  "edit",
]);

/**
 * One parsed config file, or undefined when absent or unreadable.
 * @param {string} path File path.
 * @returns {Record<string, any>|undefined} Parsed object.
 */
function readJson(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The project's configured manager name, local config over committed.
 * @param {string} root Project root.
 * @returns {string|null} The name, or null when none is configured.
 */
export function managerName(root) {
  const name = [".lisa.config.local.json", ".lisa.config.json"]
    .map(file => readJson(join(root, file))?.sessionManager?.name)
    .find(value => value !== undefined);
  return typeof name === "string" && name !== "" ? name : null;
}

/**
 * Whether a resolved path is inside the project's `.lisa/` folder.
 * @param {string} target Absolute path the tool names.
 * @param {string} root Project root.
 * @returns {boolean} True for a path under `.lisa/`.
 */
function underLisaFolder(target, root) {
  const location = realLocation(resolve(target));
  let lisa;
  try {
    lisa = join(realpathSync(root), ".lisa");
  } catch {
    return false;
  }
  return Boolean(location?.startsWith(lisa + sep));
}

/**
 * Whether this event comes from the project's marked manager session, and
 * is not an edit to a project file.
 * @param {Record<string, any>} input Hook event.
 * @param {{projectRoot: string}} cfg Task configuration.
 * @param {Record<string, string|undefined>} [env] Session environment.
 * @returns {boolean} True to admit it.
 */
export function managerSession(input, cfg, env = process.env) {
  const mark = env.LISA_SESSION_MANAGER;
  if (!mark || mark !== managerName(cfg.projectRoot)) return false;
  if (!EDIT_TOOLS.has(input?.tool_name)) return true;
  const targets = writeTargets(input);
  return (
    targets !== null &&
    targets.every(
      target =>
        outsideEveryRepository(target, cfg.projectRoot) ||
        underLisaFolder(target, cfg.projectRoot)
    )
  );
}

/**
 * A path as the one shell word that names it.
 * @param {string} path Absolute path.
 * @returns {string[]} The plain form when the shell reads it as one word,
 *   and always the single-quoted form.
 */
function words(path) {
  const quoted = `'${path.replaceAll("'", "'\\''")}'`;
  return /^[\w./@+-]+$/u.test(path) ? [path, quoted] : [quoted];
}

/**
 * The exact operator commands for this project, as the agent should type them.
 * @param {string} root Project root.
 * @returns {string[]} Admitted command texts; empty when the CLI is absent.
 */
export function operatorCommands(root) {
  if (!existsSync(MANAGER_CLI)) return [];
  let real;
  try {
    real = realpathSync(root);
  } catch {
    return [];
  }
  return words(MANAGER_CLI).flatMap(cli =>
    OPERATOR.flatMap(verb =>
      words(real).map(dir => `node ${cli} ${verb} --project-root ${dir}`)
    )
  );
}

/**
 * Whether a shell command is exactly one of the operator commands.
 * @param {Record<string, any>} input Hook event.
 * @param {{projectRoot: string}} cfg Task configuration.
 * @returns {boolean} True to admit it.
 */
export function operatorCommand(input, cfg) {
  if (input?.tool_name !== "Bash") return false;
  const command = input.tool_input?.command;
  return (
    typeof command === "string" &&
    operatorCommands(cfg.projectRoot).includes(command)
  );
}

/**
 * The sentence an unbound refusal adds, naming the operator commands.
 * @param {{projectRoot: string}} cfg Task configuration.
 * @returns {string} The sentence, or "" when the CLI is absent.
 */
export function operatorHint(cfg) {
  const [first] = operatorCommands(cfg.projectRoot);
  if (!first) return "";
  const shape = first.replace(
    " start --project-root ",
    " <start|stop|status|validate> --project-root "
  );
  return `To start, stop or check on the session manager, which needs no ticket, run exactly: ${shape}.`;
}
