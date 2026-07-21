/**
 * The context-routing readiness producer — ship blocker B6 (PRD #1739, #1896).
 *
 * Dimension 1 of the `readiness-rubric` asks whether an agent can recover the
 * real job from what is written down. Blocker B6 asks the sharper half of that:
 * does the written word claim only what something actually enforces? An agent
 * that reads "the pre-commit hook always runs the tests" stops verifying, so a
 * documented guarantee with no mechanism behind it is worse than silence.
 *
 * Cross-checking prose against machinery is false-positive-prone, and a standing
 * B6 is not a soft signal: the blocker engine reads a finding's `blocker` id and
 * evidence and never reads its status, so a `WARN` finding naming B6 flips the
 * whole repository to `NOT_READY` exactly as a `FAIL` one would. The `WARN`
 * status communicates confidence to a human reader; it does NOT soften the
 * verdict. **Precision is the only real defense**, which is why three
 * disciplines are load-bearing here:
 *
 * 1. **Only a provable, high-confidence overstatement stands the blocker.** A
 *    claim is faulted only when the sentence names an in-repository mechanism
 *    that survives `classifyMechanism` and still does not exist. Package names,
 *    `org/repo` slugs, git refs, and generated artifacts are classified
 *    `unmappable` rather than missing.
 * 2. **Anything short of that is an observation, never a blocker.** A claim with
 *    no resolvable mechanism, one inside a code fence, or a hedged sentence is
 *    surfaced as a non-blocking finding — never guessed into a violation, and
 *    never dropped into silence.
 * 3. **A clean finding carries no `blocker` key.** A PASS finding that named B6
 *    would report a healthy repository as NOT_READY.
 * @module cli/doctor-readiness-context
 */
import {
  collectClaims,
  type EnforcementClaim,
} from "./doctor-readiness-context-claims.js";
import {
  classifyMechanism,
  type IgnoreMatcher,
  loadIgnoreMatcher,
} from "./doctor-readiness-context-mechanisms.js";
import {
  informationalFindings,
  readFileOrNull,
} from "./doctor-readiness-shared.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";

/** The context-routing readiness dimension id (readiness-rubric, RRR-1). */
export const CONTEXT_ROUTING_DIMENSION_ID = "context-routing";

/** The ship blocker for documentation that overstates enforced guarantees. */
const CONTEXT_BLOCKER_ID = "B6";

/** Most claim lines carried into one finding, to keep the report readable. */
const MAX_EVIDENCE_LINES = 10;

/** Longest quoted claim carried into persisted evidence. */
const MAX_QUOTE_LENGTH = 160;

/** The four positive artifacts that make a repository's context recoverable. */
interface RoutingArtifacts {
  readonly present: readonly string[];
  readonly missing: readonly string[];
}

/**
 * Shorten a quoted claim so persisted evidence stays readable.
 * @param text - The raw claim line
 * @returns The claim, truncated to {@link MAX_QUOTE_LENGTH}
 */
function quoteClaim(text: string): string {
  return text.length > MAX_QUOTE_LENGTH
    ? `${text.slice(0, MAX_QUOTE_LENGTH).trimEnd()}…`
    : text;
}

/** What cross-checking every claim established. */
interface ClaimAudit {
  readonly violations: readonly string[];
  readonly unmappable: readonly string[];
}

/**
 * Cross-check one claim against the mechanisms it names.
 *
 * The claim becomes a violation only when at least one named mechanism is
 * classified `missing` — provably absent AND provably a path this repository
 * would own. Every other outcome is an observation, because a blocker built on
 * a token that might be a package name or a git ref would flip a healthy
 * repository to NOT_READY.
 * @param root - Repository root
 * @param claim - The claim to check
 * @param isIgnored - The repository's ignore matcher
 * @returns Either a violation line, an unmappable line, or neither
 */
async function auditOneClaim(
  root: string,
  claim: EnforcementClaim,
  isIgnored: IgnoreMatcher
): Promise<{ violation?: string; unmappable?: string }> {
  const verdicts = await Promise.all(
    claim.mechanisms.map(async mechanism => ({
      mechanism,
      verdict: await classifyMechanism(root, mechanism, isIgnored),
    }))
  );
  const missing = verdicts
    .filter(entry => entry.verdict === "missing")
    .map(entry => entry.mechanism);
  if (missing.length > 0) {
    const named = missing.map(entry => `\`${entry}\``).join(", ");
    return {
      violation:
        `\`${claim.file}\` line ${claim.line} claims enforcement by ` +
        `${named}, which does not exist in this repository: ` +
        `"${quoteClaim(claim.text)}"`,
    };
  }
  if (verdicts.some(entry => entry.verdict === "present")) {
    return {};
  }
  return {
    unmappable:
      `\`${claim.file}\` line ${claim.line} states a guarantee but names ` +
      `no mechanism this check can resolve to a repository path, so it was ` +
      `not assessed: "${quoteClaim(claim.text)}"`,
  };
}

/**
 * Cross-check every claim against the mechanism it names.
 * @param root - Repository root
 * @param claims - The claims read from the instruction surfaces
 * @returns Evidence lines for overstatements, and unmappable-claim notes
 */
