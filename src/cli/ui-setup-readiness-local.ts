/** Local filesystem and deterministic-Health evidence for Setup readiness. */
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { HealthResult, HealthStatus } from "../health/contract.js";
import {
  projectPathKind,
  projectRegularFileExists,
  readProjectText,
  resolveProjectPath,
} from "../health/read-only-fs.js";
import { requireCanonicalUtcTimestamp } from "../health/strict-validation.js";
import {
  setupFinding,
  type SetupReadinessCheck,
  type SetupReadinessFinding,
} from "./ui-setup-readiness-contract.js";

const AGENT_READY_CHECK = "setup.agent-ready";
const WIKI_CHECK = "setup.wiki";

/** Fixed Health checks that establish local standards/governance conformance. */
export const STANDARDS_HEALTH_CHECKS = [
  "templates.managed",
  "package.conformance",
  "hooks.managed",
  "config.sync",
  "instructions.canonical",
  "ci.workflows",
] as const;

/**
 * Never upgrade standards adoption without current lint/test preservation proof.
 * @param health - Current deterministic Health evidence, when available
 * @returns Standards-adoption readiness finding
 */
export function standardsFinding(
  health: HealthResult | undefined
): SetupReadinessFinding {
  const managed = healthEvidenceFinding(
    "setup.standards",
    health,
    STANDARDS_HEALTH_CHECKS,
    "Managed standards surfaces are current.",
    "fail"
  );
  return managed.status === "pass"
    ? setupFinding(
        "setup.standards",
        "warn",
        "Managed standards surfaces are current, but bounded current lint, test, and behavior-preservation proof is unavailable."
      )
    : managed;
}

/** Project workflow secret available without explicit provisioning. */
const IMPLICIT_WORKFLOW_SECRETS = new Set(["GITHUB_TOKEN"]);

/**
 * Whether an unknown field is non-empty operator text.
 * @param value - Untrusted field value
 * @returns Whether the value contains non-whitespace text
 */
function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Canonicalize one strictly source-confined evidence path.
 * @param value - Untrusted source evidence path
 * @returns Normalized wiki/sources path, or undefined when invalid
 */
function normalizeSourceEvidencePath(value: unknown): string | undefined {
  if (!hasText(value) || value.includes("\\") || path.posix.isAbsolute(value)) {
    return undefined;
  }
  const segments = value.split("/");
  if (
    segments.some(
      segment => segment === "" || segment === "." || segment === ".."
    )
  ) {
    return undefined;
  }
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized.startsWith("wiki/sources/")
    ? normalized
    : undefined;
}

/**
 * Refuse symlinks in every parent and inspect the final file with no-follow.
 * @param root - Canonical project root
 * @param evidencePath - Normalized project-relative evidence path
 * @returns Whether the evidence path has safe parents and a regular final file
 */
async function sourceEvidenceIsRegular(
  root: string,
  evidencePath: string
): Promise<boolean> {
  const segments = evidencePath.split("/");
  const parents = segments
    .slice(0, -1)
    .map((_, index) => segments.slice(0, index + 1).join("/"));
  const parentKinds = await Promise.all(
    parents.map(parent => projectPathKind(root, parent))
  );
  if (!parentKinds.every(kind => kind === "directory")) return false;
  return await projectRegularFileExists(root, evidencePath);
}

/**
 * Validate one complete agent-ready source row and its confined evidence.
 * @param root - Canonical project root
 * @param source - Untrusted source-registry row
 * @returns Completeness classification for the source row
 */
