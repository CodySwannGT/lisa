// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-gate.mjs
 * @description API transport has authority only over the raw object that passed ordinary hooks.
 * @module npm-updater
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import {
  FILES,
  OBJECT,
  required,
  validateProposal,
  validateRawCommit,
} from "./npm-update-contract.mjs";
import {
  candidateEnvironment,
  runProcess,
  withPrivateRoot,
} from "./npm-update-process.mjs";
import { baseline } from "./npm-update-prepare.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import {
  createHostedGate,
  assertHostedGate,
  remainingGateTime,
} from "./npm-update-hosted-gate.mjs";
import {
  originalHookInstallation,
  runGateStreams,
} from "./npm-update-gate-hooks.mjs";
import {
  installGateProof,
  validateGateProof,
} from "./npm-update-gate-proof.mjs";
import { GitHub } from "./npm-update-github.mjs";
import {
  destinationSnapshot,
  ordinaryGateReceipt,
} from "./npm-update-publication.mjs";
import { executeCanonicalHelper } from "./npm-update-controller-factory.mjs";
import { withStage } from "./npm-update-invariants.mjs";

const BOT = "github-actions[bot]";
const MAIL = "41898282+github-actions[bot]@users.noreply.github.com";

/** Ref transport is closed and complete; publish exactly one new branch. */
export function refTransport(branch, commit, refs) {
  required(
    /^lisa\/npm-[a-f0-9]{64}$/.test(branch) && OBJECT.test(commit),
    "invalid publication ref"
  );
  const expected = `refs/heads/${branch} ${commit} refs/heads/${branch} ${"0".repeat(40)}\n`;
  required(
    refs === expected,
    "omitted, foreign, duplicate or changed pushed ref"
  );
  return expected;
}

/** Ordinary Git retains literal argv/stdin and receives no provider credential. */
function git(cwd, env, args, input, deadline) {
  return runProcess("git", args, {
    cwd,
    env,
    input,
    timeout: deadline === undefined ? 1_800_000 : remainingGateTime(deadline),
    maximum: 3_145_728,
  });
}

