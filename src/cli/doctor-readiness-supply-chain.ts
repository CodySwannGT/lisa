/**
 * The dependencies/supply-chain readiness producer — ship blocker B5
 * (PRD #1739, #1896).
 *
 * Dimension 6 of the `readiness-rubric` asks whether belief that the owned
 * surface still works rests on more than hope. Four things, read offline from
 * the repository's own files, decide that: the dependency tree resolves to the
 * same versions twice (a lockfile), the manifest names versions rather than
 * "whatever is newest" (no floating specs), something somewhere actually audits
 * the tree (a CI scan, a git hook, or an update bot), and every audit exception
 * carries the decision that made it acceptable.
 *
 * Two disciplines are load-bearing rather than stylistic:
 *
 * 1. **A finding names a `blocker` id ONLY on an actual violation.** The blocker
 *    engine stands a blocker up on any finding that names an id and carries
 *    evidence, regardless of the finding's status — so a clean repository's PASS
 *    finding must carry no `blocker` key, or a healthy repository reports
 *    NOT_READY.
 * The scanning half — reading the manifest, the lockfile, the audit gates, and
 * the audit allowlists — lives in `doctor-readiness-supply-chain-scan`; this
 * module turns what it found into the rubric-shaped dimension record.
 *
 * 2. **Never manufacture RED or GREEN from absence.** A repository with no
 *    manifest, an unparseable manifest, or no declared dependencies owns no
 *    dependency surface this producer can speak to, so it renders a
 *    stated-reason SKIP — never a violation, and never a false-green PASS.
 * @module cli/doctor-readiness-supply-chain
 */
import {
  auditExceptionViolations,
  collectSpecs,
  type DependencySpec,
  findAuditGate,
  findLockfile,
  isFloatingSpec,
  LOCKFILES,
  readManifest,
} from "./doctor-readiness-supply-chain-scan.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";

/** The dependencies/supply-chain readiness dimension id (readiness-rubric). */
export const DEPENDENCIES_SUPPLY_CHAIN_DIMENSION_ID =
  "dependencies-supply-chain";

/** The ship blocker for an owned surface with no confidence model. */
const SUPPLY_CHAIN_BLOCKER_ID = "B5";

/** Most evidence lines carried into a single finding, to keep it readable. */
const MAX_EVIDENCE_LINES = 12;

/**
 * Build the evidence line for a manifest with no committed lockfile.
 * @param specCount - How many specs the manifest declares
 * @returns One evidence line
 */
function lockfileEvidence(specCount: number): string {
  return (
    `\`package.json\` declares ${specCount} dependency spec(s) but no lockfile ` +
    `is committed (looked for ${LOCKFILES.join(", ")}) — two installs can ` +
    "resolve to different trees, so what was validated is not provably what " +
    "gets installed"
  );
}

/**
 * Assess a repository's dependency confidence model.
 * @param root - Repository root
 * @param specs - Declared dependency specs
 * @returns Evidence lines for violations, and non-blocking observations
 */
async function collectFindings(
  root: string,
  specs: readonly DependencySpec[]
): Promise<{
  readonly violations: readonly string[];
  readonly observations: readonly string[];
}> {
  const lockfile = await findLockfile(root);
  const auditGate = await findAuditGate(root);
  const floating = specs.filter(spec => isFloatingSpec(spec.spec));
  return {
    violations: [
      ...(lockfile === null ? [lockfileEvidence(specs.length)] : []),
      ...floating.map(
        spec =>
          `\`package.json\` \`${spec.block}.${spec.name}\` is \`${spec.spec}\`, ` +
          "which resolves to whatever is newest at install time rather than to " +
          "a version anything was ever validated against"
      ),
      ...(auditGate === null
        ? [
            "no dependency-audit gate was found anywhere — no `npm`/`bun` audit " +
              "step in `.github/workflows/*.yml`, none in a git hook, and no " +
              "`dependabot.yml`/`renovate.json` — so a newly disclosed advisory " +
              "in this tree would never be noticed by anything",
          ]
        : []),
      ...(await auditExceptionViolations(root)),
    ],
    observations: [
      ...(lockfile === null ? [] : [`Lockfile in use: \`${lockfile}\`.`]),
      ...(auditGate === null
        ? []
        : [`Dependency-audit gate declared in \`${auditGate}\`.`]),
    ],
  };
}

/**
 * Build the rubric-shaped B5 finding from its evidence lines.
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
      "commit a lockfile, name a version for every dependency spec, run a " +
      "dependency audit on every push, and record the decision behind each " +
      "audit exception next to the exception itself",
    machinery_to_remove: [
      "audit exceptions kept alive with no written decision, which cost review " +
        "attention every cycle and prove nothing",
    ],
  };
}

/**
 * Wrap non-blocking observations as findings. They deliberately carry no
 * `blocker` key: naming one would stand a blocker up on an observation.
 * @param notes - Informational lines
 * @returns Findings, one per note
 */
function informationalFindings(
  notes: readonly string[]
): readonly Record<string, unknown>[] {
  return notes.map(note => ({ observation: note, blocking: false }));
}

/**
 * Build the stated-reason SKIP for a repository with no assessable manifest.
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
 * Assess the dependencies/supply-chain dimension: B5, "an owned compatibility or
 * security surface has no confidence model". Offline by construction — it reads
 * only the repository's manifest, lockfiles, CI declarations, git hooks, and
 * audit allowlists, and degrades to a stated-reason SKIP wherever those files
 * cannot settle the question.
 * @param root - Project root to assess
 * @returns The dependencies/supply-chain dimension record
 */
export async function assessDependenciesSupplyChainDimension(
  root: string
): Promise<ReadinessDimensionRecord> {
  const outcome = await readManifest(root);
  if (outcome.kind === "unassessable") {
    return skipRecord(outcome.reason);
  }
  const specs = collectSpecs(outcome.manifest);
  if (specs.length === 0) {
    return skipRecord(
      "`package.json` declares no dependencies, so this repository owns no " +
        "third-party surface a confidence model could cover; supply-chain " +
        "confidence is not established either way"
    );
  }
  const { violations, observations } = await collectFindings(root, specs);
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
          `Inspected ${specs.length} dependency spec(s) in \`package.json\`: ` +
          "every one names a version, a lockfile is committed, a dependency " +
          "audit gate is declared, and every audit exception carries a written " +
          "decision.",
        checked: [SUPPLY_CHAIN_BLOCKER_ID],
      },
      ...informationalFindings(observations),
    ],
  };
}
