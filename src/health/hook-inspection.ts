/** Installed and executable Git-hook inspection without running hooks. */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns -- typed hook readers are self-describing */
import { execFile } from "node:child_process";
import path from "node:path";
import { inspectRailsHooks } from "../../scripts/lib/rails-hooks.mjs";

import type { ProjectType } from "../core/config.js";
import { readProjectFile } from "./read-only-fs.js";

const GIT_TIMEOUT_MS = 10_000;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024;
const HUSKY_HOOKS = [
  "commit-msg",
  "post-checkout",
  "pre-commit",
  "pre-push",
  "prepare-commit-msg",
] as const;

/**
 * Injectable reader for repository-local core.hooksPath. Implementations must
 * honor `signal` and release any owned handles before settling.
 */
export type HooksPathReader = (
  projectRoot: string,
  timeoutMs: number,
  signal: AbortSignal
) => Promise<string | undefined>;

/** Hook installation outcome. */
export type HookInstallationInspection =
  | { readonly status: "pass"; readonly drift: readonly string[] }
  | { readonly status: "warn"; readonly drift: readonly string[] }
  | { readonly status: "fail"; readonly drift: readonly string[] };

/**
 * Default fixed-argv local git-config reader.
 * @param projectRoot
 * @param timeoutMs
 * @param signal
 */
export const readCoreHooksPath: HooksPathReader = async (
  projectRoot,
  timeoutMs,
  signal
) =>
  new Promise((resolve, reject) => {
    execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed git executable
      "git",
      ["config", "--local", "--get", "core.hooksPath"],
      {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        signal,
        killSignal: "SIGKILL",
        timeout: Math.max(1, Math.min(timeoutMs, GIT_TIMEOUT_MS)),
      },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout.trim() || undefined);
          return;
        }
        if ((error as unknown as { code?: string | number }).code === 1) {
          resolve(undefined);
          return;
        }
        reject(error);
      }
    );
  });

/**
 * Check executable regular files under one project-relative prefix.
 * @param projectRoot
 * @param prefix
 * @param names
 */
async function executableDrift(
  projectRoot: string,
  prefix: string,
  names: readonly string[]
): Promise<readonly string[]> {
  const checks = await Promise.all(
    names.map(async name => {
      const relative = path.join(prefix, name);
      const file = await readProjectFile(projectRoot, relative);
      return file !== undefined && (file.mode & 0o100) !== 0
        ? undefined
        : relative.split(path.sep).join("/");
    })
  );
  return checks.filter((item): item is string => item !== undefined);
}

/**
 * Inspect actual installed hook state for applicable stacks.
 * @param projectRoot - Canonical host root
 * @param types - Safely detected project types
 * @param reader - core.hooksPath reader
 * @param timeoutMs - Remaining shared deadline
 * @param signal - Shared cancellation signal
 * @returns Hook installation status
 */
export async function inspectHookInstallation(
  projectRoot: string,
  types: readonly ProjectType[],
  reader: HooksPathReader,
  timeoutMs: number,
  signal: AbortSignal
): Promise<HookInstallationInspection> {
  if (types.includes("rails")) {
    const result = await inspectRailsHooks(projectRoot, { timeoutMs, signal });
    return { status: result.status, drift: result.drift };
  }
  if (!types.includes("typescript")) {
    return { status: "warn", drift: ["unsupported hook stack"] };
  }
  const modeDrift = [
    ...(await executableDrift(projectRoot, ".husky", HUSKY_HOOKS)),
  ];
  const hooksPath = await reader(projectRoot, timeoutMs, signal).catch(
    () => null
  );
  if (hooksPath === null) {
    return modeDrift.length === 0
      ? { status: "warn", drift: ["core.hooksPath unavailable"] }
      : { status: "fail", drift: modeDrift };
  }
  const drift = [
    ...modeDrift,
    ...(hooksPath === ".husky" || hooksPath === ".husky/_"
      ? []
      : ["core.hooksPath"]),
  ];
  return drift.length === 0
    ? { status: "pass", drift: [] }
    : { status: "fail", drift };
}
/* eslint-enable jsdoc/require-param-description, jsdoc/require-returns -- restore repository documentation defaults */
