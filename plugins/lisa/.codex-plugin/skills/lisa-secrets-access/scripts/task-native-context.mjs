/** Native file data is consumed only by the existing fixed atomic metadata owner. */
import { lstatSync, realpathSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AccessFailure, plainObject } from "./config-layers.mjs";
import { contextData } from "./task-context-data.mjs";
import {
  REQUIREMENTS_HEADER,
  requirementsContext,
  prepareRequirements,
  taskBinding,
} from "./task-requirements.mjs";

/** Validate only selected private metadata; ordinary edits keep normal readiness. */
export function nativeContext(input, cfg) {
  const path = join(cfg.projectRoot, ".lisa/work-item-context.md"),
    data = contextData(input, path);
  if (!data) return false;
  const content = data.content,
    end = content.indexOf("\n-->\n");
  if (!content.startsWith(REQUIREMENTS_HEADER) || end < 0 || end > 65536)
    throw new AccessFailure("requirements-stale");
  let header;
  try {
    header = JSON.parse(content.slice(REQUIREMENTS_HEADER.length, end));
  } catch {
    throw new AccessFailure("requirements-stale");
  }
  const body = content.slice(end + 5),
    binding = taskBinding(cfg.projectRoot);
  if (
    !plainObject(header) ||
    header.tracker !==
      (cfg.effective.tracker ??
        binding?.provider ??
        (header.work_item_ref?.includes("#") ? "github" : undefined)) ||
    requirementsContext(
      cfg,
      header.work_item_ref,
      header.tracker,
      header.required_access,
      body
    ) !== content
  )
    throw new AccessFailure("requirements-stale");
  if (body.startsWith(REQUIREMENTS_HEADER))
    throw new AccessFailure("requirements-stale");
  let initial = false;
  try {
    lstatSync(path);
    if (realpathSync(path) !== path)
      throw new AccessFailure("requirements-stale");
  } catch (error) {
    if (error.code !== "ENOENT") throw new AccessFailure("requirements-stale");
    initial = true;
  }
  if (!initial) {
    const current = readFileSync(path, "utf8"),
      at = current.indexOf("\n-->\n");
    const oldBody =
      current.startsWith(REQUIREMENTS_HEADER) && at >= 0
        ? current.slice(at + 5)
        : current;
    if (oldBody !== body) throw new AccessFailure("requirements-stale");
  }
  prepareRequirements(cfg, header.work_item_ref, {
    requirements_complete: true,
    required_access: header.required_access,
    ...(initial ? { context_body: body } : {}),
  });
  return true;
}
