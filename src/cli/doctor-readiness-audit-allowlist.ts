/**
 * Audit-allowlist reading for the dependencies/supply-chain readiness producer
 * (B5, PRD #1739, #1896).
 *
 * An audit allowlist is a list of vulnerabilities somebody decided not to fix.
 * B5 asks the only question that keeps such a list honest: is the decision
 * written down next to the exception? Two failure directions matter equally and
 * this module is shaped by both.
 *
 * Reporting too much fabricates findings — audit-ci's own `.nsprc` carries
 * `$schema` and other configuration at the same level as advisory ids, so a
 * naive walk reports the schema pointer as an undocumented exclusion. Reporting
 * too little is worse: an entry with no `id` field, or a bare string in the
 * list, is still a live exception with no written decision, and dropping it
 * turns the one finding this dimension exists for into silence. Identity
 * therefore degrades (advisory id → package name → position) rather than
 * disappearing.
 * @module cli/doctor-readiness-audit-allowlist
 */
import { isRecord, readFileOrNull } from "./doctor-readiness-shared.js";
import { auditScopeProblems, detectAuditManager } from "../core/audit.js";
import { readAuditCopies } from "../core/audit-lockfile.js";

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

/**
 * Keys whose value holds audit exceptions. Everything outside these containers
 * is configuration, not an exception — walking a whole document as if every
 * top-level key were an advisory id turns audit-ci's own `.nsprc` (`$schema`,
 * `exceptions`, …) into fabricated findings.
 */
const EXCEPTION_CONTAINERS: readonly string[] = [
  "exclusions",
  "exceptions",
  "advisories",
  "allowlist",
];

/**
 * Whether a top-level `.nsprc`-style key names an advisory rather than config.
 * @param key - The key to classify
 * @returns True when the key may name an advisory
 */
function isAdvisoryKey(key: string): boolean {
  return !key.startsWith("$") && !key.startsWith("//");
}

/** One audit exception, normalized across every allowlist shape. */
interface ExceptionEntry {
  /** Operator-facing identity: an advisory id, a package name, or a position. */
  readonly id: string;
  /** The entry's fields, or null when the entry was a bare string. */
  readonly fields: Record<string, unknown> | null;
}

/**
 * Name one array-shaped exception for an operator.
 *
 * An entry with no `id` must never be dropped — a live exception with no written
 * decision is precisely what B5 exists to surface, and a missing field is not a
 * reason to suppress it. So the identity degrades: advisory id, then package
 * name, then the entry's position in the list.
 * @param entry - The entry's fields
 * @param index - Zero-based position in the container
 * @returns The operator-facing identity
 */
function describeException(
  entry: Record<string, unknown>,
  index: number
): string {
  if (typeof entry.id === "string" && entry.id.trim() !== "") {
    return entry.id;
  }
  return typeof entry.package === "string" && entry.package.trim() !== ""
    ? entry.package
    : `entry #${index + 1}`;
}

/**
 * Normalize one array-shaped exception container.
 *
 * A bare string entry IS the advisory id, and it carries no fields at all — so
 * there is nowhere for a decision to live, which makes it undocumented by
 * construction rather than something to skip over.
 * @param container - The array of entries
 * @returns The normalized exceptions
 */
function arrayEntries(
  container: readonly unknown[]
): readonly ExceptionEntry[] {
  return container.flatMap((entry, index): readonly ExceptionEntry[] => {
    if (typeof entry === "string" && entry.trim() !== "") {
      return [{ id: entry.trim(), fields: null }];
    }
    return isRecord(entry)
      ? [{ id: describeException(entry, index), fields: entry }]
      : [];
  });
}

/**
 * Take the object-valued, non-config entries out of an exception map.
 * @param container - A candidate exception map
 * @returns The entries that are genuinely exceptions
 */
