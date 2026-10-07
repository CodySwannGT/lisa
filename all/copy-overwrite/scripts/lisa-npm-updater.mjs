#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file lisa-npm-updater.mjs
 * @description Four phase entry points consume bounded data from a committed trusted host policy.
 * @module npm-updater
 */
import { join, resolve } from "node:path";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  required,
  keys,
  validatePolicy,
  validateProposal,
} from "./lib/npm-update-contract.mjs";
import { publicFailure, withStage } from "./lib/npm-update-invariants.mjs";
import {
  readJson,
  writeJson,
  runProcess,
  phaseDirectory,
} from "./lib/npm-update-process.mjs";
import { prepareUpdate } from "./lib/npm-update-prepare.mjs";
import { GitHub } from "./lib/npm-update-github.mjs";
import { allocateLeaf } from "./lib/npm-update-allocate.mjs";
import { publishProposal } from "./lib/npm-update-publish.mjs";
import {
  prepareAuthorization,
  finalizeAuthorization,
} from "./lib/npm-update-authorization.mjs";
import { gateProposal } from "./lib/npm-update-gate.mjs";
import { readGateProof } from "./lib/npm-update-gate-proof.mjs";
import { sha256 } from "./lib/github-attestation-verifier.mjs";
import {
  prepareCancellation,
  finalizeCancellation,
} from "./lib/npm-update-cancellation.mjs";
const CANCEL_PREPARE = "cancel-prepare";
const PHASES = [
  "prepare",
  "allocate",
  "checkpoint",
  "gate",
  "publish",
  CANCEL_PREPARE,
  "cancel-checkpoint",
];

/** Three complete literal fields identify one old leaf and the exact expected current main. */
export function cancellationRequest(env = process.env) {
  required(
    typeof env.CANCEL_ISSUE === "string" && /^[1-9]\d*$/.test(env.CANCEL_ISSUE),
    "exact cancellation issue number required"
  );
  const number = Number(env.CANCEL_ISSUE);
  required(
    Number.isSafeInteger(number) &&
      String(number) === env.CANCEL_ISSUE &&
      typeof env.CANCEL_PROPOSAL_KEY === "string" &&
      /^[a-f0-9]{64}$/.test(env.CANCEL_PROPOSAL_KEY) &&
      typeof env.CANCEL_EXPECTED_MAIN === "string" &&
      /^[a-f0-9]{40}$/.test(env.CANCEL_EXPECTED_MAIN),
    "complete exact cancellation identity required"
  );
  return {
    number,
    proposalKey: env.CANCEL_PROPOSAL_KEY,
    parent: env.CANCEL_EXPECTED_MAIN,
  };
}

/** Cancellation stays inside the same trusted issuer job and never consumes ordinary publication slots. */
async function cancellationPhase(cwd, output, proposal, config, phase) {
  const api = new GitHub(config.automationProvenance, process.env.GH_TOKEN);
  const context = {
    api,
    cwd,
    output,
    proposal,
    config,
    request: cancellationRequest(),
  };
  const result = await (
    phase === CANCEL_PREPARE ? prepareCancellation : finalizeCancellation
  )(context);
  process.stdout.write(
    `${phase === CANCEL_PREPARE ? result.mode : result.status}\n`
  );
}

/** Only committed policy grants authority; ignored/local config cannot activate Actions. */
async function configuration(cwd) {
  const result = await runProcess("git", ["show", "HEAD:.lisa.config.json"], {
    cwd,
    env: { PATH: process.env.PATH, HOME: "/nonexistent" },
    maximum: 1_048_576,
  });
  const config = JSON.parse(result.stdout.toString());
  required(
    config.automationProvenance?.enabled === true,
    "automation provenance must be explicitly configured on committed main"
  );
  const policy = validatePolicy(config.npmUpdater, config);
  required(
    config.automationProvenance.repository === policy.repository,
    "committed authority repository differs"
  );
  return { config, policy };
}

/** Allocation creates its canonical leaf before previewing any attributed commit. */
async function allocatePhase(cwd, output, proposal, policy, config) {
  const api = new GitHub(config.automationProvenance, process.env.GH_TOKEN);
  const allocation = await allocateLeaf({
    api,
    proposal,
    policy,
    config,
    cwd,
  });
  const result = await prepareAuthorization({
    api,
    cwd,
    output,
    proposal,
    allocation,
    policy,
    config,
  });
  if (result.mode === "stale-outstanding")
    writeJson(join(output, "authorization.json"), {
      mode: result.mode,
      workItem: allocation.workItem,
    });
  process.stdout.write(`${result.mode}\n`);
}

