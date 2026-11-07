import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import * as yarnLockfile from "@yarnpkg/lockfile";
import { load as parseYaml } from "js-yaml";
import { valid, validRange } from "semver";
import { auditRecord } from "./audit-exclusions.js";
import type { AuditCopy, AuditManager } from "./audit-types.js";

// Node 22's CommonJS lexer cannot see `parse` on this webpack bundle, so a named
// import crashes the module at load there. A namespace import always loads; the
// function is on it directly (bundlers, Node 24) or on its `default` (Node 22).
const yarnModule = yarnLockfile as typeof yarnLockfile & {
  readonly default?: typeof yarnLockfile;
};
const parseYarn = yarnModule.parse ?? yarnModule.default?.parse;

/**
 * Protocols whose copies come from somewhere other than the package registry.
 * A registry advisory is reported for registry copies; a git, file, link,
 * tarball, workspace or patch entry is not one, and treating it as unknown data
 * used to fail every scoped exclusion in a project that has any such entry.
 */
const NON_REGISTRY_PROTOCOLS: ReadonlySet<string> = new Set([
  "workspace",
  "root",
  "file",
  "link",
  "portal",
  "patch",
  "exec",
  "git",
  "github",
  "gitlab",
  "bitbucket",
  "http",
  "https",
]);

/**
 * Whether a resolved spec names a non-registry source.
 * @param spec - The part after the package name (`1.2.3`, `file:../x`, …)
 * @returns True for a non-registry source
 */
function isNonRegistrySpec(spec: string): boolean {
  const protocol = /^([a-z][a-z0-9+.-]*):/u.exec(spec)?.[1];
  if (protocol === undefined) return false;
  // `git+https:`, `git+ssh:` and any `scheme://` URL are not registry copies.
  return (
    NON_REGISTRY_PROTOCOLS.has(protocol) ||
    protocol.startsWith("git+") ||
    spec.startsWith(`${protocol}://`)
  );
}

/**
 * Split `name@spec`, honoring a leading scope; an `@` inside the spec stays.
 * @param identity - Resolved identity such as `@scope/name@1.2.3`
 * @returns The name and spec, or null when there is no separator
 */
function splitIdentity(
  identity: string
): { readonly name: string; readonly spec: string } | null {
  const index = identity.indexOf("@", identity.startsWith("@") ? 1 : 0);
  return index < 1
    ? null
    : { name: identity.slice(0, index), spec: identity.slice(index + 1) };
}

/**
 * Split an exact resolved identity, including scoped package names.
 * @param path - Exact lockfile key for this resolved package copy
 * @param identity - Resolved package name and exact version
 * @returns The validated result described above
 */
function resolvedCopy(path: string, identity: string): AuditCopy {
  const split = splitIdentity(identity);
  if (split === null || valid(split.spec) === null) {
    throw new Error(`Unknown lockfile package data at ${path}: ${identity}`);
  }
  return { path, name: split.name, version: split.spec };
}

/**
 * Bun JSONC keys are paths; the resolved tuple carries the real alias name.
 * @param source - Complete provider report or lockfile text
 * @returns The validated result described above
 */
function bunCopies(source: string): AuditCopy[] {
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(source, errors, {
    allowTrailingComma: true,
  });
  if (errors.length || !auditRecord(parsed) || !auditRecord(parsed.packages)) {
    throw new Error("Cannot parse bun.lock packages map (expected text JSONC)");
  }
  return Object.entries(parsed.packages).flatMap(([path, tuple]) => {
    if (!Array.isArray(tuple) || typeof tuple[0] !== "string") {
      throw new Error(`Unknown bun.lock package data at ${path}`);
    }
    // Workspace, git, file, link and tarball entries are not registry copies;
    // their own dependencies are separate keys.
    if (isNonRegistrySpec(splitIdentity(tuple[0])?.spec ?? "")) return [];
    return [resolvedCopy(path, tuple[0])];
  });
}

/**
 * npm's packages map records the resolved name for aliases.
 * @param source - Complete provider report or lockfile text
 * @returns The validated result described above
 */
