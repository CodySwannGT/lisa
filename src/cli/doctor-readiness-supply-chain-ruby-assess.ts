/**
 * Ruby/Bundler B5 readiness record construction.
 * @module cli/doctor-readiness-supply-chain-ruby-assess
 */
import { informationalFindings } from "./doctor-readiness-shared.js";
import {
  DEPENDENCIES_SUPPLY_CHAIN_DIMENSION_ID,
  SUPPLY_CHAIN_BLOCKER_ID,
} from "./doctor-readiness-supply-chain-constants.js";
import {
  findRubyAuditGate,
  findRubyLockfile,
  readRubyManifest,
  type RubyDependencySpec,
} from "./doctor-readiness-supply-chain-ruby.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";

/**
 * Build the rubric-shaped B5 finding from evidence lines.
 * @param violations - Evidence lines
 * @returns The B5 finding
 */
function supplyChainFinding(
  violations: readonly string[]
): Record<string, unknown> {
  return {
    blocker: SUPPLY_CHAIN_BLOCKER_ID,
    invariant_violated:
      "belief that the owned surface still works rests on a repeatable install " +
      "and a standing audit, not on hope",
    evidence: violations.join(" | "),
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
 * Build B5 evidence lines for a Ruby/Bundler project.
 * @param specs - Ruby dependency specs under assessment
 * @param lockfile - Committed lockfile path, or null when absent
 * @param auditGate - Audit gate path, or null when absent
 * @returns Evidence lines for B5 violations
 */
function rubySupplyChainViolations(
  specs: readonly RubyDependencySpec[],
  lockfile: string | null,
  auditGate: string | null
): readonly string[] {
  if (specs.length === 0) {
    return [];
  }
  return [
    ...(lockfile === null
      ? [
          `\`Gemfile\` declares ${specs.length} gem dependency spec(s) but ` +
            "no `Gemfile.lock` is committed — two Bundler installs can " +
            "resolve to different gem versions, so what was validated is not " +
            "provably what gets installed",
        ]
      : []),
    ...specs
      .filter(spec => spec.spec === null)
      .map(
        spec =>
          `\`Gemfile\` gem \`${spec.name}\` names no version constraint, so ` +
          "Bundler may resolve whatever satisfies the repository today rather " +
          "than a version any run intentionally chose"
      ),
    ...(auditGate === null
      ? [
          "no Ruby dependency-audit gate was found anywhere — no `bundle " +
            "audit`/`bundler-audit` step in `.github/workflows/*.yml`, none " +
            "in a git hook, and no `dependabot.yml` bundler entry or " +
            "`renovate.json` — so a newly disclosed advisory in this gem tree " +
            "would never be noticed by anything",
        ]
      : []),
  ];
}

/**
 * Assess Ruby/Bundler dependencies when no JavaScript manifest exists.
 * @param root - Repository root to assess
 * @returns The B5 record, or null when no Ruby manifest exists
 */
export async function assessRubyDependenciesSupplyChainDimension(
  root: string
): Promise<ReadinessDimensionRecord | null> {
  const ruby = await readRubyManifest(root);
  if (ruby.kind === "absent") {
    return null;
  }
  if (ruby.kind === "unassessable") {
    return skipRecord(ruby.reason);
  }
  if (ruby.specs.length === 0) {
    return skipRecord(
      "`Gemfile` was found but declares no gem dependencies, so this " +
        "repository owns no Ruby third-party surface a confidence model could " +
        "cover; supply-chain confidence is not established either way"
    );
  }
  const lockfile = await findRubyLockfile(root);
  const auditGate = await findRubyAuditGate(root);
  const violations = rubySupplyChainViolations(ruby.specs, lockfile, auditGate);
  const observations = [
    ...(lockfile === null ? [] : [`Ruby lockfile in use: \`${lockfile}\`.`]),
    ...(auditGate === null
      ? []
      : [`Ruby dependency-audit gate declared in \`${auditGate}\`.`]),
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
          `Inspected ${ruby.specs.length} gem dependency spec(s) in ` +
          "`Gemfile`: each gem names a constraint, `Gemfile.lock` is " +
          "committed, and a Ruby dependency-audit gate is declared.",
        checked: [SUPPLY_CHAIN_BLOCKER_ID],
      },
      ...informationalFindings(observations),
    ],
  };
}