/** Publication consumes the fixed gated object and proof slots without changing authority order. */
async function publishPhase(
  cwd,
  output,
  proposal,
  policy,
  config,
  allocation,
  preview
) {
  const gated = readJson(join(output, "gated.json"));
  keys(gated, ["raw", "receipt"]);
  required(
    typeof gated.raw === "string" && gated.raw.length <= 90_000,
    "bounded raw commit envelope required"
  );
  const api = new GitHub(config.automationProvenance, process.env.GH_TOKEN);
  const result = await publishProposal({
    api,
    cwd,
    proposal,
    policy,
    config,
    allocation,
    descriptor: preview.descriptor,
    proof: {
      descriptor: join(output, "descriptor.json"),
      bundle: join(output, "bundle.json"),
      recovery: join(output, "recovery.json"),
      recoveryBundle: join(output, "recovery-bundle.json"),
    },
    receipt: gated.receipt,
    raw: Buffer.from(gated.raw, "base64"),
  });
  writeJson(join(output, "published.json"), result);
  process.stdout.write(`${result.status} ${result.url}\n`);
}

/** Gate input/output classification preserves the original orchestration and authority order. */
async function gatePhase(
  cwd,
  output,
  proposal,
  policy,
  config,
  allocation,
  preview
) {
  const result = await gateProposal({
    cwd,
    proposal,
    policy,
    allocation,
    preview,
    ...(await withStage("gate-input", () => readGateProof(output))),
    token: process.env.GH_TOKEN,
    config,
  });
  await withStage("gate-output", () =>
    writeJson(join(output, "gated.json"), result)
  );
  process.stdout.write(`gated ${result.receipt.commit}\n`);
}

/** Strict phase and fixed directory arguments are data, never a caller recipe. */
export async function main(argv = process.argv.slice(2)) {
  required(
    argv.length === 3 && PHASES.includes(argv[0]),
    "usage: lisa-npm-updater.mjs <prepare|allocate|checkpoint|gate|publish|cancel-prepare|cancel-checkpoint> <owned-checkout> <private-phase-directory>"
  );
  const [phase, checkout, directory] = argv;
  const cwd = resolve(checkout);
  const output = resolve(directory);
  const { config, policy } = await withStage("configuration", () =>
    configuration(cwd)
  );
  phaseDirectory(output);
  if (phase === "prepare") {
    const result = await prepareUpdate({ cwd, policy, config });
    writeJson(join(output, "prepare.json"), result);
    if (result.status === "prepared")
      writeJson(join(output, "proposal.json"), result.proposal);
    process.stdout.write(`${result.status}\n`);
    return;
  }
  const proposal = validateProposal(
    readJson(join(output, "proposal.json")),
    policy
  );
  if (phase === CANCEL_PREPARE || phase === "cancel-checkpoint") {
    return cancellationPhase(cwd, output, proposal, config, phase);
  }
  if (phase === "allocate")
    return allocatePhase(cwd, output, proposal, policy, config);
  const allocation = readJson(join(output, "allocation.json"));
  const preview = readJson(join(output, "preview.json"));
  keys(preview, ["descriptor", "message", "epoch"]);
  required(
    sha256(preview.message) === preview.descriptor.messageSha256,
    "preview final message differs"
  );
  if (phase === "checkpoint") {
    const api = new GitHub(config.automationProvenance, process.env.GH_TOKEN);
    const result = await finalizeAuthorization({
      api,
      output,
      proposal,
      allocation,
      preview,
      policy,
      config,
    });
    process.stdout.write(`${result.mode} checkpoint complete\n`);
    return;
  }
  if (phase === "gate")
    return gatePhase(
      cwd,
      output,
      proposal,
      policy,
      config,
      allocation,
      preview
    );
  return publishPhase(
    cwd,
    output,
    proposal,
    policy,
    config,
    allocation,
    preview
  );
}

if (invokedAsScript(import.meta.url))
  main().catch(error => {
    // Never print candidate/provider payloads or child output that may contain credentials.
    process.stderr.write(`${publicFailure(error)}\n`);
    process.exitCode = 1;
  });
