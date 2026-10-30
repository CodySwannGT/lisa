/** Filesystem layer states: missing entries differ from inaccessible targets. */
import { lstatSync, statSync, readFileSync } from "node:fs";
import { AccessFailure, validateConfigLayer } from "./config-layers.mjs";

/** A declared symlink whose target cannot be read is never an absent layer. */
export function inspectConfigPath(path) {
  let entry;
  try {
    entry = lstatSync(path);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return null;
    throw new AccessFailure("config-unreadable");
  }
  if (!entry.isSymbolicLink()) return entry;
  try {
    return statSync(path);
  } catch {
    throw new AccessFailure("config-unreadable");
  }
}

/** Read all present layers, reporting only typed failures, never parse text. */
export function readConfigLayer(path) {
  if (!inspectConfigPath(path)) return { status: "absent", path };
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new AccessFailure("config-unreadable");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AccessFailure("config-invalid");
  }
  return { status: "valid", path, value: validateConfigLayer(value) };
}
