// This file is managed by Lisa. Durable changes belong upstream.
/**
 * @file npm-update-gate.mjs
 * @description API transport has authority only over the raw object that passed ordinary hooks.
 * @module npm-updater
 */
import { mkdirSync, writeFileSync, readFileSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  writeJson,
  withPrivateRoot,
} from "./npm-update-process.mjs";
import { baseline } from "./npm-update-prepare.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { loadRuntime } from "./npm-update-gate-install.mjs";
import { originalPrePush } from "./npm-update-gate-hooks.mjs";

const WORK_ITEM = fileURLToPath(
  new URL("../lisa-work-item.mjs", import.meta.url)
);
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

/** All Git inputs remain argv/stdin bytes; only the gate has a readonly token. */
function git(cwd, env, args, input) {
  return runProcess("git", args, {
    cwd,
    env,
    input,
    timeout: 1_800_000,
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
async function stageProposal({ cwd, proposal, allocation }, env) {
  await baseline(cwd, env, proposal);
  const parent = (await git(cwd, env, ["rev-parse", "HEAD"])).stdout
    .toString()
    .trim();
  required(parent === proposal.parent, "gate baseline differs");
  required(
    !(await git(cwd, env, ["status", "--porcelain"])).stdout.toString().trim(),
    "gate requires a fresh owned checkout"
  );
  const branch = `lisa/npm-${proposal.key}`;
  await git(cwd, env, ["checkout", "-b", branch]);
  await runProcess(process.execPath, [WORK_ITEM, "link", allocation.workItem], {
    cwd,
    env,
  });
  await runProcess(process.execPath, [WORK_ITEM, "attach-branch"], {
    cwd,
    env,
  });
  for (const file of FILES)
    writeFileSync(join(cwd, file), proposal.files[file]);
  await git(cwd, env, ["add", "--", ...FILES]);
  return branch;
}

/** Proof and commit-message files are exclusive private inputs, never candidate receipts. */
async function gateProof({ cwd, preview, bundle }, root, env) {
  const control = (
    await git(cwd, env, ["rev-parse", "--git-common-dir"])
  ).stdout
    .toString()
    .trim();
  const proof = resolve(cwd, control, "lisa/automation-provenance");
  mkdirSync(proof, { recursive: true, mode: 0o700 });
  required(
    lstatSync(proof).isDirectory() && !lstatSync(proof).isSymbolicLink(),
    "proof directory is aliased"
  );
  writeJson(join(proof, "descriptor.json"), preview.descriptor);
  writeFileSync(join(proof, "bundle.json"), bundle, {
    mode: 0o600,
    flag: "wx",
  });
  const message = join(root, "message");
  writeFileSync(message, preview.message, { mode: 0o600 });
  return message;
}

/** Normal commit output is accepted only after exact raw object, diff and full-range readback. */
async function committedProposal({ cwd, proposal, preview }, env, message) {
  const committed = await git(cwd, env, [
    "commit",
    "--cleanup=verbatim",
    "--file",
    message,
  ]);
  const head = (await git(cwd, env, ["rev-parse", "HEAD"])).stdout
    .toString()
    .trim();
  const raw = (await git(cwd, env, ["cat-file", "commit", head])).stdout;
  const parsed = validateRawCommit(raw, preview.descriptor, cwd);
  required(parsed.sha === head, "actual raw commit SHA differs");
  const changed = (
    await git(cwd, env, ["diff", "--name-only", proposal.parent, head])
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
    await git(cwd, env, ["rev-list", `${proposal.parent}..${head}`])
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
async function pushProposal(
  { cwd, proposal, policy, preview },
  env,
  branch,
  object
) {
  const { head, committed, raw, ranges } = object;
  const refs = refTransport(
    branch,
    head,
    `refs/heads/${branch} ${head} refs/heads/${branch} ${"0".repeat(40)}\n`
  );
  const hook = await originalPrePush(cwd, args => git(cwd, env, args));
  const remote = `https://github.com/${policy.repository}.git`;
  const pushed = await runProcess(hook, ["origin", remote], {
    cwd,
    env,
    input: refs,
    timeout: 1_800_000,
    maximum: 8_388_608,
  });
  required(
    !(await git(cwd, env, ["status", "--porcelain"])).stdout.toString().trim(),
    "ordinary gates changed checkout bytes"
  );
  return {
    raw: raw.toString("base64"),
    receipt: {
      version: 1,
      proposalKey: proposal.key,
      parent: proposal.parent,
      tree: preview.descriptor.tree,
      commit: head,
      commitExit: committed.code,
      pushExit: pushed.code,
      refs,
      remote,
      range: ranges,
      hookSha256: sha256(readFileSync(join(cwd, ".husky/pre-push"))),
      commitLogSha256: sha256(
        Buffer.concat([committed.stdout, committed.stderr])
      ),
      pushLogSha256: sha256(Buffer.concat([pushed.stdout, pushed.stderr])),
    },
  };
}

/** Ordinary commit and original pre-push receive destination/stdin and all ranges. */
export async function gateProposal(context) {
  const { proposal, policy, token, config, preview } = context;
  validateProposal(proposal, policy);
  // Refuse before any attributed Git or hook operation if runtime qualification is absent.
  const platform = `linux/${process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : "unsupported"}`;
  loadRuntime(config ?? {}, platform);
  required(
    typeof token === "string" && token.length > 0,
    "readonly gate token is absent"
  );
  return withPrivateRoot(async root => {
    const env = {
      ...candidateEnvironment(root),
      GH_TOKEN: token,
      GIT_AUTHOR_NAME: BOT,
      GIT_AUTHOR_EMAIL: MAIL,
      GIT_COMMITTER_NAME: BOT,
      GIT_COMMITTER_EMAIL: MAIL,
      GIT_AUTHOR_DATE: `${preview.epoch} +0000`,
      GIT_COMMITTER_DATE: `${preview.epoch} +0000`,
    };
    const branch = await stageProposal(context, env);
    const message = await gateProof(context, root, env);
    const object = await committedProposal(context, env, message);
    return pushProposal(context, env, branch, object);
  });
}