function npmCopies(source: string): AuditCopy[] {
  const parsed: unknown = JSON.parse(source);
  if (!auditRecord(parsed) || !auditRecord(parsed.packages)) {
    throw new Error(
      "Cannot parse package-lock.json packages map (requires lockfile v2/v3)"
    );
  }
  return Object.entries(parsed.packages).flatMap(([path, entry]) => {
    if (!path) return [];
    if (!auditRecord(entry))
      throw new Error(`Unknown package-lock.json entry at ${path}`);
    if (entry.link === true) return [];
    const source =
      typeof entry.version === "string" ? entry.version : entry.resolved;
    if (typeof source === "string" && isNonRegistrySpec(source)) return [];
    const name =
      typeof entry.name === "string"
        ? entry.name
        : path.split("node_modules/").at(-1);
    if (!name || typeof entry.version !== "string") {
      throw new Error(`Unknown package-lock.json package data at ${path}`);
    }
    const identity = entry.version.startsWith("npm:")
      ? entry.version.slice(4)
      : `${name}@${entry.version}`;
    return [resolvedCopy(path, identity)];
  });
}

/**
 * Yarn key selectors are the exact paths exposed by its lockfile.
 * @param source - Complete provider report or lockfile text
 * @returns The validated result described above
 */
function yarnCopies(source: string): AuditCopy[] {
  const berry = /(?:^|\n)__metadata:/u.test(source);
  const classic = berry ? null : parseYarn(source);
  if (classic && classic.type !== "success")
    throw new Error("Cannot parse yarn.lock");
  const parsed: unknown = berry ? parseYaml(source) : classic?.object;
  if (!auditRecord(parsed))
    throw new Error("Cannot parse yarn.lock package map");
  if (!Object.keys(parsed).some(key => key !== "__metadata")) {
    throw new Error(
      "Cannot establish scoped audit coverage from empty yarn.lock package map"
    );
  }
  return Object.entries(parsed).flatMap(([path, entry]) => {
    if (path === "__metadata") return [];
    if (!auditRecord(entry) || typeof entry.version !== "string") {
      throw new Error(`Unknown yarn.lock package data at ${path}`);
    }
    const descriptor = path.split(", ")[0] ?? "";
    const separator = descriptor.indexOf(
      "@",
      descriptor.startsWith("@") ? 1 : 0
    );
    const selector = descriptor.slice(separator + 1);
    const selectorRange = selector.startsWith("npm:")
      ? selector.slice(4)
      : selector;
    // A file, git, tarball, workspace or patch selector is not a registry copy.
    if (separator > 0 && isNonRegistrySpec(selectorRange)) return [];
    const realRange = selectorRange.includes("@")
      ? selectorRange.slice(selectorRange.lastIndexOf("@") + 1)
      : selectorRange;
    if (separator < 1 || validRange(realRange) === null) {
      throw new Error(`Unknown yarn.lock package selector at ${path}`);
    }
    const alias = descriptor.indexOf("@npm:");
    const name = descriptor.slice(0, separator);
    const target = alias > 0 ? descriptor.slice(alias + 5) : "";
    const realName = target.includes("@")
      ? target.slice(0, target.lastIndexOf("@"))
      : name;
    return [resolvedCopy(path, `${realName}@${entry.version}`)];
  });
}

/**
 * Read the selected manager's actual lockfile, without fallback to id-wide scope.
 * @param root - Project root containing the exact lockfile and exclusion documents
 * @param manager - Package manager whose report and lockfile are evaluated
 * @returns The validated result described above
 */
export function readAuditCopies(
  root: string,
  manager: AuditManager
): AuditCopy[] {
  const file = { bun: "bun.lock", npm: "package-lock.json", yarn: "yarn.lock" }[
    manager
  ];
  try {
    const source = readFileSync(join(root, file), "utf8");
    return { bun: bunCopies, npm: npmCopies, yarn: yarnCopies }[manager](
      source
    );
  } catch (error) {
    throw new Error(
      `Cannot evaluate scoped audit exclusions from ${file}: ${(error as Error).message}`,
      { cause: error }
    );
  }
}
