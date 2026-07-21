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
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

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
 * Whether a dependency spec resolves to whatever is newest at install time
 * rather than to a version something was validated against.
 * @param spec - The declared spec text
 * @returns True when the spec floats
 */
export function isFloatingSpec(spec: string): boolean {
  return FLOATING_SPECS.has(spec.trim().toLowerCase());
}

/** Commands and actions that actually audit the dependency tree. */
const AUDIT_GATE_PATTERN =
  /\b(npm|bun|yarn|pnpm)\s+audit\b|audit-ci|osv-scanner|dependency-review-action|\bsnyk\b|\btrivy\b|security\s+scan/i;

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

/** Audit allowlists whose entries must each carry a decision record. */
const ALLOWLIST_FILES: readonly string[] = [
  "audit.ignore.config.json",
  "audit.ignore.local.json",
  ".nsprc",
];

/** Keys that count as the written decision behind an audit exception. */
const DECISION_KEYS: readonly string[] = [
  "reason",
  "notes",
  "justification",
  "decision",
  "rationale",
  "comment",
];

/** What reading the manifest established. */
export type ManifestOutcome =
  | { readonly kind: "ok"; readonly manifest: Record<string, unknown> }
  | { readonly kind: "unassessable"; readonly reason: string };

/**
 * Whether a value is a plain JSON object.
 * @param value - Candidate value
 * @returns True when the value is a non-null, non-array object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
 * Read a repository-relative file, returning null when it cannot be read.
 * @param root - Repository root
 * @param relativePath - Repo-relative path
 * @returns File contents, or null
 */
async function readFileOrNull(
  root: string,
  relativePath: string
): Promise<string | null> {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch {
    return null;
  }
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
 * Find where the repository audits its dependency tree: a CI job, a git hook, a
 * lefthook declaration, or an update bot.
 * @param root - Repository root
 * @returns The repo-relative path of the first gate found, or null
 */
export async function findAuditGate(root: string): Promise<string | null> {
  for (const botFile of UPDATE_BOT_FILES) {
    if (await fileExists(root, botFile)) {
      return botFile;
    }
  }
  const scanned = [
    ...(
      await Promise.all(GATE_DIRECTORIES.map(dir => listDirectory(root, dir)))
    )
      .flat()
      .filter(file => !file.endsWith(path.join(".husky", "_"))),
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

/**
 * Read one audit allowlist and report the exceptions carrying no decision.
 *
 * Both shapes in the wild are handled: an `exclusions` array of entry objects,
 * and the `.nsprc` map of advisory id to entry. An entry that is a bare string
 * has nowhere to record a decision, which is precisely the finding.
 * @param file - Repo-relative allowlist path
 * @param parsed - The parsed allowlist document
 * @returns Evidence lines, one per undocumented exception
 */
function undocumentedExceptions(
  file: string,
  parsed: unknown
): readonly string[] {
  const entries: readonly (readonly [string, unknown])[] = isRecord(parsed)
    ? Array.isArray(parsed.exclusions)
      ? parsed.exclusions.map((entry, index) => [String(index), entry] as const)
      : Object.entries(parsed)
    : [];
  return entries.flatMap(([key, entry]) => {
    const id = isRecord(entry) && typeof entry.id === "string" ? entry.id : key;
    const documented =
      isRecord(entry) &&
      DECISION_KEYS.some(
        decisionKey =>
          typeof entry[decisionKey] === "string" &&
          (entry[decisionKey] as string).trim() !== ""
      );
    return documented
      ? []
      : [
          `\`${file}\` excludes advisory \`${id}\` from the dependency audit ` +
            "with no written decision (no reason/notes/justification field), so " +
            "nobody can tell whether the exception is still true",
        ];
  });
}

/**
 * Collect the undocumented audit exceptions across every allowlist file.
 * @param root - Repository root
 * @returns Evidence lines, one per undocumented exception
 */
export async function auditExceptionViolations(
  root: string
): Promise<readonly string[]> {
  const perFile = await Promise.all(
    ALLOWLIST_FILES.map(async file => {
      const source = await readFileOrNull(root, file);
      if (source === null) {
        return [];
      }
      try {
        return undocumentedExceptions(file, JSON.parse(source));
      } catch {
        // An unparseable allowlist establishes nothing about its entries, so it
        // is passed over rather than reported as an undocumented exception.
        return [];
      }
    })
  );
  return perFile.flat();
}
