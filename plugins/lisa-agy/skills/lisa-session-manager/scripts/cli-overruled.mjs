/**
 * `overruled-plan`: the session manager's per-cycle sweep for items a human
 * labeled wrongly escalated (CodySwannGT/lisa#4657), and the resolver for
 * that label's configured name. The plan writes nothing: the manager routes
 * each capture's candidate to `lisa-persist-learning` in the background and
 * then posts the capture's marker comment through `lisa-tracker-write`.
 *
 * Item bodies and comments arrive on stdin or in a file, never in argv.
 * @module session-manager/cli-overruled
 */
import { readPath } from "../../../scripts/resolve-lifecycle-role.mjs";
import {
  asSetupError,
  intFlag,
  loadProject,
  stdinText,
} from "./cli-runtime.mjs";
import { parseJson, readJsonFile } from "./json-input.mjs";
import {
  DEFAULT_MAX_CAPTURES,
  DEFAULT_WRONGLY_ESCALATED_LABEL,
  WRONGLY_ESCALATED_CONFIG_PATHS,
  planOverruledCaptures,
} from "./escalation-overruled.mjs";

/**
 * The label a human applies to rule an escalation wrong, for this tracker.
 * Local config wins over global, then the built-in
 * `wrongly-escalated-to-human`, which is the same on every tracker.
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @param {string | undefined} tracker - `github`, `jira` or `linear`; the
 *   project's configured tracker when omitted
 * @returns {string} The label
 */
export function wronglyEscalatedLabel(project, tracker) {
  const vendor = tracker ?? project.local?.tracker ?? project.global?.tracker;
  const configPath = Object.hasOwn(WRONGLY_ESCALATED_CONFIG_PATHS, vendor ?? "")
    ? WRONGLY_ESCALATED_CONFIG_PATHS[vendor]
    : undefined;
  if (configPath) {
    for (const config of [project.local, project.global]) {
      const value = readPath(config, configPath);
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
  }
  return DEFAULT_WRONGLY_ESCALATED_LABEL;
}

/**
 * `overruled-plan [--input <file>] [--max <n>]` (stdin without --input:
 * `{"items":[{ref,labels,body,comments}]}`).
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{label,captures,skipped,deferred}`
 */
export function overruledPlan(ctx) {
  const input = ctx.values.input
    ? readJsonFile(ctx.values.input)
    : parseJson(stdinText(ctx, "items JSON"), "stdin");
  const project = loadProject(ctx.root);
  const max = intFlag(ctx.values.max, "--max") ?? DEFAULT_MAX_CAPTURES;
  return {
    json: asSetupError(() =>
      planOverruledCaptures({
        items: input?.items,
        label: wronglyEscalatedLabel(project, undefined),
        max,
      })
    ),
  };
}