async function auditClaims(
  root: string,
  claims: readonly EnforcementClaim[]
): Promise<ClaimAudit> {
  const isIgnored = await loadIgnoreMatcher(root);
  const audited = await Promise.all(
    claims.map(async claim => await auditOneClaim(root, claim, isIgnored))
  );
  return {
    violations: audited.flatMap(entry =>
      entry.violation === undefined ? [] : [entry.violation]
    ),
    unmappable: audited.flatMap(entry =>
      entry.unmappable === undefined ? [] : [entry.unmappable]
    ),
  };
}

/**
 * Establish which of the four positive context-routing artifacts are present: a
 * canonical `AGENTS.md`, a `CLAUDE.md` pointing at it, a parseable
 * `.lisa.config.json`, and a wiki index.
 * @param root - Repository root
 * @returns The present and missing artifact descriptions
 */
async function inspectRoutingArtifacts(
  root: string
): Promise<RoutingArtifacts> {
  const agents = await readFileOrNull(root, "AGENTS.md");
  const claude = await readFileOrNull(root, "CLAUDE.md");
  const config = await readFileOrNull(root, ".lisa.config.json");
  const wiki = await readFileOrNull(root, "wiki/index.md");
  const checks: readonly (readonly [boolean, string])[] = [
    [agents !== null && agents.trim() !== "", "a canonical `AGENTS.md`"],
    [
      claude !== null && claude.includes("AGENTS.md"),
      "a `CLAUDE.md` pointer to `AGENTS.md`",
    ],
    [
      config !== null && isParseableJson(config),
      "a parseable `.lisa.config.json`",
    ],
    [wiki !== null, "a `wiki/index.md` knowledge index"],
  ];
  return {
    present: checks.flatMap(([ok, label]) => (ok ? [label] : [])),
    missing: checks.flatMap(([ok, label]) => (ok ? [] : [label])),
  };
}

/**
 * Whether a string parses as JSON.
 * @param source - Candidate JSON text
 * @returns True when it parses
 */
function isParseableJson(source: string): boolean {
  try {
    JSON.parse(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the rubric-shaped B6 finding from its evidence lines.
 * @param violations - Evidence lines
 * @returns The B6 finding
 */
function contextFinding(
  violations: readonly string[]
): Record<string, unknown> {
  const shown = violations.slice(0, MAX_EVIDENCE_LINES);
  const overflow = violations.length - shown.length;
  return {
    blocker: CONTEXT_BLOCKER_ID,
    invariant_violated:
      "the written word claims only what something actually enforces",
    evidence:
      shown.join(" | ") +
      (overflow > 0
        ? ` | (+${overflow} further overstatement(s) of the same kind)`
        : ""),
    why_proof_missed:
      "documentation is never executed, so no test, lint rule, or review step " +
      "ever observes that the guarantee it promises has no mechanism behind it " +
      "— and an agent that reads the promise stops checking for itself",
    root_correction:
      "either build the mechanism the sentence names, or rewrite the sentence " +
      "to describe what is actually enforced, so the written word and the " +
      "machinery say the same thing",
    machinery_to_remove: [
      "documented guarantees with no mechanism behind them, which cost trust " +
        "every time an agent relies on one",
    ],
  };
}

/**
 * Build the stated-reason SKIP for a repository whose context routing cannot be
 * established: nothing overstated, but not enough written down to call it clean.
 * @param artifacts - Which routing artifacts are present and missing
 * @param unmappable - Claims that named no resolvable mechanism
 * @returns The SKIP dimension record
 */
function skipRecord(
  artifacts: RoutingArtifacts,
  unmappable: readonly string[]
): ReadinessDimensionRecord {
  return {
    id: CONTEXT_ROUTING_DIMENSION_ID,
    status: "SKIP",
    findings: [
      {
        reason:
          "no documented guarantee was found to overstate anything, but this " +
          "repository is missing " +
          `${artifacts.missing.join(", ")}, so whether an agent can recover the ` +
          "real job from what is written down is not established either way",
        skip: true,
      },
      ...informationalFindings(unmappable),
    ],
  };
}

/**
 * Assess the context-routing dimension: B6, "documentation overstates enforced
 * guarantees". Offline by construction — it reads only the repository's own
 * instruction surfaces and the paths they name — and high-precision by design:
 * it stands B6 only on a named mechanism that demonstrably does not exist, and
 * only ever as `WARN`.
 * @param root - Project root to assess
 * @returns The context-routing dimension record
 */
export async function assessContextRoutingDimension(
  root: string
): Promise<ReadinessDimensionRecord> {
  const claims = await collectClaims(root);
  const { violations, unmappable } = await auditClaims(root, claims);
  const artifacts = await inspectRoutingArtifacts(root);
  if (violations.length > 0) {
    return {
      id: CONTEXT_ROUTING_DIMENSION_ID,
      // WARN, never FAIL: cross-checking prose against machinery is not certain
      // enough offline to fail a repository on, but it is certain enough to say.
      status: "WARN",
      findings: [
        contextFinding(violations),
        ...informationalFindings(unmappable),
      ],
    };
  }
  if (artifacts.missing.length > 0) {
    return skipRecord(artifacts, unmappable);
  }
  return {
    id: CONTEXT_ROUTING_DIMENSION_ID,
    status: "PASS",
    findings: [
      {
        evidence:
          `Cross-checked ${claims.length} documented guarantee(s) across this ` +
          "repository's instruction surfaces: every one that names a mechanism " +
          `names one that exists. Context routing is carried by ` +
          `${artifacts.present.join(", ")}.`,
        checked: [CONTEXT_BLOCKER_ID],
      },
      ...informationalFindings(unmappable),
    ],
  };
}
