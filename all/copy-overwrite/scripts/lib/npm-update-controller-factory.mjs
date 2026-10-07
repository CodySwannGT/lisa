// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Parent-authenticated canonical helpers receive immutable phase scopes; their token stays in broker memory. */
import { mkdirSync, realpathSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required, OBJECT } from "./npm-update-contract.mjs";
import { leafRoles } from "./npm-update-leaf-contract.mjs";
import { qualifiedControllerGraph } from "./npm-update-helper.mjs";
import { withPrivateRoot, writeJson } from "./npm-update-process.mjs";
import { assertPinnedVerifier } from "./github-attestation-verifier.mjs";
import { binaryDigest } from "./npm-update-isolation.mjs";
import { createGhRequests } from "./npm-update-gh-requests.mjs";
import { startControllerBroker } from "./npm-update-controller-broker.mjs";
import { invokeControllerRecipe } from "./npm-update-broker-client.mjs";
import { boundedSpawnSync } from "./bounded-spawn.mjs";

/** One original phase expiry caps every helper; a later invocation cannot renew its budget. */
export function controllerDeadline(context, now = Date.now()) {
  required(
    Number.isSafeInteger(context.deadline) &&
      context.deadline > now &&
      context.deadline <= now + 1_800_000,
    "original controller phase deadline is absent or expired"
  );
  return Math.min(context.deadline, now + 120_000);
}

/** Existing canonical validators still authorize the allocation; this projection narrows helper authority. */
export function controllerSubject(context, phase, pr, proofs = []) {
  const { config, policy, proposal, allocation } = context;
  const descriptor = context.descriptor ?? context.preview?.descriptor;
  leafRoles(config, policy.repository);
  required(
    proposal.repository === policy.repository &&
      Number.isSafeInteger(allocation.number) &&
      allocation.number > 0 &&
      allocation.workItem === `${policy.repository}#${allocation.number}` &&
      descriptor?.parent === proposal.parent &&
      descriptor.workItem === allocation.workItem &&
      descriptor.claimCommentId === allocation.claimCommentId,
    "controller allocation or descriptor differs"
  );
  required(
    pr === null ||
      (Number.isSafeInteger(pr?.number) &&
        pr.number > 0 &&
        pr.html_url ===
          `https://github.com/${policy.repository}/pull/${pr.number}`),
    "controller actual PR differs"
  );
  const recovery = context.recoveryDescriptor;
  const subject = {
    phase,
    repository: policy.repository,
    tracker: policy.repository,
    issue: String(allocation.number),
    branch: `lisa/npm-${proposal.key}`,
    parent: proposal.parent,
    origin: { runId: descriptor.runId, runAttempt: descriptor.runAttempt },
    claim: allocation.claimCommentId,
    recovery: recovery
      ? {
          runId: recovery.runId,
          runAttempt: recovery.runAttempt,
          branch: `lisa/npm-${proposal.key}`,
        }
      : null,
    maintainer: policy.maintainer,
    pr: pr === null ? null : { number: String(pr.number), url: pr.html_url },
    proofs,
  };
  createGhRequests(subject);
  return subject;
}

/** Only exact current stage/writer tuples are constructed; arbitrary helper operations cannot enter this factory. */
export function canonicalHelperArguments(context, phase, operation, pr) {
  controllerSubject(context, phase, pr);
  if (phase === "stage-read") {
    required(pr === null, "stage phase cannot carry publication authority");
    if (operation === "link") return ["link", context.allocation.workItem];
    if (operation === "attach-branch") return ["attach-branch"];
  }
  if (phase === "publication-backlink" && operation === "backlink" && pr)
    return [
      "backlink",
      "--ref",
      context.allocation.workItem,
      "--pr-url",
      pr.html_url,
    ];
  if (
    phase === "publication-validate-pr" &&
    operation === "validate-pr" &&
    pr
  ) {
    required(
      OBJECT.test(context.commit?.sha ?? ""),
      "controller publication head is missing"
    );
    return [
      "validate-pr",
      "--base",
      context.proposal.parent,
      "--head",
      context.commit.sha,
      "--pr-number",
      String(pr.number),
      "--repo",
      context.policy.repository,
      "--pr-url",
      pr.html_url,
    ];
  }
  throw Error("unsupported canonical helper phase/operation");
}

