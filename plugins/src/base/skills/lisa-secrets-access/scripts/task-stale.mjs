/**
 * What a session bound to a ticket whose requirements went stale may still do
 * (CodySwannGT/lisa#5203).
 *
 * A bound ticket's requirements header goes stale when its context file is
 * removed, or when the project configuration changes under it (a pull of
 * `main` can do that). Until this module, a stale binding refused everything
 * except orientation, including the two ways out: a scratch file for the
 * prepare step's input, and `clear`. Only a person could end the session's
 * lockout. Both ways out change no project work, so they stay possible. All
 * other work is still refused, because a stale binding proves no access.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { taskBinding } from "./task-requirements.mjs";
import { unboundWrite } from "./task-unbound.mjs";

const owner = join(
  dirname(fileURLToPath(import.meta.url)),
  "preflight-secrets.mjs"
);
const CONTEXT = ".lisa/work-item-context.md";
const CLEAR = "scripts/lisa-work-item.mjs clear";
const shownRef =
  /^(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|[A-Z][A-Z0-9]+-\d+)$/u;

/**
 * The binding of this checkout, or null when none is readable.
 * @param {string} root Project root.
 * @returns {{ref?: unknown}|null} The binding.
 */
function binding(root) {
  try {
    return taskBinding(root) ?? null;
  } catch {
    return null;
  }
}

/**
 * The real path of a directory, or null.
 * @param {unknown} dir Directory.
 * @returns {string|null} Its real path.
 */
function real(dir) {
  try {
    return typeof dir === "string" ? realpathSync(dir) : null;
  } catch {
    return null;
  }
}

/**
 * Whether a shell command is exactly the work-item `clear` of this project.
 *
 * `clear` acts on the checkout it runs in, not the one its script lives in,
 * so it is admitted only when run from the stale checkout's root. From
 * anywhere else it would clear some other checkout's binding.
 * @param {Record<string, any>} input Hook event.
 * @param {string} root Project root.
 * @returns {boolean} True for the exact relative form, the exact absolute
 *   form, or the absolute form shell-quoted, each run from the root.
 */
function clearCommand(input, root) {
  if (input?.tool_name !== "Bash") return false;
  const command = input.tool_input?.command;
  const projectRoot = real(root);
  if (typeof command !== "string" || !projectRoot) return false;
  if (real(input.cwd) !== projectRoot) return false;
  const [script, verb] = CLEAR.split(" ");
  const absolute = join(projectRoot, script);
  return [
    `node ${CLEAR}`,
    // Unquoted only when the shell reads the path as one word.
    ...(/^[\w./@+-]+$/u.test(absolute) ? [`node ${absolute} ${verb}`] : []),
    `node '${absolute.replaceAll("'", "'\\''")}' ${verb}`,
  ].includes(command);
}

/**
 * The guard's decision for a stale binding: admit the ways out, refuse the
 * rest naming the cause and both exits. Null when nothing is bound, so the
 * caller keeps its ordinary refusal.
 * @param {Record<string, any>} input Hook event.
 * @param {{projectRoot: string}} cfg Task configuration.
 * @returns {{allowed: true}|{allowed: false, code: string, action: string}|null}
 *   The decision.
 */
export function staleBinding(input, cfg) {
  const bound = binding(cfg.projectRoot);
  if (!bound) return null;
  if (unboundWrite(input, cfg) || clearCommand(input, cfg.projectRoot))
    return { allowed: true };
  const ref =
    typeof bound.ref === "string" && shownRef.test(bound.ref)
      ? bound.ref
      : "<bound ticket>";
  const cause = existsSync(join(cfg.projectRoot, CONTEXT))
    ? `its ${CONTEXT} no longer matches this checkout (the project configuration or the file changed after it was prepared)`
    : `its ${CONTEXT} is missing`;
  return {
    allowed: false,
    code: "requirements-stale",
    action: [
      `This checkout is bound to ${ref}, but ${cause}, so no access is proved and project work is refused.`,
      `If ${ref} is still being worked on, refresh it: write {"requirements_complete": true, "required_access": []} to a file outside every repository (add "context_body" with the ticket's full text if the context file is missing), then run exactly: node ${owner} --prepare --ref ${ref} --input-file <absolute path of that file>.`,
      `If ${ref} is finished, run exactly: node ${CLEAR}, from the project root.`,
      "Reading with the Read, Grep and Glob tools, and writing a file outside every git repository, stay allowed.",
    ].join(" "),
  };
}
