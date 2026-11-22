// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Fixed-schema writer evidence and idempotent current claim. @module npm-updater */
import {
  required,
  CLAIM,
  validateProposal,
  policyTarget,
} from "./npm-update-contract.mjs";
import { historyPaths } from "./automation-provenance-contract.mjs";
import { baseline } from "./npm-update-prepare.mjs";
import { locateCheckpoint } from "./npm-update-recovery.mjs";
import { runProcess } from "./npm-update-process.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { registryVersion } from "./npm-update-npm.mjs";
import { discoverSupersession } from "./npm-update-supersession.mjs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { trackerOf, trackerFor } from "./npm-update-tracker.mjs";
import {
  buildDraft,
  qualityGates,
  inspectLeaf,
  leafRoles,
  historicalFiling,
  claimLeaf,
} from "./npm-update-leaf.mjs";
/** Probe the named surfaces, all-state relationships and committed history before filing. */
export async function filingEvidence(api, proposal, config, cwd) {
  await baseline(
    cwd,
    { PATH: process.env.PATH, HOME: "/nonexistent", GIT_TERMINAL_PROMPT: "0" },
    proposal
  );
  const tracker = trackerFor(api, proposal, config);
  await api.main(proposal.parent, proposal.target);
  const search = await tracker.relationships(proposal);
  required(
    !search.incomplete_results && search.total_count <= 100,
    "relationship search is incomplete or oversized"
  );
  for (const item of search.items) await tracker.issue(item.number);
  const history = await runProcess(
    "git",
    [
      "log",
      proposal.parent,
      "--max-count=20",
      "--format=%H %s",
      "--",
      ...historyPaths(proposal),
    ],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: "/nonexistent",
        GIT_TERMINAL_PROMPT: "0",
      },
    }
  );
  const registry = [];
  for (const update of proposal.updates)
    registry.push(await registryVersion(update, proposal));
  const labels = await tracker.vocabulary(proposal);
  return {
    history: {
      command: `git log ${proposal.parent} --max-count=20 -- ${historyPaths(proposal).join(" ")}`,
      result: history.stdout.toString() || "No matching history.",
    },
    search: { query: search.query, total: search.total_count },
    registry,
    labels,
    main: proposal.parent,
  };
}

/** Same selected versions are discovered before deriving a new parent-bound key. */
export async function discoverPrior(api, proposal, context) {
  // With a committed config, the adapter must be the configured one; never GitHub by default.
  const tracker = context
    ? trackerFor(api, proposal, context.config)
    : trackerOf(api, proposal.repository);
  const found = await tracker.searchPrior(proposal);
  required(
    found.incomplete_results === false &&
      Number.isSafeInteger(found.total_count) &&
      found.total_count <= (context ? 100 : 1) &&
      Array.isArray(found.items) &&
      found.items.length === found.total_count,
    "prior selection search is incomplete or ambiguous"
  );
  if (!found.total_count) return { status: "new" };
  if (context && (found.total_count > 1 || found.items[0].state === "closed")) {
    return discoverSupersession(api, proposal, found.items, context);
  }
  const issue = await tracker.issue(found.items[0].number);
  required(
    issue.state === "open" &&
      !issue.pull_request &&
      typeof issue.body === "string",
    "closed or foreign prior proposal is preserved"
  );
  const selected = [
    ...issue.body.matchAll(/^Selection key: ([a-f0-9]{64})$/gm),
  ];
  const parents = [...issue.body.matchAll(/^Base parent: ([a-f0-9]{40})$/gm)];
  required(
    selected.length === 1 &&
      selected[0][1] === proposal.selectionKey &&
      parents.length === 1,
    "prior proposal identity differs"
  );
  return {
    status:
      parents[0][1] === proposal.parent ? "existing" : "stale-outstanding",
    issue,
  };
}