function mapEntries(
  container: Record<string, unknown>
): readonly ExceptionEntry[] {
  return Object.entries(container).flatMap(([key, entry]) =>
    isAdvisoryKey(key) && isRecord(entry) ? [{ id: key, fields: entry }] : []
  );
}

/**
 * Normalize one allowlist document into exception entries.
 *
 * Two shapes exist in the wild: a named container holding an array or a map of
 * entries, and audit-ci's `.nsprc`, whose top level maps advisory id to entry.
 * In the map shape only OBJECT-valued entries are exceptions — a string, a
 * boolean, or a `$schema` pointer at the top level is configuration.
 * @param parsed - The parsed allowlist document
 * @returns The exception entries
 */
function exceptionEntries(parsed: unknown): readonly ExceptionEntry[] {
  if (!isRecord(parsed)) {
    return [];
  }
  const containers = EXCEPTION_CONTAINERS.flatMap(key =>
    parsed[key] === undefined ? [] : [parsed[key]]
  );
  if (containers.length > 0) {
    return containers.flatMap(container =>
      Array.isArray(container)
        ? arrayEntries(container)
        : isRecord(container)
          ? mapEntries(container)
          : []
    );
  }
  // No recognized container: fall back to the `.nsprc` id → entry map. If
  // nothing there is an object-valued advisory key, this document establishes
  // nothing and reports nothing.
  return mapEntries(parsed);
}

/**
 * Read one audit allowlist and report the exceptions carrying no decision.
 *
 * An entry with `active: false` is skipped: audit-ci never applies it, so there
 * is no live exception for anybody to justify.
 * @param file - Repo-relative allowlist path
 * @param parsed - The parsed allowlist document
 * @returns Evidence lines, one per undocumented exception
 */