/** Trusted released factory resolves actual tools outside candidate influence and rechecks them before dispatch. */
export function controllerTools(automation) {
  assertPinnedVerifier(automation);
  required(
    process.version === "v22.23.3",
    "unsupported native controller Node bootstrap"
  );
  const path = realpathSync(process.execPath);
  const git = realpathSync(
    [
      "/Library/Developer/CommandLineTools/usr/bin/git",
      "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
      "/usr/bin/git",
    ].find(existsSync)
  );
  const result = boundedSpawnSync(git, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 4096,
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent" },
  });
  required(
    !result.error &&
      !result.signal &&
      result.status === 0 &&
      /^git version [\w. -]+\n$/.test(result.stdout),
    "native controller Git identity is unavailable"
  );
  return {
    node: { path, version: "22.23.3", sha256: binaryDigest(path) },
    git: {
      path: git,
      version: result.stdout.trim(),
      sha256: binaryDigest(git),
    },
    gh: { path: automation.ghExecutable, sha256: automation.ghSha256 },
  };
}

/** Construct private JSON separately from the memory-only credentialed recipe. */
function canonicalRecipe(context, authority) {
  const {
    root,
    cwd,
    graph,
    native,
    entry,
    argv,
    phase,
    operation,
    pr,
    deadline,
  } = authority;
  mkdirSync(join(root, "gh-config"), { mode: 0o700 });
  const launcher = {
    version: 3,
    root,
    cwd,
    graph,
    routes: [],
    controller: { node: native.node, git: native.git },
    runtime: { tools: { node: native.node } },
    boundary: null,
    provider: {
      version: 1,
      deadline,
      cwd,
      home: root,
      nativeGh: native.gh,
      invocation: { entry, args: argv, cwd },
      subject: controllerSubject(context, phase, pr),
    },
  };
  writeJson(join(root, "launcher.json"), launcher);
  return {
    id: operation,
    command: native.node.path,
    args: argv,
    cwd,
    input: Buffer.alloc(0),
    allowed: [0],
    timeout: 120_000,
    maximum: 3_145_728,
    context: launcher,
    env: {
      PATH: `${dirname(native.node.path)}:${dirname(native.gh.path)}:/usr/bin:/bin`,
      HOME: root,
      LANG: "C.UTF-8",
      GH_TOKEN: context.token,
      GH_HOST: "github.com",
      GITHUB_REPOSITORY: context.policy.repository,
      GIT_TERMINAL_PROMPT: "0",
    },
  };
}

/** Every invocation has fresh private scope/credential-free JSON; no mutable privilege growth across phases. */
export async function executeCanonicalHelper(
  context,
  phase,
  operation,
  pr = null,
  suppliedArgs
) {
  controllerDeadline(context);
  const args = canonicalHelperArguments(context, phase, operation, pr);
  required(
    suppliedArgs === undefined ||
      canonicalJson(args) === canonicalJson(suppliedArgs),
    "canonical helper invocation differs from controller recipe"
  );
  const cwd = realpathSync(context.cwd);
  const graph = await qualifiedControllerGraph(cwd, context.config, [
    "lisa-work-item.mjs",
    "lib/npm-update-execution-adapter.mjs",
  ]);
  const entry = join(cwd, "scripts/lisa-work-item.mjs");
  required(
    Object.hasOwn(graph, entry),
    "authenticated canonical helper entry is absent"
  );
  const native = controllerTools(context.config.automationProvenance);
  const argv = [entry, ...args];
  return withPrivateRoot(async root => {
    const deadline = controllerDeadline(context);
    const recipe = canonicalRecipe(context, {
      root,
      cwd,
      graph,
      native,
      entry,
      argv,
      phase,
      operation,
      pr,
      deadline,
    });
    const broker = await startControllerBroker({
      root,
      node: native.node,
      graph,
      deadline,
      recipes: [recipe],
    });
    try {
      const result = await invokeControllerRecipe(
        { root, path: broker.path, deadline },
        operation
      );
      required(
        result.code === 0,
        `canonical ${operation} helper refused with native exit ${result.code}`
      );
      return result;
    } finally {
      await broker.close();
    }
  });
}
