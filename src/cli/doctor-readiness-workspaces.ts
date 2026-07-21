/**
 * Workspace-member resolution for the dependencies/supply-chain readiness
 * producer (B5, PRD #1739, #1896).
 *
 * This module exists for one false positive: `"@acme/utils": "*"` against a
 * workspace member is the workspace-link idiom, not a floating install. The
 * spec resolves to a package inside this repository, so nothing about it can
 * drift at install time — and faulting it would fail every correctly configured
 * npm/yarn/bun/pnpm monorepo. Resolving which names are local is therefore a
 * precondition of B5's floating-spec check, not a nicety.
 *
 * Glob support is deliberately shallow (one trailing `*`) and every read is
 * best-effort: an unresolvable glob contributes no names, because absence of
 * proof must never become proof of a violation.
 * @module cli/doctor-readiness-workspaces
 */
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import {
  isRecord,
  readFileOrNull,
  trimSlashes,
} from "./doctor-readiness-shared.js";

/** What resolving the repository's workspace members established. */
export interface WorkspaceMembers {
  /** Whether the repository declares workspaces at all. */
  readonly declared: boolean;
  /** Names of the local packages the workspaces resolve to. */
  readonly names: ReadonlySet<string>;
}

/**
 * Read the workspace globs a repository declares, across the three spellings:
 * npm/bun/yarn `workspaces` as an array, yarn-classic `workspaces.packages`, and
 * pnpm's separate `pnpm-workspace.yaml`.
 * @param root - Repository root
 * @param manifest - Parsed root `package.json`
 * @returns The declared workspace globs
 */
async function workspaceGlobs(
  root: string,
  manifest: Record<string, unknown>
): Promise<readonly string[]> {
  const declared = manifest.workspaces;
  const fromManifest = Array.isArray(declared)
    ? declared
    : isRecord(declared) && Array.isArray(declared.packages)
      ? declared.packages
      : [];
  const pnpm = await readFileOrNull(root, "pnpm-workspace.yaml");
  const fromPnpm = (pnpm ?? "")
    .split("\n")
    .flatMap(line => /^\s*-\s*["']?([^"'\s]+)/.exec(line)?.[1] ?? []);
  return [...fromManifest, ...fromPnpm].filter(
    (glob): glob is string => typeof glob === "string" && glob.trim() !== ""
  );
}

/**
 * Resolve the local package names a repository's workspace globs expand to.
 *
 * This exists because `"@acme/utils": "*"` against a workspace member is the
 * workspace-link idiom, not a floating install: it resolves to the package in
 * this repository. Faulting it would fail every correctly configured monorepo.
 * Glob support is deliberately shallow (a single trailing `*`), and an
 * unresolvable glob simply contributes no names — absence never manufactures a
 * violation.
 * @param root - Repository root
 * @param manifest - Parsed root `package.json`
 * @returns Whether workspaces are declared, and the member names resolved
 */
export async function resolveWorkspaceMembers(
  root: string,
  manifest: Record<string, unknown>
): Promise<WorkspaceMembers> {
  const globs = await workspaceGlobs(root, manifest);
  const directories = (
    await Promise.all(globs.map(async glob => await expandGlob(root, glob)))
  ).flat();
  const names = (
    await Promise.all(
      directories.map(async directory => {
        const source = await readFileOrNull(root, `${directory}/package.json`);
        if (source === null) {
          return [];
        }
        try {
          const parsed: unknown = JSON.parse(source);
          return isRecord(parsed) && typeof parsed.name === "string"
            ? [parsed.name]
            : [];
        } catch {
          return [];
        }
      })
    )
  ).flat();
  return { declared: globs.length > 0, names: new Set(names) };
}

/**
 * Expand one workspace glob into candidate member directories.
 * @param root - Repository root
 * @param glob - The declared glob, e.g. `packages/*`
 * @returns Repo-relative directories the glob names
 */
async function expandGlob(
  root: string,
  glob: string
): Promise<readonly string[]> {
  const normalized = trimSlashes(glob);
  if (!normalized.includes("*")) {
    return [normalized];
  }
  const parent = trimSlashes(normalized.slice(0, normalized.indexOf("*")));
  try {
    const entries = await readdir(path.join(root, ...parent.split("/")), {
      withFileTypes: true,
    });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => (parent === "" ? entry.name : `${parent}/${entry.name}`));
  } catch {
    return [];
  }
}