/** Restoration preserves original filing bytes while checking the live claim and holds. */
async function restoredAllocation({
  api,
  proposal,
  policy,
  config,
  prior,
  checkpoint,
  evidence,
  currentEvidence,
}) {
  if (prior.issue) {
    const state = await inspectLeaf(
      prior.issue,
      buildDraft(proposal, policy, config, evidence),
      policy,
      config
    );
    if (checkpoint?.signed) {
      const allocation = checkpoint.payload.allocation;
      required(
        state.claimed &&
          !state.unassigned &&
          state.claims.length === 1 &&
          String(state.claims[0].id) === allocation.claimCommentId &&
          sha256(state.claims[0].body) === allocation.claimSha256 &&
          (await trackerFor(api, policy, config).isManagedActor(
            state.claims[0].user
          )),
        "origin checkpoint current claim changed"
      );
      qualityGates(
        {
          ...allocation.draft,
          title: prior.issue.title,
          body: prior.issue.body,
        },
        proposal,
        policy,
        config,
        evidence
      );
      return { ...allocation, currentEvidence, origin: checkpoint };
    }
  }
}

/** Missing configured lifecycle labels are provisioned before the fresh fixed draft. */
async function ensureLabels({
  api,
  policy,
  config,
  roles,
  currentEvidence,
  prior,
  evidence,
}) {
  for (const name of [
    "type:Task",
    "priority:medium",
    roles.ready,
    roles.claimed,
  ]) {
    if (!currentEvidence.labels.includes(name)) {
      await trackerFor(api, policy, config).ensureRole(name);
      currentEvidence.labels.push(name);
      if (!prior.issue) evidence.labels = currentEvidence.labels;
    }
  }
}

/** The shipped claim and post-write quality check complete one canonical leaf. */
async function completeAllocation({
  api,
  proposal,
  policy,
  config,
  prior,
  evidence,
  currentEvidence,
  roles,
}) {
  const draft = buildDraft(proposal, policy, config, evidence);
  const before = qualityGates(draft, proposal, policy, config, evidence);
  const tracker = trackerFor(api, policy, config);
  let issue = prior.issue ?? (await tracker.createLeaf(draft, proposal));
  const claimed = await claimLeaf(
    api,
    issue,
    draft,
    proposal,
    policy,
    config,
    evidence,
    roles
  );
  issue = claimed.issue;
  const state = claimed.state;
  const after = qualityGates(
    { ...draft, title: issue.title, body: issue.body },
    proposal,
    policy,
    config,
    evidence
  );
  const announcement = `[${policy.repository.split("/")[1]}] Fresh dependency Task ${tracker.ref(issue.number)} is assigned to ${policy.maintainer}. Proposal key: ${proposal.key}. Pre/post writer quality gates completed; ordinary gates and runtime evidence remain required.`;
  if (!issue.comments.some(comment => comment.body === announcement))
    await tracker.comment(issue.number, announcement);
  return {
    number: issue.number,
    workItem: tracker.ref(issue.number),
    claimCommentId: String(state.claims[0].id),
    claimSha256: sha256(CLAIM),
    draft,
    evidence,
    quality: { before, after },
    currentEvidence,
    originalProposal: proposal,
  };
}

/** Fixed writer pre/post quality plus real idempotent claim; no Skill RPC is invented. */
export async function allocateLeaf({
  api,
  proposal: suppliedProposal,
  policy,
  config,
  cwd,
}) {
  let proposal = suppliedProposal;
  validateProposal(proposal, policy);
  const tracker = trackerFor(api, policy, config);
  await api.main(proposal.parent, proposal.target);
  const prior = await discoverPrior(api, proposal, { cwd, config });
  if (prior.status === "stale-outstanding")
    return {
      status: prior.status,
      number: prior.issue.number,
      workItem: tracker.ref(prior.issue.number),
    };
  await tracker.assignable(policy.maintainer);
  const currentEvidence = await filingEvidence(api, proposal, config, cwd);
  if (prior.supersession)
    currentEvidence.supersession = {
      workItem: prior.supersession.workItem,
      cancellationSha256: sha256(`${canonicalJson(prior.supersession)}\n`),
      proposalKey: prior.supersession.oldProposalKey,
    };
  const checkpoint = prior.issue
    ? locateCheckpoint(prior.issue.comments, proposal, policy)
    : undefined;
  if (checkpoint) proposal = checkpoint.payload.proposal;
  const evidence = prior.issue
    ? historicalFiling(prior.issue)
    : currentEvidence;
  const roles = leafRoles(config, policy.repository, policyTarget(policy));
  const inputs = {
    api,
    proposal,
    policy,
    config,
    prior,
    checkpoint,
    evidence,
    currentEvidence,
    roles,
  };
  const restored = await restoredAllocation(inputs);
  if (restored) return restored;
  await ensureLabels(inputs);
  return completeAllocation(inputs);
}
