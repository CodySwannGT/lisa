/**
 * Choose the package manager whose audit and lockfile the canonical gate reads.
 *
 * Mirrors the shipped pre-push hook's `lisa_detect_pm` (#4521 review), so the
 * hook, the registry task and the exported helper audit the same manager on
 * the same tree: the `packageManager` field first, then an engines
 * `please-use-<pm>` sentinel, then the lockfiles whose manager the engines do
 * not forbid, in the hook's order. A lockfile left behind by another manager
 * would otherwise make the registry route audit a different tree than the hook.
 * @module core/audit-manager
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditManager } from "./audit-types.js";

/** Managers whose production audits the canonical matcher understands. */
const AUDITABLE: readonly string[] = ["bun", "npm", "yarn"];

/** The hook's lockfile order, including pnpm so a pnpm tree is not mistaken. */
const LOCKFILES: readonly (readonly [string, string])[] = [
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/** What package.json says about its manager. */
interface ManifestHints {
  readonly field: string;
  readonly forced: string;
  readonly forbidden: ReadonlySet<string>;
}

/**
 * Parse package.json, treating an absent or unreadable one as no hints (the
 * hook's jq reads it the same way: failure yields empty strings).
 * @param file - Path to package.json
 * @returns The parsed manifest, or null
 */
function readManifest(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * Read the manager hints exactly as the hook's jq expressions do.
 * @param root - Project root
 * @returns The packageManager name, the forced manager, the forbidden managers
 */
function manifestHints(root: string): ManifestHints {
  const none: ManifestHints = { field: "", forced: "", forbidden: new Set() };
  const manifest = readManifest(join(root, "package.json"));
  if (manifest === null || typeof manifest !== "object") return none;
  const { packageManager, engines } = manifest as {
    packageManager?: unknown;
    engines?: unknown;
  };
  const entries =
    engines !== null && typeof engines === "object"
      ? Object.entries(engines as Record<string, unknown>).filter(
          (pair): pair is [string, string] => typeof pair[1] === "string"
        )
      : [];
  const forced =
    entries
      .map(([, value]) => /please-use-(bun|npm|yarn|pnpm)/u.exec(value)?.[1])
      .find(name => name !== undefined) ?? "";
  return {
    field:
      typeof packageManager === "string"
        ? (packageManager.split("@")[0] ?? "")
        : "",
    forced,
    forbidden: new Set(
      entries
        .filter(([, value]) => /please-use|do-not-use/iu.test(value))
        .map(([key]) => key)
    ),
  };
}

/**
 * Accept a selected manager only if its audit is one Lisa can evaluate.
 * @param manager - The selected manager name
 * @param why - How it was selected, for the operator
 * @returns The manager
 */
function auditable(manager: string, why: string): AuditManager {
  if (AUDITABLE.includes(manager)) return manager as AuditManager;
  throw new Error(
    `This project uses ${manager} (${why}), whose audit Lisa's canonical matcher does not evaluate; declare a dependency-vulnerability task for it`
  );
}

/**
 * Select the manager with the shipped hook's precedence.
 * @param root - Project root containing the manifest and lockfiles
 * @returns The manager whose audit and lockfile are evaluated
 */
export function detectAuditManager(root: string): AuditManager {
  const hints = manifestHints(root);
  if (["bun", "npm", "yarn", "pnpm"].includes(hints.field))
    return auditable(hints.field, "packageManager in package.json");
  if (hints.forced !== "")
    return auditable(hints.forced, "an engines please-use sentinel");
  const found = LOCKFILES.find(
    ([file, manager]) =>
      !hints.forbidden.has(manager) && existsSync(join(root, file))
  );
  if (found) return auditable(found[1], `${found[0]} is present`);
  throw new Error(
    "No supported audit lockfile found (bun.lock, package-lock.json or yarn.lock)"
  );
}