async function sourceRowIsComplete(
  root: string,
  source: unknown
): Promise<"complete" | "incomplete" | "invalid"> {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return "invalid";
  }
  const probe = Reflect.get(source, "read_only_probe");
  const evidence = Reflect.get(source, "sanitized_evidence");
  const terminalStatus = Reflect.get(source, "terminal_status");
  const openGap = Reflect.get(source, "open_gap");
  if (
    !hasText(Reflect.get(source, "source_id")) ||
    !hasText(Reflect.get(source, "scope")) ||
    probe === null ||
    typeof probe !== "object" ||
    Array.isArray(probe) ||
    !hasText(Reflect.get(probe, "command")) ||
    !hasText(Reflect.get(probe, "observed")) ||
    typeof terminalStatus !== "string" ||
    !["complete", "partial", "unavailable", "pending"].includes(
      terminalStatus
    ) ||
    (openGap !== null && !hasText(openGap)) ||
    !Array.isArray(evidence) ||
    evidence.length === 0 ||
    evidence.some(item => normalizeSourceEvidencePath(item) === undefined)
  ) {
    return "invalid";
  }
  const canonicalEvidence = evidence.map(item =>
    normalizeSourceEvidencePath(item)
  );
  const regularFiles = await Promise.all(
    canonicalEvidence.map(item => sourceEvidenceIsRegular(root, item!))
  );
  if (!regularFiles.every(Boolean)) return "invalid";
  return terminalStatus === "complete" && openGap === null
    ? "complete"
    : "incomplete";
}

/**
 * Aggregate stable check IDs without interpreting human-readable reasons.
 * @param check - Setup checklist identifier being evaluated
 * @param health - Current deterministic Health evidence, when available
 * @param requiredChecks - Health check identifiers required for readiness
 * @param passReason - Operator-readable reason used when every check passes
 * @param unavailableStatus - Status used when required evidence is absent
 * @returns Setup finding derived from the required Health checks
 */
export function healthEvidenceFinding(
  check: SetupReadinessCheck,
  health: HealthResult | undefined,
  requiredChecks: readonly string[],
  passReason: string,
  unavailableStatus: HealthStatus = "warn"
): SetupReadinessFinding {
  const byCheck = new Map(
    (health?.findings ?? []).map(finding => [finding.check, finding])
  );
  const unavailable = requiredChecks.filter(id => !byCheck.has(id));
  if (unavailable.length > 0) {
    return setupFinding(
      check,
      unavailableStatus,
      `Required deterministic evidence is unavailable: ${unavailable.join(", ")}.`
    );
  }
  const nonPassing = requiredChecks.filter(
    id => byCheck.get(id)?.status !== "pass"
  );
  if (nonPassing.length === 0) {
    return setupFinding(check, "pass", passReason);
  }
  const hasFailure = nonPassing.some(id => byCheck.get(id)?.status === "fail");
  return setupFinding(
    check,
    hasFailure ? "fail" : "warn",
    `Deterministic setup evidence is not passing: ${nonPassing.join(", ")}.`
  );
}

/**
 * Require a complete source registry and no open knowledge gaps.
 * @param projectRoot - Project root containing agent-ready evidence
 * @returns Agent-readiness finding from confined registry and gap evidence
 */
// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity -- one bounded registry-and-evidence validation transaction stays auditable together
export async function agentReadyFinding(
  projectRoot: string
): Promise<SetupReadinessFinding> {
  try {
    const root = await realpath(projectRoot);
    const [registryText, gapsText] = await Promise.all([
      readProjectText(root, "wiki/state/agent-ready/sources.json"),
      readProjectText(root, "wiki/gaps.md"),
    ]);
    if (registryText === undefined || gapsText === undefined) {
      return setupFinding(
        AGENT_READY_CHECK,
        "warn",
        "Agent-ready evidence is incomplete: run /lisa:agent-ready to create the source registry and wiki/gaps.md."
      );
    }
    const parsed = JSON.parse(registryText) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Reflect.get(parsed, "schema_version") !== 1
    ) {
      return setupFinding(
        AGENT_READY_CHECK,
        "fail",
        "The agent-ready source registry is malformed or unsupported."
      );
    }
    requireCanonicalUtcTimestamp(
      Reflect.get(parsed, "updated_at"),
      "agent-ready updated_at"
    );
    const sources = Reflect.get(parsed, "sources");
    if (!Array.isArray(sources) || sources.length === 0) {
      return setupFinding(
        AGENT_READY_CHECK,
        "warn",
        "The agent-ready source registry has no inventoried sources."
      );
    }
    const sourceIds = sources.flatMap(source => {
      if (source === null || typeof source !== "object") return [];
      const id = Reflect.get(source, "source_id");
      return typeof id === "string" ? [id] : [];
    });
    const validations = await Promise.all(
      sources.map(source => sourceRowIsComplete(root, source))
    );
    if (validations.includes("invalid")) {
      return setupFinding(
        AGENT_READY_CHECK,
        "fail",
        "The agent-ready source registry has an invalid row or missing, unsafe, or non-file sanitized evidence."
      );
    }
    const incomplete = validations.filter(
      value => value === "incomplete"
    ).length;
    if (new Set(sourceIds).size !== sources.length) {
      return setupFinding(
        AGENT_READY_CHECK,
        "fail",
        "The agent-ready source registry has missing or duplicate source identifiers."
      );
    }
    const openGaps = [...gapsText.matchAll(/\*\*Status\*\*:\s*open\b/giu)]
      .length;
    if (incomplete > 0 || openGaps > 0) {
      return setupFinding(
        AGENT_READY_CHECK,
        "warn",
        `Knowledge convergence is incomplete: ${incomplete} source record${incomplete === 1 ? "" : "s"} incomplete and ${openGaps} open gap${openGaps === 1 ? "" : "s"}.`
      );
    }
    return setupFinding(
      AGENT_READY_CHECK,
      "pass",
      `All ${sources.length} inventoried sources are complete and wiki/gaps.md has no open gaps.`
    );
  } catch {
    return setupFinding(
      AGENT_READY_CHECK,
      "fail",
      "Agent-ready evidence is unreadable; re-run /lisa:agent-ready."
    );
  }
}

/**
 * Require the optional wiki to exist before accepting the Health wiki check.
 * @param projectRoot - Project root containing the optional wiki
 * @param health - Current deterministic Health evidence, when available
 * @returns Wiki setup readiness finding
 */
export async function wikiSetupFinding(
  projectRoot: string,
  health: HealthResult | undefined
): Promise<SetupReadinessFinding> {
  try {
    const root = await realpath(projectRoot);
    if ((await projectPathKind(root, "wiki")) !== "directory") {
      return setupFinding(
        WIKI_CHECK,
        "warn",
        "Optional LLM wiki is not installed. Run /lisa:wiki:install."
      );
    }
  } catch {
    return setupFinding(
      WIKI_CHECK,
      "fail",
      "The wiki path is unsafe or unreadable."
    );
  }
  return healthEvidenceFinding(
    WIKI_CHECK,
    health,
    ["project.wiki"],
    "The optional LLM wiki contract files are installed."
  );
}

/**
 * Read names referenced as `secrets.NAME` from current workflow files.
 * @param projectRoot - Project root containing GitHub workflows
 * @returns Sorted unique explicit workflow secret names
 */
export async function readWorkflowSecretNames(
  projectRoot: string
): Promise<readonly string[]> {
  try {
    const root = await realpath(projectRoot);
    if ((await projectPathKind(root, ".github/workflows")) !== "directory") {
      return [];
    }
    const directory = resolveProjectPath(root, ".github/workflows");
    const entries = await readdir(directory, { withFileTypes: true });
    const workflowNames = entries
      .filter(entry => entry.isFile() && /\.(?:ya?ml)$/iu.test(entry.name))
      .map(entry => `.github/workflows/${entry.name}`)
      .sort((left, right) => left.localeCompare(right));
    if (workflowNames.length > 100) {
      throw new Error("Workflow secret inventory exceeds the bounded reader");
    }
    const contents = await Promise.all(
      workflowNames.map(name => readProjectText(root, name, 256 * 1024))
    );
    const names = contents.flatMap(content =>
      content === undefined
        ? []
        : [...content.matchAll(/\bsecrets\.([A-Z][A-Z0-9_]*)\b/gu)].map(
            match => match[1]!
          )
    );
    return [...new Set(names)]
      .filter(name => !IMPLICIT_WORKFLOW_SECRETS.has(name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}
