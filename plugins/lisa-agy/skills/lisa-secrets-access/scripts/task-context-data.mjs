/** Two exact native data envelopes for one fixed metadata destination. No patch executor. */
import { AccessFailure, plainObject } from "./config-layers.mjs";
import { realpathSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
const fail = () => {
  throw new AccessFailure("requirements-stale");
};
/** Select only operations naming the private destination or a filesystem alias. */
function contextTarget(name, path, cwd) {
  const absolute = resolve(cwd, name);
  if (absolute === path) return true;
  try {
    if (realpathSync(absolute) === path) return true;
  } catch {
    /* An absent source file is ordinary. */
  }
  try {
    return (
      resolve(realpathSync(dirname(absolute)), basename(absolute)) === path
    );
  } catch {
    return false;
  }
}
function touchesContext(command, path, cwd) {
  return command.split("\n").some(line => {
    const operation =
      /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.*)$/.exec(line);
    return operation && contextTarget(operation[1], path, cwd);
  });
}
/** Decode a single whole Add File, whose documented result always ends in LF. */
function addedContext(command, path) {
  if (typeof command !== "string") fail();
  const lines = command.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (
    lines[0] !== "*** Begin Patch" ||
    lines[1] !== `*** Add File: ${path}` ||
    lines.at(-1) !== "*** End Patch"
  )
    fail();
  const data = lines.slice(2, -1);
  if (!data.length || data.some(line => !line.startsWith("+"))) fail();
  return data.map(line => line.slice(1)).join("\n") + "\n";
}
/** Keep the canonical tool name; only payload data is normalized for validation. */
export function contextData(input, path) {
  const data = input?.tool_input;
  if (input?.tool_name === "Write") {
    if (
      !plainObject(data) ||
      typeof data.file_path !== "string" ||
      !contextTarget(data.file_path, path, input.cwd ?? dirname(dirname(path)))
    )
      return null;
    if (data.file_path !== path) fail();
    if (
      Object.keys(data).sort().join() !== "content,file_path" ||
      typeof data.content !== "string"
    )
      fail();
    return data;
  }
  if (input?.tool_name !== "apply_patch") return null;
  // Non-metadata patches receive no grant here: normal task readiness decides.
  if (
    !plainObject(data) ||
    typeof data.command !== "string" ||
    !touchesContext(data.command, path, input.cwd ?? dirname(dirname(path)))
  )
    return null;
  if (!plainObject(data) || Object.keys(data).join() !== "command") fail();
  return { file_path: path, content: addedContext(data.command, path) };
}
