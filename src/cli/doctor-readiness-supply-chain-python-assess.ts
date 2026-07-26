/**
 * Python/Poetry B5 readiness record construction.
 * @module cli/doctor-readiness-supply-chain-python-assess
 */
import { informationalFindings } from "./doctor-readiness-shared.js";
import {
  DEPENDENCIES_SUPPLY_CHAIN_DIMENSION_ID,
  MAX_EVIDENCE_LINES,
  SUPPLY_CHAIN_BLOCKER_ID,
} from "./doctor-readiness-supply-chain-constants.js";
import {
  findPythonAuditGate,
  findPythonLockfile,
  isFloatingPythonSpec,
  readPythonManifest,
  type PythonDependencySpec,
} from "./doctor-readiness-supply-chain-python.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";

const PYPROJECT_TOML = "pyproject.toml";
const POETRY_LOCK = "poetry.lock";

/**
 * Build the rubric-shaped B5 finding from evidence lines.
 * @param violations - Evidence lines
 * @returns The B5 finding
 */
function supplyChainFinding(
  violations: readonly string[]
): Record<string, unknown> {
  const shown = violations.slice(0, MAX_EVIDENCE_LINES);
  const overflow = violations.length - shown.length;
  return {
    blocker: SUPPLY_CHAIN_BLOCKER_ID,
    invariant_violated:
      "belief that the owned surface still works rests on a repeatable install " +
      "and a standing audit, not on hope",
    evidence:
      shown.join(" | ") +
      (overflow > 0
        ? ` | (+${overflow} further finding(s) of the same kind)`
        : ""),
    why_proof_missed:
      "the test suite proves things about the code in the tree it happened to " +
      "install, so a tree that drifts — or one carrying a known advisory nobody " +
      "checks for — still reports green",
    root_correction:
      "commit a lockfile, name a version for every dependency spec, and run a " +
      "dependency audit on every push",
    machinery_to_remove: [
      "manual dependency review with no standing lockfile and audit gate",
    ],
  };
}

/**
 * Build a stated-reason SKIP record.
 * @param reason - Why the dimension was not assessed
 * @returns The SKIP dimension record
 */
function skipRecord(reason: string): ReadinessDimensionRecord {
  return {
    id: DEPENDENCIES_SUPPLY_CHAIN_DIMENSION_ID,
    status: "SKIP",
    findings: [{ reason, skip: true }],
  };
}

/**
 * Build B5 evidence lines for a Python/Poetry project.
 * @param specs - Poetry dependency specs under assessment
 * @param lockfile - Committed lockfile path, or null when absent
 * @param auditGate - Audit gate path, or null when absent
 * @returns Evidence lines for B5 violations
 */
function pythonSupplyChainViolations(
  specs: readonly PythonDependencySpec[],
  lockfile: string | null,
  auditGate: string | null
): readonly string[] {
  if (specs.length === 0) {
    return [];
  }
  return [
    ...(lockfile === null
      ? [
          `\`${PYPROJECT_TOML}\` declares ${specs.length} Poetry dependency ` +
            `spec(s) but no \`${POETRY_LOCK}\` is committed — two Poetry ` +
            "installs can resolve to different package versions, so what was " +
            "validated is not provably what gets installed",
        ]
      : []),
    ...specs
      .filter(spec => isFloatingPythonSpec(spec.spec))
      .map(
        spec =>
          `\`${PYPROJECT_TOML}\` Poetry dependency \`${spec.name}\` names no ` +
          "version constraint, so Poetry may resolve whatever satisfies the " +
          "repository today rather than a version any run intentionally chose"
      ),
    ...(auditGate === null
      ? [
          "no Python dependency-audit gate was found anywhere — no " +
            "`pip-audit`/`safety check`/`safety scan`/`osv-scanner` step in " +
            "`.github/workflows/*.yml`, none in a git hook, and no " +
            "`dependabot.yml` pip entry or Python Renovate manager — so a " +
            "newly disclosed advisory in this Python tree would never be " +
            "noticed by anything",
        ]
      : []),
  ];
}

/**
 * Assess Python/Poetry dependencies when no JavaScript manifest exists.
 * @param root - Repository root to assess
 * @returns The B5 record, or null when no Python manifest exists
 */
export async function assessPythonDependenciesSupplyChainDimension(
  root: string
): Promise<ReadinessDimensionRecord | null> {
  const python = await readPythonManifest(root);
  if (python.kind === "absent") {
    return null;
  }
  if (python.kind === "unassessable") {
    return skipRecord(python.reason);
  }
  if (python.specs.length === 0) {
    return skipRecord(
      "`pyproject.toml` was found but declares no Poetry dependencies, so " +
        "this repository owns no Python third-party surface a confidence " +
        "model could cover; supply-chain confidence is not established either way"
    );
  }
  const lockfile = await findPythonLockfile(root);
  const auditGate = await findPythonAuditGate(root);
  const violations = pythonSupplyChainViolations(
    python.specs,
    lockfile,
    auditGate
  );
  const observations = [
    ...(lockfile === null ? [] : [`Python lockfile in use: \`${lockfile}\`.`]),
    ...(auditGate === null
      ? []
      : [`Python dependency-audit gate declared in \`${auditGate}\`.`]),
  ];
  if (violations.length > 0) {
    return {
      id: DEPENDENCIES_SUPPLY_CHAIN_DIMENSION_ID,
      status: "FAIL",
      findings: [
        supplyChainFinding(violations),
        ...informationalFindings(observations),
      ],
    };
  }
  return {
    id: DEPENDENCIES_SUPPLY_CHAIN_DIMENSION_ID,
    status: "PASS",
    findings: [
      {
        evidence:
          `Inspected ${python.specs.length} Poetry dependency spec(s) in ` +
          "`pyproject.toml`: each dependency names a constraint, " +
          "`poetry.lock` is committed, and a Python dependency-audit gate is " +
          "declared.",
        checked: [SUPPLY_CHAIN_BLOCKER_ID],
      },
      ...informationalFindings(observations),
    ],
  };
}
