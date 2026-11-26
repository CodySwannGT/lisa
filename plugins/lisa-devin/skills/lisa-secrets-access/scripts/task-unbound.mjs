/**
 * What a session with no work item bound may still do, and what it is told.
 *
 * With no binding and no prepared context there is no task whose access could
 * be proved, so the guard refuses project work. Two things are not project
 * work and stay possible: reading (the fixed read commands the guard already
 * admits), and writing a file that lands in no git repository at all, such as
 * an agent's scratch or memory file. The refusal names the read command for
 * this installation, because an agent cannot guess an absolute plugin path.
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  configuredIssueRepository,
  issueFields,
} from "../../lisa-github-read-issue/read-contract.mjs";

const owner = join(
  dirname(fileURLToPath(import.meta.url)),
  "preflight-secrets.mjs"
);
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "write", "edit"]);
const PATCH_TARGET =
  /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.*)$/;

/**
 * The real location a path would be written to: the deepest existing
 * ancestor's real path, with the not-yet-existing remainder appended.
 * @param {string} target Absolute path.
 * @returns {string|null} Resolved location, or null when unresolvable.
 */
function realLocation(target) {
  let existing = target;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return null;
    existing = parent;
  }
  try {
    return join(realpathSync(existing), relative(existing, target));
  } catch {
    return null;
  }
}

/**
 * Whether any directory from `location` up to the root holds `.git`.
 * @param {string} location Resolved absolute path.
 * @returns {boolean} True when the path is inside a git repository.
 */
function insideRepository(location) {
  for (let dir = location; ; dir = dirname(dir)) {
    try {
      statSync(join(dir, ".git"));
      return true;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) return true;
    }
    if (dirname(dir) === dir) return false;
  }
}

/**
 * Whether a write to `target` changes no project: it resolves outside the
 * project and outside every git repository. Any doubt is a refusal.
 * @param {unknown} target The path the tool names.
 * @param {string} projectRoot This project's root.
 * @returns {boolean} True when the write touches no repository.
 */
export function outsideEveryRepository(target, projectRoot) {
  if (typeof target !== "string" || !isAbsolute(target)) return false;
  const location = realLocation(resolve(target));
  if (!location) return false;
  let root;
  try {
    root = realpathSync(projectRoot);
  } catch {
    return false;
  }
  if (location === root || location.startsWith(root + sep)) return false;
  return !insideRepository(location);
}

/**
 * Every path a file-writing tool call names, or null for any other shape.
 * @param {Record<string, any>} input Hook event.
 * @returns {string[]|null} Target paths.
 */
function writeTargets(input) {
  const args = input?.tool_input;
  if (!args || typeof args !== "object") return null;
  if (FILE_TOOLS.has(input.tool_name)) {
    const target = args.file_path ?? args.filePath;
    return typeof target === "string" ? [target] : null;
  }
  if (input.tool_name === "NotebookEdit")
    return typeof args.notebook_path === "string" ? [args.notebook_path] : null;
  if (input.tool_name === "apply_patch" && typeof args.command === "string") {
    const targets = args.command
      .split("\n")
      .map(line => PATCH_TARGET.exec(line)?.[1])
      .filter(Boolean);
    return targets.length ? targets : null;
  }
  return null;
}

/**
 * Whether an unbound session's tool call only writes outside every repository.
 * @param {Record<string, any>} input Hook event.
 * @param {{projectRoot: string}} cfg Task configuration.
 * @returns {boolean} True to admit it.
 */
export function unboundWrite(input, cfg) {
  const targets = writeTargets(input);
  return (
    targets !== null &&
    targets.every(target => outsideEveryRepository(target, cfg.projectRoot))
  );
}

/**
 * The exact read command this installation admits with no work item bound.
 * @param {Record<string, any>} cfg Task configuration.
 * @returns {string|null} Command text with a placeholder ticket, or null.
 */
function readCommand(cfg) {
  const c = cfg.effective ?? {};
  const script = /^[\w./@+-]+$/.test(owner)
    ? owner
    : `'${owner.replaceAll("'", "'\\''")}'`;
  if (c.tracker === "linear" && c.linear?.teamKey)
    return `node ${script} --tracker-intake-read --ref ${c.linear.teamKey}-<number> --read issue`;
  if (c.tracker === "jira" && c.jira?.project)
    return `node ${script} --tracker-intake-read --ref ${c.jira.project}-<number> --read issue`;
  const repo = c.github && configuredIssueRepository(c.github);
  if (repo && (!c.tracker || c.tracker === "github"))
    return `gh issue view <number> --repo ${repo} --json ${issueFields}`;
  return null;
}

/**
 * The refusal for a session with no work item bound, in plain English.
 * @param {Record<string, any>} cfg Task configuration.
 * @returns {{allowed: false, code: string, action: string}} Refusal.
 */
export function unboundRefusal(cfg) {
  const read = readCommand(cfg);
  const comments =
    read && read.includes("--read issue")
      ? " Use `--read comments` for its comments."
      : "";
  return {
    allowed: false,
    code: "work-item-unbound",
    action: [
      "No work item is bound to this checkout, so only reading is allowed.",
      "Read files with the Read, Grep and Glob tools.",
      read
        ? `Read a ticket with exactly this command, with the ticket's number in place of <number>: ${read}.${comments}`
        : "",
      "A file written outside every git repository, such as a scratch or memory file, is allowed.",
      "To change anything in this project, bind its ticket first with lisa-track.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
