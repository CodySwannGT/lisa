#!/usr/bin/env node
import { createRequire } from "node:module";
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

const loadYaml = () => {
  const require = createRequire(import.meta.url);
  return require("js-yaml");
};

const topLevelExtensionKeys = yamlText => {
  const yaml = loadYaml();
  let parsed;
  try {
    parsed = yaml.load(yamlText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.keys(parsed).sort();
};

const gitEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );

const readGitBlob = repoRoot => {
  const result = spawnSync(
    "git",
    ["-C", repoRoot, "show", `HEAD:${CONFIG_PATH}`],
    {
      encoding: "utf8",
      env: gitEnv(),
    }
  );
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