/** Preview writes owned Git objects without executing repository or npm code. */
export async function descriptorFor({
  cwd,
  proposal,
  policy,
  automation,
  allocation,
  runId,
  runAttempt,
  epoch,
}) {
  validateProposal(proposal, policy);
  required(
    /^[1-9]\d*$/.test(runId) &&
      /^[1-9]\d*$/.test(runAttempt) &&
      Number.isSafeInteger(epoch) &&
      epoch > 0,
    "invalid actual Actions identity/time"
  );
  return withPrivateRoot(async (root, env) => {
    await baseline(cwd, env, proposal);
    const staged = { ...env, GIT_INDEX_FILE: join(root, "index") };
    await git(cwd, staged, ["read-tree", proposal.parent]);
    for (const file of FILES) {
      const blob = (
        await git(
          cwd,
          staged,
          ["hash-object", "-w", "--stdin"],
          proposal.files[file]
        )
      ).stdout
        .toString()
        .trim();
      await git(cwd, staged, [
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${blob},${file}`,
      ]);
    }
    const tree = (await git(cwd, staged, ["write-tree"])).stdout
      .toString()
      .trim();
    const identity = `${BOT} <${MAIL}> ${epoch} +0000`;
    const message = `chore(deps): update selected npm dependencies\n\nWork-Item: ${allocation.workItem}\nAutomation-Provenance: actions/${runId}/attempts/${runAttempt}\n`;
    const descriptor = {
      version: 1,
      parent: proposal.parent,
      tree,
      author: identity,
      committer: identity,
      files: proposal.hashes,
      messageSha256: sha256(message),
      updates: proposal.updates,
      proposalKey: proposal.bindingKey,
      policySha256: sha256(canonicalJson(automation)),
      queue: policy.repository,
      workItem: allocation.workItem,
      claimCommentId: allocation.claimCommentId,
      claimSha256: allocation.claimSha256,
      runId,
      runAttempt,
    };
    return { descriptor, message, epoch };
  });
}

/** Staging retains the ordinary link/branch commands and refuses foreign checkout bytes first. */
async function stageProposal(context, env) {
  const { cwd, proposal } = context;
  const command = args => git(cwd, env, args, undefined, context.deadline);
  await withStage("gate-baseline", () => baseline(cwd, env, proposal));
  const parent = (await command(["rev-parse", "HEAD"])).stdout
    .toString()
    .trim();
  required(parent === proposal.parent, "gate baseline differs");
  required(
    !(await command(["status", "--porcelain"])).stdout.toString().trim(),
    "gate requires a fresh owned checkout"
  );
  const branch = `lisa/npm-${proposal.key}`;
  await command(["checkout", "-b", branch]);
  await withStage("gate-link", () =>
    executeCanonicalHelper(context, "stage-read", "link")
  );
  await withStage("gate-attach", () =>
    executeCanonicalHelper(context, "stage-read", "attach-branch")
  );
  for (const file of FILES)
    writeFileSync(join(cwd, file), proposal.files[file]);
  await command(["add", "--", ...FILES]);
  return branch;
}

/** Normal commit output is accepted only after exact raw object, diff and full-range readback. */
async function committedProposal(
  { cwd, proposal, preview, deadline },
  env,
  message
) {
  const command = args => git(cwd, env, args, undefined, deadline);
  const committed = await command([
    "commit",
    "--cleanup=verbatim",
    "--file",
    message,
  ]);
  const head = (await command(["rev-parse", "HEAD"])).stdout.toString().trim();
  const raw = (await command(["cat-file", "commit", head])).stdout;
  const parsed = validateRawCommit(raw, preview.descriptor, cwd);
  required(parsed.sha === head, "actual raw commit SHA differs");
  const changed = (
    await command(["diff", "--name-only", proposal.parent, head])
  ).stdout
    .toString()
    .trim()
    .split("\n")
    .sort();
  required(
    changed.join("\n") === FILES.join("\n"),
    "committed diff includes foreign paths"
  );
  const ranges = (
    await command(["rev-list", `${proposal.parent}..${head}`])
  ).stdout
    .toString()
    .trim()
    .split("\n");
  required(
    ranges.length === 1 && ranges[0] === head,
    "previous or omitted commit in publication range"
  );
  return { committed, head, raw, ranges };
}

/** Legacy transport retains exact original stdin and refuses any gate-induced checkout change. */
async function pushProposal(context, env, branch, object) {
  const {
    cwd,
    proposal,
    policy,
    config,
    token,
    allocation,
    hookInstallation,
    deadline,
  } = context;
  const { head } = object;
  const api = new GitHub(config.automationProvenance, token);
  const destination = await destinationSnapshot(
    api,
    proposal,
    allocation,
    head
  );
  const command = args => git(cwd, env, args, undefined, deadline);
  const hook = await originalHookInstallation(cwd, command, hookInstallation);
  const remote = `https://github.com/${policy.repository}.git`;
  const streams = await runGateStreams(
    branch,
    head,
    proposal.parent,
    destination.expectedBranchHead,
    refs =>
      runProcess(hook.path, ["origin", remote], {
        cwd,
        env: {
          ...env,
          LISA_NPM_HOOK_ROLE: refs.includes(` ${proposal.parent}\n`)
            ? "audit"
            : "destination",
        },
        input: refs,
        timeout: remainingGateTime(deadline),
        maximum: 8_388_608,
      })
  );
  required(
    !(await command(["status", "--porcelain"])).stdout.toString().trim(),
    "ordinary gates changed checkout bytes"
  );
  return ordinaryGateReceipt(
    context,
    object,
    hook,
    streams,
    destination,
    remote
  );
}

/** Ordinary commit and original pre-push receive destination/stdin and all ranges. */
export async function gateProposal(context) {
  const scoped = { ...context, deadline: Date.now() + 1_800_000 };
  const { proposal, policy, token, preview } = context;
  await withStage("gate-validate", () => {
    validateProposal(proposal, policy);
    assertHostedGate(context);
    validateGateProof(context);
    required(
      typeof token === "string" && token.length > 0,
      "readonly gate token is absent"
    );
  });
  return withStage("gate-scratch", () =>
    withPrivateRoot(async root => {
      const env = {
        ...candidateEnvironment(root),
        GIT_AUTHOR_NAME: BOT,
        GIT_AUTHOR_EMAIL: MAIL,
        GIT_COMMITTER_NAME: BOT,
        GIT_COMMITTER_EMAIL: MAIL,
        GIT_AUTHOR_DATE: `${preview.epoch} +0000`,
        GIT_COMMITTER_DATE: `${preview.epoch} +0000`,
      };
      const branch = await withStage("gate-stage", () =>
        stageProposal(scoped, env)
      );
      const proofGit = args =>
        git(context.cwd, env, args, undefined, scoped.deadline);
      const message = await withStage("gate-proof", () =>
        installGateProof(context, root, proofGit)
      );
      const hosted = await createHostedGate(scoped, root, env);
      try {
        const gated = { ...scoped, hookInstallation: hosted.installation };
        const object = await withStage("gate-commit", () =>
          committedProposal(
            gated,
            { ...hosted.env, LISA_NPM_HOOK_ROLE: "commit" },
            message
          )
        );
        return await withStage("gate-push", () =>
          pushProposal(gated, hosted.env, branch, object)
        );
      } finally {
        await withStage("gate-close", () => hosted.close());
      }
    })
  );
}
