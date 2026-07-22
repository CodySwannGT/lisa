/**
 * Offline supply-chain scanning for the dependencies/supply-chain readiness
 * producer (B5, PRD #1739, #1896).
 *
 * The B5 question — does belief that the owned surface still works rest on more
 * than hope — is answered from four repository facts: a committed lockfile, the
 * dependency specs the manifest names, whether anything anywhere audits the
 * tree, and whether each audit exception carries the decision behind it. This
 * module gathers those facts; its sibling turns them into the rubric-shaped
 * dimension record. Splitting them keeps each file inside the repository's
 * file-size budget and keeps the gathering independently testable.
 *
 * Reading is offline and best-effort by construction: an unreadable file
 * establishes nothing and is passed over, never reported as a violation.
 * @module cli/doctor-readiness-supply-chain-scan
 */
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { isRecord, readFileOrNull } from "./doctor-readiness-shared.js";

/**
 * Every lockfile spelling a JavaScript package manager writes. One of these
 * being committed is what makes two installs resolve to the same tree.
 */
export const LOCKFILES: readonly string[] = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

/**
 * Manifest blocks whose specs must name a version. `peerDependencies` is
 * deliberately excluded: `*` there is the conventional way to say "any host
 * version works", not a floating install.
 */
const VERSIONED_BLOCKS: readonly string[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "overrides",
  "resolutions",
];

/**
 * Specs that resolve to whatever is newest at install time. Deliberately narrow:
 * a `>=` floor in `overrides` is the recommended way to force a patched
 * transitive dependency, so treating ranges as floating would fault the very
 * remediation the audit gate asks for.
 */
const FLOATING_SPECS: ReadonlySet<string> = new Set([
  "",
  "*",
  "x",
  "X",
  "*.*",
  "*.*.*",
  "latest",
  "next",
  "*.x",
]);

/**
 * Protocols that resolve to something inside this repository rather than to a
 * published version, so there is nothing to pin and nothing to drift.
 */
const LOCAL_PROTOCOLS: readonly string[] = [
  "workspace:",
  "file:",
  "link:",
  "portal:",
];

/**
 * Protocols that clone a source tree. Without a ref these resolve to whatever
 * the default branch holds at install time, which is the drift B5 cares about.
 * Each alternative ends in `:` or `+` on purpose — a colonless `bitbucket`
 * alternative would match the ordinary registry package `bitbucket-client`.
 */
const GIT_FETCH_PROTOCOL = /^(github:|gitlab:|bitbucket:|git\+|git:)/i;

/** An `http(s)` spec, which may clone a repository or download an archive. */
const HTTP_SPEC = /^https?:\/\//i;

/**
 * Whether a source-fetch spec is anchored to one revision by a `#<sha|tag>`
 * suffix. Written without a regex so it cannot backtrack on a hostile spec.
 * @param spec - The declared spec text
 * @returns True when a non-empty ref follows a `#`
 */
function hasImmutableRef(spec: string): boolean {
  const marker = spec.indexOf("#");
  return marker >= 0 && spec.slice(marker + 1).trim() !== "";
}

/**
 * Whether a spec clones a git repository.
 *
 * The distinction this draws is the whole point: `git+https://…/widget.git`
 * tracks a moving branch tip, but `https://…/widget-1.2.3.tgz` names one built
 * archive that cannot become something newer tomorrow. Demanding a `#ref` of an
 * archive URL would fault a repository that is already perfectly pinned.
 * @param spec - The declared spec text
 * @returns True when the spec resolves by cloning a repository
 */
function clonesRepository(spec: string): boolean {
  const beforeRef = spec.split("#")[0] ?? "";
  return (
    GIT_FETCH_PROTOCOL.test(spec) ||
    (HTTP_SPEC.test(spec) && beforeRef.toLowerCase().endsWith(".git"))
  );
}

