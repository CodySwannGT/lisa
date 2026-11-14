// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Pure environment, lifecycle and fixed Task data cannot import live claim or quality orchestration. */
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required } from "./npm-update-contract.mjs";
import {
  trackerContract,
  deployBranchEnvironments,
} from "../lisa-work-item.mjs";
import { directoryOf, npmPath } from "./automation-provenance-contract.mjs";

const TRACKER_NAMES = { github: "GitHub", jira: "Jira", linear: "Linear" };

/** GitHub keeps every original queue and ProjectV2 refusal; its blocked/human roles are labels. */
function githubRoles(config, repository) {
  required(
    config.tracker === "github" &&
      repository === `${config.github?.org}/${config.github?.repo}`,
    "configured tracker scope differs"
  );
  required(
    !config.github.queueRepo || config.github.queueRepo === repository,
    "separate umbrella queues are not supported by this producer"
  );
  required(
    !config.github.project &&
      !config.github.projectV2 &&
      !config.github.projects,
    "configured ProjectV2 coordination requires the ordinary writer"
  );
  const build = config.github.labels?.build ?? {};
  return {
    blocked: build.blocked ?? "status:blocked",
    human: build.human_needed ?? "human-needed",
  };
}

/** Jira and Linear block with a workflow status; a human hold is still a plain label. */
function vendorRoles(config, repository) {
  required(
    ["jira", "linear"].includes(config.tracker) &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""),
    "configured tracker scope differs"
  );
  const workflow =
    config.tracker === "jira"
      ? config.jira?.workflow
      : (config.linear?.workflow ?? config.linear?.labels?.build);
  return { blocked: workflow?.blocked ?? "Blocked", human: "human-needed" };
}

/** Immutable host config, not candidate data or local aliases, chooses lifecycle. */
export function leafRoles(config, repository) {
  const held =
    config.tracker === "jira" || config.tracker === "linear"
      ? vendorRoles(config, repository)
      : githubRoles(config, repository);
  const contract = trackerContract(config);
  const targetEnvironment = environment(config);
  const terminal =
    contract.lifecycle.done.find(([name]) => name === targetEnvironment)?.[1] ??
    contract.lifecycle.terminalName;
  required(
    typeof terminal === "string" && terminal.trim().length > 0,
    "configured main environment terminal label is missing"
  );
  const terminals = contract.lifecycle.done.map(([, role]) => role);
  required(
    terminals.every(
      label => typeof label === "string" && label.trim().length > 0
    ),
    "configured terminal labels are invalid"
  );
  const later = contract.lifecycle.roles.filter(
    label =>
      label !== contract.lifecycle.ready &&
      label !== held.blocked &&
      !terminals.includes(label)
  );
  return {
    ready: contract.lifecycle.ready,
    claimed: contract.lifecycle.claimed,
    blocked: held.blocked,
    human: held.human,
    terminal,
    terminals,
    later,
  };
}

/** Reuse the canonical default while refusing an explicitly ambiguous main mapping. */
export function environment(config) {
  const matches = Object.entries(config.deploy?.branches ?? {}).filter(
    ([, branch]) => branch === "main"
  );
  required(
    matches.length <= 1,
    "main requires one unambiguous configured runtime environment"
  );
  // The same map trackerContract exposes for GitHub/Linear; Jira's contract has none.
  const target = deployBranchEnvironments(config).get("main");
  required(target, "main has no configured runtime environment");
  return target;
}