function undocumentedExceptions(
  file: string,
  parsed: unknown
): readonly string[] {
  return exceptionEntries(parsed).flatMap(({ id, fields }) => {
    if (fields?.active === false) {
      return [];
    }
    const documented =
      fields !== null &&
      DECISION_KEYS.some(
        decisionKey =>
          typeof fields[decisionKey] === "string" &&
          (fields[decisionKey] as string).trim() !== ""
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

/** What the doctor established about one allowlist's exclusion scopes. */
interface ScopeAssessment {
  /** Invalid or unprovable scopes: each one fails B5. */
  readonly violations: readonly string[];
  /** Valid but advisory-wide exclusions: reported, never blocking. */
  readonly observations: readonly string[];
}

/** An assessment that established nothing either way. */
const EMPTY_SCOPE_ASSESSMENT: ScopeAssessment = {
  violations: [],
  observations: [],
};

/**
 * Explain an ID-only exclusion in words a non-technical operator can act on.
 *
 * This is the case #4521 exists for: an exclusion with no package, versions or
 * paths silences the advisory for every copy in the tree, including a future
 * production copy. It is legal (legacy files keep working), so it is an
 * observation in the doctor's own report rather than a failure — and never a
 * bare `console.warn`, which a reader of the doctor's report would not see.
 * @param file - Repository-relative allowlist filename
 * @param id - The advisory id the entry excludes
 * @returns One operator-language observation
 */
function advisoryWideObservation(file: string, id: string): string {
  return (
    `\`${file}\` hides this advisory for every copy of the affected package: ` +
    `the entry for \`${id}\` names no package, version range or lockfile ` +
    "path, so a later " +
    "copy used in production would also be hidden. If the risky copy is only " +
    "used by development tools, add `package`, `versions` and `paths` so " +
    "only that copy is excused."
  );
}

/**
 * Assess one live exclusion's scope with the gate's own validator.
 * @param root - Project root containing the exact lockfile
 * @param file - Repository-relative allowlist filename
 * @param entry - The normalized exclusion
 * @returns The violations and observations for this entry
 */
function assessEntryScope(
  root: string,
  file: string,
  entry: ExceptionEntry
): ScopeAssessment {
  const { id, fields } = entry;
  if (fields === null || fields.active === false) return EMPTY_SCOPE_ASSESSMENT;
  const problems = auditScopeProblems(fields).map(
    problem => `${file}: ${id}: ${problem}`
  );
  if (problems.length) return { violations: problems, observations: [] };
  if (fields.paths !== undefined || fields.versions !== undefined) {
    try {
      readAuditCopies(root, detectAuditManager(root));
    } catch (error) {
      return {
        violations: [`${file}: ${id}: ${(error as Error).message}`],
        observations: [],
      };
    }
    return EMPTY_SCOPE_ASSESSMENT;
  }
  return fields.package === undefined
    ? { violations: [], observations: [advisoryWideObservation(file, id)] }
    : EMPTY_SCOPE_ASSESSMENT;
}

/**
 * The doctor uses the gate's validator rather than a second scope grammar.
 * @param root - Project root containing the exact lockfile and exclusion documents
 * @param file - Repository-relative allowlist filename
 * @param parsed - Parsed allowlist document
 * @returns The scope violations and observations across the document
 */
function assessScopes(
  root: string,
  file: string,
  parsed: unknown
): ScopeAssessment {
  if (file === ".nsprc") return EMPTY_SCOPE_ASSESSMENT;
  const assessed = exceptionEntries(parsed).map(entry =>
    assessEntryScope(root, file, entry)
  );
  return {
    violations: assessed.flatMap(entry => entry.violations),
    observations: assessed.flatMap(entry => entry.observations),
  };
}

/** Sentinel for a document that is not JSON (distinct from a JSON `null`). */
const UNPARSEABLE = Symbol("unparseable");

/**
 * Parse an allowlist document without throwing.
 * @param source - Raw file contents
 * @returns The parsed value, or UNPARSEABLE when the text is not JSON
 */
function parseAllowlist(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return UNPARSEABLE;
  }
}

/**
 * Assess one allowlist file: undocumented exceptions plus scope findings.
 * @param root - Repository root
 * @param file - Repository-relative allowlist filename
 * @returns The violations and observations this file establishes
 */
async function assessAllowlistFile(
  root: string,
  file: string
): Promise<ScopeAssessment> {
  const source = await readFileOrNull(root, file);
  if (source === null) {
    return EMPTY_SCOPE_ASSESSMENT;
  }
  const parsed = parseAllowlist(source);
  if (parsed === UNPARSEABLE) {
    // An unparseable allowlist establishes nothing about its entries, so it
    // is passed over rather than reported as an undocumented exception.
    return EMPTY_SCOPE_ASSESSMENT;
  }
  const scopes = assessScopes(root, file, parsed);
  return {
    violations: [...undocumentedExceptions(file, parsed), ...scopes.violations],
    observations: scopes.observations,
  };
}

/**
 * Assess every audit allowlist once, returning blocking and non-blocking lines.
 * @param root - Repository root
 * @returns Violations (fail B5) and observations (reported, non-blocking)
 */
export async function assessAuditExceptions(
  root: string
): Promise<ScopeAssessment> {
  const perFile = await Promise.all(
    ALLOWLIST_FILES.map(file => assessAllowlistFile(root, file))
  );
  return {
    violations: perFile.flatMap(file => file.violations),
    observations: perFile.flatMap(file => file.observations),
  };
}

/**
 * Collect the undocumented or invalidly scoped audit exceptions.
 * @param root - Repository root
 * @returns Evidence lines, one per violation
 */
export async function auditExceptionViolations(
  root: string
): Promise<readonly string[]> {
  return (await assessAuditExceptions(root)).violations;
}

/**
 * Collect the non-blocking observations about advisory-wide exclusions.
 * @param root - Repository root
 * @returns Operator-language observations, one per ID-only exclusion
 */
export async function auditExceptionObservations(
  root: string
): Promise<readonly string[]> {
  return (await assessAuditExceptions(root)).observations;
}
