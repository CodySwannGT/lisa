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
import { informationalFindings } from "./doctor-readiness-shared.js";
import { auditExceptionViolations } from "./doctor-readiness-audit-allowlist.js";
import {
  collectSpecs,
  type DependencySpec,
  findAuditGate,
  findLockfile,
  findLockfileInstallGate,
  isFloatingSpec,
  LOCKFILES,
  readManifest,
} from "./doctor-readiness-supply-chain-scan.js";
import {
  resolveWorkspaceMembers,
  type WorkspaceMembers,
} from "./doctor-readiness-workspaces.js";
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
 * Whether a floating-looking spec is really a link to a package in this
 * repository. `"@acme/utils": "*"` against a workspace member resolves to the
 * local package, which is the workspace idiom rather than a floating install —
 * so faulting it would fail every correctly configured monorepo.
 *
 * When workspaces are declared but no member name could be resolved (an
 * unreadable child manifest, an unsupported glob), a bare `*` is exempted
 * anyway: the repository has told us it links locally, and absence of proof is
 * not proof of a violation.
 * @param spec - The declared spec
 * @param workspaces - What resolving the workspace members established
 * @returns True when the spec links to a workspace member
 */
function linksWorkspaceMember(
  spec: DependencySpec,
  workspaces: WorkspaceMembers
): boolean {
  if (!workspaces.declared) {
    return false;
  }
  return (
    workspaces.names.has(spec.name) ||
    (workspaces.names.size === 0 && spec.spec.trim() === "*")
  );
}

/**
 * Assess a repository's dependency confidence model.
 * @param root - Repository root
 * @param specs - Declared dependency specs
 * @param workspaces - What resolving the workspace members established
 * @returns Evidence lines for violations, and non-blocking observations
 */
async function collectFindings(
  root: string,
  specs: readonly DependencySpec[],
  workspaces: WorkspaceMembers
): Promise<{
  readonly violations: readonly string[];
  readonly observations: readonly string[];
}> {
  const lockfile = await findLockfile(root);
  const lockfileInstallGate =
    lockfile === null ? null : await findLockfileInstallGate(root);
  const auditGate = await findAuditGate(root);
  const floating = specs.filter(
    spec => isFloatingSpec(spec.spec) && !linksWorkspaceMember(spec, workspaces)
  );
  return {
    violations: [
      ...(lockfile === null ? [lockfileEvidence(specs.length)] : []),
      ...(lockfile !== null && lockfileInstallGate === null
        ? [
            `lockfile \`${lockfile}\` is committed, but no CI or hook install ` +
              "step was found that enforces it with `npm ci`, " +
              "`bun install --frozen-lockfile`, `pnpm install --frozen-lockfile`, " +
              "or `yarn install --immutable`; a workflow can silently rewrite " +
              "or bypass the tree that was validated",
          ]
        : []),
      ...floating.map(
        spec =>
          `\`package.json\` \`${spec.block}.${spec.name}\` is \`${spec.spec}\`, ` +
          "which resolves to whatever is newest at install time rather than to " +
          "a version anything was ever validated against"
      ),
      ...(auditGate === null
        ? [
            "no dependency-audit gate covering the JavaScript tree was found " +
              "anywhere — no `npm`/`bun` audit step in `.github/workflows/*.yml`, " +
              "none in a git hook, and no `dependabot.yml` npm entry or " +
              "`renovate.json` — so a newly disclosed advisory in this tree " +
              "would never be noticed by anything",
          ]
        : []),
      ...(await auditExceptionViolations(root)),
    ],
    observations: [
      ...(lockfile === null ? [] : [`Lockfile in use: \`${lockfile}\`.`]),
      ...(lockfileInstallGate === null
        ? []
        : [
            `Lockfile-enforcing install declared in \`${lockfileInstallGate}\`.`,
          ]),
      ...(auditGate === null
        ? []
        : [`Dependency-audit gate declared in \`${auditGate}\`.`]),
      ...(workspaces.declared ? [workspaceObservation(workspaces)] : []),
    ],
  };
}

/**
 * State what the workspace exemption actually did.
 *
 * The two cases must not be described in the same words. When member manifests
 * resolved, named packages were exempted because they provably link locally.
 * When none resolved, a bare `*` was exempted on the strength of the
 * `workspaces` declaration alone — a deliberate refusal to manufacture a
 * violation from absence, but NOT a resolved link, and reporting it as
 * "0 package name(s) were exempted" would describe the opposite of what
 * happened.
 * @param workspaces - What resolving the workspace members established
 * @returns One operator-language observation
 */
function workspaceObservation(workspaces: WorkspaceMembers): string {
  return workspaces.names.size > 0
    ? `Workspaces are declared, so ${workspaces.names.size} locally linked ` +
        "package name(s) were exempted from the floating-spec check."
    : "Workspaces are declared but no member manifests resolved offline, so " +
        "bare `*` specs were treated as workspace links rather than as " +
        "floating installs. Whether they really link locally is not established.";
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
 * Describe what the spec check established, without overstating the bare-`*`
 * workspace fallback as a resolved link.
 * @param workspaces - What resolving the workspace members established
 * @returns One clause for the PASS evidence
 */
function describeSpecCleanliness(workspaces: WorkspaceMembers): string {
  return workspaces.declared && workspaces.names.size === 0
    ? "every one names a version, except bare `*` specs exempted because " +
        "workspaces are declared but no member manifests resolved offline"
    : "every one names a version or links a workspace member";
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
  const workspaces = await resolveWorkspaceMembers(root, outcome.manifest);
  const { violations, observations } = await collectFindings(
    root,
    specs,
    workspaces
  );
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
          `Inspected ${specs.length} dependency spec(s) in the root ` +
          `\`package.json\`: ${describeSpecCleanliness(workspaces)}, a ` +
          "lockfile is committed, a dependency-audit gate covering the " +
          "JavaScript tree is declared, and every active audit exception " +
          "carries a written decision. Workspace child manifests are not " +
          "walked, so this speaks only to the root manifest.",
        checked: [SUPPLY_CHAIN_BLOCKER_ID],
      },
      ...informationalFindings(observations),
    ],
  };
}