/** A standalone, build-ready Task has complete implementation and terminal evidence. */
export function buildDraft(proposal, policy, config, evidence) {
  const roles = leafRoles(config, policy.repository);
  const env = environment(config);
  const versions = proposal.updates
    .map(update => `${update.name}: ${update.from} -> ${update.to}`)
    .join("\n");
  const bun = Object.hasOwn(proposal, "bunLockSha256");
  // Root paths render exactly as they always have; a subdirectory names its own files.
  const directory = directoryOf(proposal);
  const manifest = npmPath(proposal, "package.json");
  const lock = npmPath(proposal, "package-lock.json");
  const body = `## Context / Business Value

Keep the selected dependencies current while preserving ordinary review, required checks and runtime verification. This Task owns one exact dependency proposal; its implementation ticket is never reused for another update.

## Technical Approach

Base parent: ${proposal.parent}
Proposal key: ${proposal.key}
Selection key: ${proposal.selectionKey}
Update exactly ${manifest} and ${lock}${bun ? " and bun.lock" : ""}:
${versions}
Use the trusted four-job npm updater. Preparation performs an installed-tree npm outdated check and npm ci with lifecycle scripts disabled. Allocation precedes the first attributed commit. Ordinary commit and original pre-push gates remain mandatory. Publish only the exact gated unsigned raw Git object with unchanged parent, tree, identities, times and message. Preserve every unrelated dependency, script and existing assignee. Stop on stale base, unavailable authorization, hold, failed gate or mismatching bytes. Lisa is excluded only with verified local full-apply ownership.

## Acceptance Criteria

\`\`\`gherkin
Scenario: publish one coherent dependency proposal
  Given parent ${proposal.parent} and the selected versions above
  When the trusted updater claims this leaf and completes ordinary gates
  Then the manifest and lock agree and npm ci preserves both file hashes${bun ? " and frozen Bun preserves all three hashes" : ""}
  And the pull request into main contains exactly the gated commit and ${bun ? "three" : "two"} files
Scenario: refuse unauthorized or stale publication
  Given a hold, changed parent, failed gate or mismatching proposal
  When publication is attempted
  Then no branch or pull request is written and a diagnostic reports failure
Scenario: complete ordinary review and runtime verification
  Given the pull request at its current head
  When a trusted human approves and every configured required check succeeds
  Then runtime verification in ${env} provides the declared evidence before closure
\`\`\`

## Out of Scope

No repository scripts, lifecycle execution, package-manager migration, workspaces, merge, deployment, review approval, protection changes or automatic issue closure. No generic Lisa version-only update.

## Repository

${policy.repository}

## Target Backend Environment

Assumption: ${env} — remote default branch main

## Branch Plan

Branch from: main
PR into: main
Derived from: Target Backend Environment ${env} via .lisa.config.json deploy.branches

## Sign-in Required

GitHub Actions runtime token with explicitly reduced job permissions. Trusted maintainer: ${policy.maintainer}. No maintainer credential is used. Allocation alone may sign. Preparation and gates have no provider write or issuance authority.${config.tracker === "github" ? "" : ` Tracker writes use the configured ${TRACKER_NAMES[config.tracker]} API credential.`}

## Source Precedence

Business rules: this exact proposal and ordinary configured policy. Visual: existing application. Flow: existing application. API/data: committed npm manifest, coherent registry lock and installed-tree checks. Stop and report cross-axis conflicts.

## Relationship Search

Historical filing evidence, preserved from initial allocation. Current relationships and eligibility are checked again before each recovery.
Git history command: ${evidence.history.command}
Git history outcome: ${evidence.history.result}
All-state ${TRACKER_NAMES[config.tracker]} query: ${evidence.search.query}
Outcome: every matching record was loaded completely; unrelated work was preserved and exact proposal recovery was checked separately.
Matches are read completely before allocating this deterministic proposal. No parent or PRD lineage is declared; this build-ready standalone Task is one leaf.${evidence.supersession ? `\nSupersedes cancelled proposal ${evidence.supersession.workItem}. Original proposal key: ${evidence.supersession.proposalKey}. Verified cancellation SHA256: ${evidence.supersession.cancellationSha256}. The previous claim, specification and checkpoint are preserved; this leaf has fresh parent-bound authority.` : ""}

## Validation Journey

1. Prepare the selected update from the exact parent with installed npm outdated; record actual exit and versions. [EVIDENCE: cli-output: npm-outdated]
2. Run script-disabled npm ci${bun ? " and Bun1.4.4 frozen installation" : ""} against the proposed files and record unchanged hashes. [EVIDENCE: cli-output: npm-ci]
3. Record normal commit/pre-push hook exits, all-ref stdin/ranges and the exact raw commit identity. [EVIDENCE: test-run-log: ordinary-gates]
4. Read the current-head pull request, required checks and genuine human approval. [EVIDENCE: state-dump: current-head-review]
5. Verify ordinary application behavior in ${env}; record actual environment and deployed identity. [EVIDENCE: test-run-log: runtime-verification]
6. Reach a stale-base or hold rejection before any publication write. [EVIDENCE: cli-output: rejected-publication]

## Proposal Bytes

${manifest} SHA256: ${proposal.hashes[manifest]}
${lock} SHA256: ${proposal.hashes[lock]}${bun ? `\nbun.lock SHA256: ${proposal.hashes["bun.lock"]}\nOriginal bun.lock SHA256: ${proposal.bunLockSha256}` : ""}

<!-- [lisa-npm-filing] ${Buffer.from(canonicalJson(evidence)).toString("base64")} -->
<!-- [lisa-npm-proposal] ${proposal.key} -->
`;
  return {
    title:
      directory === "."
        ? "Update selected npm dependencies"
        : `Update selected npm dependencies in ${directory}`,
    body,
    labels: ["type:Task", "priority:medium", roles.ready],
    assignees: [policy.maintainer],
    build_ready: true,
  };
}
