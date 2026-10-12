#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const BLOCKED = 2;
const ALLOWED = 0;
const CONFIG_PATH = "harper-app/config.yaml";
const ALLOWLIST_PATH = ".lisa/harper-config-extension-allowlist.json";

const readStdin = () => {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

const parseHookInput = raw => {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const normalizePath = filePath =>
  filePath.replace(/\\/g, "/").replace(/^\.\//, "");

const isConfigPath = filePath => {
  const normalized = normalizePath(filePath);
  return normalized === CONFIG_PATH || normalized.endsWith(`/${CONFIG_PATH}`);
};

const repoRelativeConfigPath = filePath => {
  const normalized = normalizePath(filePath);
  const index = normalized.lastIndexOf(CONFIG_PATH);
  return index === -1 ? normalized : normalized.slice(index);
};

const topLevelExtensionKeys = yamlText => {
  const keys = [];
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(line) || /^---\s*$/.test(line)) continue;
    if (/^\s/.test(line)) continue;
    if (line.startsWith("!!") || ["[", "]", "{", "}"].includes(line[0])) {
      return null;
    }
    const match = line.match(/^(?:"([^"]+)"|'([^']+)'|([^:#][^:]*?)):\s*/);
    if (!match) return null;
    const key = match[1] ?? match[2] ?? match[3]?.trim();
    if (key) keys.push(key);
  }
  return Array.from(new Set(keys)).sort();
};

const gitEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );

/**
 * Milliseconds before the baseline read is presumed hung.
 *
 * A hang detector, not a budget. `git` reached through PATH on macOS goes via
 * Apple's `xcrun` shim, measured over 20 seconds under load against 11ms for a
 * real binary (CodySwannGT/lisa#2887), so a tighter deadline would make this
 * hook's own timeout the ordinary outcome on a busy machine.
 */
const GIT_BUDGET_MS = 30_000;

/** The baseline could not be read at all, as distinct from "there is none". */
const UNREADABLE = Symbol("unreadable");

/**
 * The config as HEAD holds it: its text, `null` when HEAD has no such file, or
 * `UNREADABLE` when git could not be asked.
 *
 * THE THREE ANSWERS ARE DELIBERATELY THREE. This used to be
 * `result.status === 0 ? result.stdout : null`, and `status === 0` is false for
 * a file that does not exist at HEAD **and** for a child killed at its
 * deadline — so both became `null`, and the caller reads `null` as "no baseline
 * to compare against, allow the edit". A busy machine therefore let through
 * exactly the extension removal this hook exists to block, and nothing anywhere
 * said the word "time".
 *
 * A deadline alone does not fix that. `spawnSync` does not throw when it kills
 * a child; it returns `{ status: null, stdout: "" }`, which takes the same
 * branch it always did. The discrimination has to be written, not scheduled —
 * which is why this call site needed more than the `timeout:` its siblings did.
 *
 * `ETIMEDOUT` is set by Node itself, so this is a platform fact rather than a
 * convention invented here; the shared `bounded-child.mjs` reads the same field,
 * and this hook writes it out inline because a plugin payload materialized as a
 * hook has no module to import from.
 * @param {string} repoRoot Repository root.
 * @returns {string|null|symbol} The text, `null` when absent, `UNREADABLE` when
 *   the child was killed.
 */
const readGitBlob = repoRoot => {
  const result = spawnSync(
    "git",
    ["-C", repoRoot, "show", `HEAD:${CONFIG_PATH}`],
    {
      encoding: "utf8",
      env: gitEnv(),
      killSignal: "SIGKILL",
      timeout: GIT_BUDGET_MS,
    }
  );
  if (result.error?.code === "ETIMEDOUT") return UNREADABLE;
  return result.status === 0 ? result.stdout : null;
};

const readAllowlist = (repoRoot, configPath) => {
  const allowlistFile = path.join(repoRoot, ALLOWLIST_PATH);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(allowlistFile, "utf8"));
  } catch {
    return new Set();
  }

  const entry = parsed?.[configPath] ?? parsed?.[CONFIG_PATH];
  const values = Array.isArray(entry)
    ? entry
    : Array.isArray(entry?.allowedRemovedExtensions)
      ? entry.allowedRemovedExtensions
      : [];
  return new Set(values.filter(value => typeof value === "string"));
};

const main = () => {
  const input = parseHookInput(readStdin());
  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== "string" || !isConfigPath(filePath)) return ALLOWED;

  const repoRoot = process.cwd();
  const configPath = repoRelativeConfigPath(filePath);
  let currentText;
  try {
    currentText = readFileSync(path.join(repoRoot, configPath), "utf8");
  } catch {
    return ALLOWED;
  }

  const previousText = readGitBlob(repoRoot);
  // FAIL CLOSED on "could not ask", ALLOW on "there is nothing to compare".
  // Those are different findings and only the second is safe to permit: a
  // config with no baseline at HEAD is a new file, while a baseline nobody
  // could read is an unanswered question, and a guard that permits an edit
  // because it was too busy to check has not checked.
  if (previousText === UNREADABLE) {
    process.stderr.write(
      `Blocked: could not read HEAD:${CONFIG_PATH} — git was killed after ` +
        `${String(GIT_BUDGET_MS)}ms without finishing, so the previous ` +
        `extensions are unknown. This is a timeout, not a finding: nothing ` +
        `about the edit was measured. Re-run when the machine is quieter.\n`
    );
    return BLOCKED;
  }
  if (previousText === null) return ALLOWED;

  const previousExtensions = topLevelExtensionKeys(previousText);
  const currentExtensionKeys = topLevelExtensionKeys(currentText);
  if (previousExtensions === null || currentExtensionKeys === null)
    return ALLOWED;
  const currentExtensions = new Set(currentExtensionKeys);
  const allowedRemovals = readAllowlist(repoRoot, configPath);
  const missing = previousExtensions.filter(
    extension =>
      !currentExtensions.has(extension) && !allowedRemovals.has(extension)
  );

  if (missing.length === 0) return ALLOWED;

  process.stderr
    .write(`Blocked: harper-app/config.yaml dropped required Harper extension(s).

Missing extension(s): ${missing.join(", ")}

Harper does not merge a custom config.yaml with defaults. Removing a top-level
extension silently disables that runtime surface and may only fail after deploy.
Re-add the missing extension(s), or document an intentional removal in
${ALLOWLIST_PATH}:

{
  "${CONFIG_PATH}": {
    "allowedRemovedExtensions": ["${missing[0]}"]
  }
}
`);
  return BLOCKED;
};

process.exitCode = main();