/**
 * Whether a dependency spec resolves to whatever is newest at install time
 * rather than to a version something was validated against.
 *
 * Four families are recognized, and the narrowness of each is deliberate — every
 * over-eager rule here fails a correctly configured repository:
 *
 * - **Local protocols** resolve inside the repository and never float.
 * - **Registry aliases** (`npm:left-pad@latest`) hide the real spec behind the
 *   alias, so the part after the version separator is re-tested.
 * - **Repository clones** (`github:acme/widget`, `git+https://…/x.git`) float
 *   unless anchored to a `#<sha|tag>` revision, because the branch tip moves
 *   under the install. An archive URL (`…/widget-1.2.3.tgz`) is NOT a clone: it
 *   names one built artifact and is treated as pinned.
 * - **Plain ranges** float only when they name no version at all. A `>=` floor
 *   in `overrides` is the recommended way to force a patched transitive
 *   dependency, so ranges are otherwise left alone.
 * @param spec - The declared spec text
 * @returns True when the spec floats
 */
export function isFloatingSpec(spec: string): boolean {
  const trimmed = spec.trim();
  if (LOCAL_PROTOCOLS.some(protocol => trimmed.startsWith(protocol))) {
    return false;
  }
  if (/^npm:/i.test(trimmed)) {
    const separator = trimmed.lastIndexOf("@");
    return separator > "npm:".length
      ? isFloatingSpec(trimmed.slice(separator + 1))
      : true;
  }
  if (clonesRepository(trimmed)) {
    return !hasImmutableRef(trimmed);
  }
  return FLOATING_SPECS.has(trimmed.toLowerCase());
}

/**
 * Commands and actions that actually audit the DEPENDENCY tree. A job merely
 * titled "Security Scan" is deliberately not enough: a secret scanner proves
 * nothing about the dependency tree, and counting it would be a false green —
 * the worst direction to err for a confidence model.
 */
const AUDIT_GATE_PATTERN =
  /\b(npm|bun|yarn|pnpm)\s+audit\b|audit-ci|osv-scanner|dependency-review-action|\bsnyk\b|\btrivy\b|\bgrype\b/i;

/**
 * An update bot covering the JavaScript dependency tree. A `dependabot.yml`
 * that only watches `github-actions` never looks at `package.json`, so its mere
 * presence is not a confidence model for the dependencies.
 */
