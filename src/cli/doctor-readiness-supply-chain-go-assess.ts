/**
 * Go module B5 readiness record construction.
 * @module cli/doctor-readiness-supply-chain-go-assess
 */
import { informationalFindings } from "./doctor-readiness-shared.js";
import {
  DEPENDENCIES_SUPPLY_CHAIN_DIMENSION_ID,
  MAX_EVIDENCE_LINES,
  SUPPLY_CHAIN_BLOCKER_ID,
} from "./doctor-readiness-supply-chain-constants.js";
import {
  findGoAuditGate,
  findGoLockfile,
  isFloatingGoSpec,
  readGoManifest,
  type GoDependencySpec,
} from "./doctor-readiness-supply-chain-go.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";

const GO_MOD = "go.mod";
const GO_SUM = "go.sum";

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
      "commit a module checksum file, name a version for every module " +
      "requirement, and run a Go dependency audit on every push",
    machinery_to_remove: [
      "manual dependency review with no standing module checksum and audit gate",
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
 * Build B5 evidence lines for a Go module project.
 * @param specs - Go module requirements under assessment
 * @param lockfile - Committed checksum file path, or null when absent
 * @param auditGate - Audit gate path, or null when absent
 * @returns Evidence lines for B5 violations
 */
function goSupplyChainViolations(
  specs: readonly GoDependencySpec[],
  lockfile: string | null,
  auditGate: string | null
): readonly string[] {
  if (specs.length === 0) {
    return [];
  }
  return [
    ...(lockfile === null
      ? [
          `\`${GO_MOD}\` declares ${specs.length} Go module requirement(s) ` +
            `but no \`${GO_SUM}\` is committed — two module downloads can ` +
            "resolve to different transitive checksums, so what was " +
            "validated is not provably what gets installed",
        ]
      : []),
    ...specs
      .filter(spec => isFloatingGoSpec(spec.spec))
      .map(
        spec =>
          `\`${GO_MOD}\` module \`${spec.name}\` names no pinned version, so ` +
          "Go may resolve a branch or latest module state rather than a " +
          "version any run intentionally chose"
      ),
    ...(auditGate === null
      ? [
          "no Go dependency-audit gate was found anywhere — no " +
            "`govulncheck`/`osv-scanner` step in `.github/workflows/*.yml`, " +
            "none in a git hook, and no `dependabot.yml` gomod entry or Go " +
            "Renovate manager — so a newly disclosed advisory in this module " +
            "tree would never be noticed by anything",
        ]
      : []),
  ];
}

/**
 * Assess Go module dependencies when no JavaScript manifest exists.
 * @param root - Repository root to assess
 * @returns The B5 record, or null when no Go manifest exists
 */
export async function assessGoDependenciesSupplyChainDimension(
  root: string
): Promise<ReadinessDimensionRecord | null> {
  const go = await readGoManifest(root);
  if (go.kind === "absent") {
    return null;
  }
  if (go.specs.length === 0) {
    return skipRecord(
      "`go.mod` was found but declares no module requirements, so this " +
        "repository owns no Go third-party surface a confidence model could " +
        "cover; supply-chain confidence is not established either way"
    );
  }
  const lockfile = await findGoLockfile(root);
  const auditGate = await findGoAuditGate(root);
  const violations = goSupplyChainViolations(go.specs, lockfile, auditGate);
  const observations = [
    ...(lockfile === null ? [] : [`Go checksum file in use: \`${lockfile}\`.`]),
    ...(auditGate === null
      ? []
      : [`Go dependency-audit gate declared in \`${auditGate}\`.`]),
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
          `Inspected ${go.specs.length} Go module requirement(s) in ` +
          "`go.mod`: each module names a pinned version, `go.sum` is " +
          "committed, and a Go dependency-audit gate is declared.",
        checked: [SUPPLY_CHAIN_BLOCKER_ID],
      },
      ...informationalFindings(observations),
    ],
  };
}