const JS_ECOSYSTEM_PATTERN = /package-ecosystem:\s*["']?(npm|bun|yarn|pnpm)\b/i;

/** Files that may declare an audit gate in their text. */
const GATE_DIRECTORIES: readonly string[] = [
  path.join(".github", "workflows"),
  ".husky",
];

/** Single-file gate declarations checked by text match. */
const GATE_FILES: readonly string[] = [
  "lefthook.yml",
  "lefthook.yaml",
  ".lefthook.yml",
];

/** Update bots whose mere presence is a standing confidence model. */
const UPDATE_BOT_FILES: readonly string[] = [
  path.join(".github", "dependabot.yml"),
  path.join(".github", "dependabot.yaml"),
  path.join(".github", "renovate.json"),
  "renovate.json",
  ".renovaterc",
  ".renovaterc.json",
];

/** What reading the manifest established. */
export type ManifestOutcome =
  | { readonly kind: "ok"; readonly manifest: Record<string, unknown> }
  | { readonly kind: "unassessable"; readonly reason: string };

/**
 * Whether a repository-relative path exists.
 * @param root - Repository root
 * @param relativePath - Repo-relative path
 * @returns True when the file could be read
 */
async function fileExists(
  root: string,
  relativePath: string
): Promise<boolean> {
  return (await readFileOrNull(root, relativePath)) !== null;
}

/**
 * List the files directly inside a repository-relative directory.
 * @param root - Repository root
 * @param relativeDir - Repo-relative directory
 * @returns Repo-relative file paths (empty when the directory is absent)
 */
async function listDirectory(
  root: string,
  relativeDir: string
): Promise<readonly string[]> {
  try {
    const entries = await readdir(path.join(root, relativeDir), {
      withFileTypes: true,
    });
    return entries
      .filter(entry => entry.isFile())
      .map(entry => path.join(relativeDir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Read and parse `package.json`, distinguishing "absent" from "unparseable" so
 * the SKIP reason can say which one happened.
 * @param root - Repository root
 * @returns The parsed manifest, or the reason it cannot be assessed
 */
export async function readManifest(root: string): Promise<ManifestOutcome> {
  const source = await readFileOrNull(root, "package.json");
  if (source === null) {
    return {
      kind: "unassessable",
      reason:
        "no `package.json` was found, so this repository declares no " +
        "JavaScript dependency surface to build a confidence model for; " +
        "supply-chain confidence is not established either way",
    };
  }
  try {
    const parsed: unknown = JSON.parse(source);
    if (!isRecord(parsed)) {
      throw new Error("manifest is not a JSON object");
    }
    return { kind: "ok", manifest: parsed };
  } catch (error) {
    return {
      kind: "unassessable",
      reason:
        "`package.json` could not be parsed, so its dependency specs were " +
        `never read and nothing about them is established: ${
          error instanceof Error ? error.message : String(error)
        }`,
    };
  }
}

/** One declared dependency spec, flattened out of the manifest blocks. */
export interface DependencySpec {
  readonly block: string;
  readonly name: string;
  readonly spec: string;
}

/**
 * Flatten one manifest block into `name → spec` pairs. `overrides` nests, so a
 * nested map is walked rather than skipped — a floating spec one level down
 * installs exactly as loosely as one at the top.
 * @param block - Block name, e.g. `dependencies`
 * @param value - The block's raw value
 * @param prefix - Accumulated name path for nested overrides
 * @returns Flattened specs
 */
function flattenBlock(
  block: string,
  value: unknown,
  prefix = ""
): readonly DependencySpec[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([name, spec]) => {
    const qualified = prefix === "" ? name : `${prefix}.${name}`;
    if (typeof spec === "string") {
      return [{ block, name: qualified, spec }];
    }
    return flattenBlock(block, spec, qualified);
  });
}

/**
 * Flatten every versioned manifest block into one list of specs.
 * @param manifest - Parsed `package.json`
 * @returns Every declared spec across the versioned blocks
 */
export function collectSpecs(
  manifest: Record<string, unknown>
): readonly DependencySpec[] {
  return VERSIONED_BLOCKS.flatMap(block =>
    flattenBlock(block, manifest[block])
  );
}

/**
 * Find the committed lockfile, if any.
 * @param root - Repository root
 * @returns The lockfile name, or null when none is committed
 */
export async function findLockfile(root: string): Promise<string | null> {
  for (const candidate of LOCKFILES) {
    if (await fileExists(root, candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Whether an update-bot config actually watches the JavaScript dependency tree.
 * Dependabot declares an ecosystem per entry, so a config covering only
 * `github-actions` is not a confidence model for `package.json`. Renovate has no
 * such per-file declaration and defaults to every manager it detects, so its
 * presence is taken at face value.
 * @param botFile - Repo-relative bot config path
 * @param source - The config's text
 * @returns True when the bot covers the JavaScript dependencies
 */
function coversJavaScriptTree(botFile: string, source: string): boolean {
  return botFile.includes("dependabot")
    ? JS_ECOSYSTEM_PATTERN.test(source)
    : true;
}

/**
 * Find where the repository audits its dependency tree: a CI job, a git hook, a
 * lefthook declaration, or an update bot.
 * @param root - Repository root
 * @returns The repo-relative path of the first gate found, or null
 */
export async function findAuditGate(root: string): Promise<string | null> {
  for (const botFile of UPDATE_BOT_FILES) {
    const source = await readFileOrNull(root, botFile);
    if (source !== null && coversJavaScriptTree(botFile, source)) {
      return botFile.split(path.sep).join("/");
    }
  }
  const scanned = [
    ...(
      await Promise.all(GATE_DIRECTORIES.map(dir => listDirectory(root, dir)))
    ).flat(),
    ...GATE_FILES,
  ];
  for (const file of scanned) {
    const source = await readFileOrNull(root, file);
    if (source !== null && AUDIT_GATE_PATTERN.test(source)) {
      return file.split(path.sep).join("/");
    }
  }
  return null;
}
