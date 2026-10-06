// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Supported disposable Actions Linux gates use original native tools; publisher authority stays in another job. */
import {
  existsSync,
  lstatSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { required } from "./npm-update-contract.mjs";
import { runProcess, writeJson } from "./npm-update-process.mjs";
import { qualifiedControllerGraph } from "./npm-update-helper.mjs";
import {
  controllerTools,
  controllerSubject,
} from "./npm-update-controller-factory.mjs";
import { startHookReadBroker } from "./npm-update-hook-provider.mjs";
import { originalHookInstallation } from "./npm-update-hook-installation.mjs";
import {
  sha256,
  PROPOSAL_PREDICATE,
  RECOVERY_PREDICATE,
} from "./github-attestation-verifier.mjs";

/** This diagnoses the supported caller; attestation/provider validation independently establishes actual authority. */
export function assertHostedGate(
  context,
  env = process.env,
  platform = process.platform,
  arch = process.arch
) {
  required(
    platform === "linux" &&
      arch === "x64" &&
      env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_REPOSITORY === context.policy.repository &&
      env.GITHUB_SHA === context.proposal.parent &&
      env.GITHUB_REF === "refs/heads/main" &&
      context.config.automationProvenance.allowedTriggers.includes(
        env.GITHUB_EVENT_NAME
      ),
    "gate requires the opted-in genuine hosted Linux AMD64 caller"
  );
}

/** Every native step consumes the same original thirty-minute phase budget. */
export function remainingGateTime(deadline, now = Date.now()) {
  required(
    Number.isSafeInteger(deadline) &&
      deadline > now &&
      deadline <= now + 1_800_000,
    "original gate phase deadline is absent or expired"
  );
  return deadline - now;
}

function nativeStep(context, env, command, args, maximum = 3_145_728) {
  return runProcess(command, args, {
    cwd: context.cwd,
    env,
    timeout: remainingGateTime(context.deadline),
    maximum,
  });
}

/** Lifecycle execution is disabled; Bundler is an explicit original tool install in this credential-free job. */
async function installHostedDependencies(context, root, env) {
  const ruby = existsSync(join(context.cwd, "Gemfile"));
  const installed = { ...env };
  if (ruby) {
    required(
      existsSync(join(context.cwd, "Gemfile.lock")),
      "frozen Ruby lock is missing"
    );
    installed.BUNDLE_PATH = join(root, "ruby-dependencies");
    installed.BUNDLE_APP_CONFIG = join(root, "bundle");
    installed.BUNDLE_FROZEN = "true";
  }
  const before = [
    "package.json",
    "package-lock.json",
    ...(ruby ? ["Gemfile", "Gemfile.lock"] : []),
  ].map(name => [name, readFileSync(join(context.cwd, name))]);
  await nativeStep(context, installed, "npm", [
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  if (ruby)
    await nativeStep(context, installed, "bundle", [
      "install",
      "--jobs",
      "2",
      "--retry",
      "0",
    ]);
  required(
    before.every(([name, bytes]) =>
      readFileSync(join(context.cwd, name)).equals(bytes)
    ),
    "ordinary dependency install changed manifest/lock baseline"
  );
  return installed;
}

/** The original supported manager installs its own wrappers; no synthetic replacement hook is written. */
async function installOriginalManager(context, env) {
  const lefthook = existsSync(join(context.cwd, "lefthook.yml"));
  if (lefthook)
    await nativeStep(context, env, "bundle", ["exec", "lefthook", "install"]);
  else {
    const husky = join(context.cwd, "node_modules/husky/bin.js");
    required(
      existsSync(husky) && existsSync(join(context.cwd, ".husky/pre-push")),
      "original hook manager installation is unavailable"
    );
    await nativeStep(context, env, process.execPath, [husky]);
  }
  const git = args => nativeStep(context, env, "/usr/bin/git", args);
  const result = await git(["rev-parse", "--git-path", "hooks"]);
  const text = result.stdout.toString();
  required(
    text.endsWith("\n") && !/[\n\r\0]/.test(text.slice(0, -1)),
    "original hook path is unsupported"
  );
  const directory = resolve(context.cwd, text.slice(0, -1));
  const wrappers = {};
  for (const name of [
    "pre-commit",
    "prepare-commit-msg",
    "commit-msg",
    "pre-push",
  ]) {
    const path = join(directory, name);
    required(
      lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
      "original hook wrapper is missing or aliased"
    );
    wrappers[name] = sha256(readFileSync(path));
  }
  const installation = { manager: lefthook ? "lefthook" : "husky", wrappers };
  await originalHookInstallation(context.cwd, git, installation);
  return installation;
}

/** Proof paths are the actual fixed slots installed for the unchanged canonical verifier. */
async function proofScope(context, env) {
  const result = await nativeStep(context, env, "/usr/bin/git", [
    "rev-parse",
    "--git-common-dir",
  ]);
  const text = result.stdout.toString();
  required(
    text.endsWith("\n") && !/[\n\r\0]/.test(text.slice(0, -1)),
    "original Git control path is unsupported"
  );
  const control = resolve(
    context.cwd,
    text.slice(0, -1),
    "lisa/automation-provenance"
  );
  const policy = context.config.automationProvenance;
  const record = (file, bundle, predicate) => ({
    file: join(control, file),
    bundle: join(control, bundle),
    predicate,
    signerWorkflow: policy.signerWorkflow,
    signerDigest: policy.signerDigest,
  });
  const proofs = [record("descriptor.json", "bundle.json", PROPOSAL_PREDICATE)];
  if (context.recovery !== undefined)
    proofs.push(
      record("recovery.json", "recovery-bundle.json", RECOVERY_PREDICATE)
    );
  const recoveryDescriptor =
    context.recovery === undefined
      ? undefined
      : JSON.parse(context.recovery.toString());
  return { proofs, recoveryDescriptor };
}

/** PATH preserves original native commands; the sole Node gateway carries no provider token. */
function nodeGateway(root, context) {
  const bin = join(root, "hook-bin");
  mkdirSync(bin, { mode: 0o700 });
  const entry = fileURLToPath(
    new URL("./npm-update-hosted-hook.mjs", import.meta.url)
  );
  const quote = text => {
    required(!/[\0\n\r]/.test(text), "unsupported hosted gateway path");
    return `'${text.replaceAll("'", "'\\''")}'`;
  };
  const file = join(root, "hosted-hooks.json");
  writeJson(file, context);
  writeFileSync(
    join(bin, "node"),
    `#!/bin/sh\nexec ${quote(context.native.node.path)} ${quote(entry)} --context ${quote(file)} -- "$@"\n`,
    { flag: "wx", mode: 0o700 }
  );
  return bin;
}

/** A separate read-only capability is available during original gates; it cannot acquire publisher/issuer permissions. */
export async function createHostedGate(context, root, env) {
  assertHostedGate(context);
  const native = controllerTools(context.config.automationProvenance);
  const graph = await qualifiedControllerGraph(context.cwd, context.config, [
    "lisa-work-item.mjs",
    "lisa-automation-provenance.mjs",
    "lisa-rails-prepush.mjs",
    "lib/npm-update-hosted-hook.mjs",
    "lib/npm-update-hook-preload.mjs",
  ]);
  const installed = await installHostedDependencies(context, root, env);
  const installation = await installOriginalManager(context, installed);
  const scope = await proofScope(context, installed);
  mkdirSync(join(root, "gh-config"), { mode: 0o700 });
  const profile = {
    version: 1,
    deadline: context.deadline,
    cwd: context.cwd,
    home: root,
    nativeGh: native.gh,
    invocation: {
      entry: join(context.cwd, "scripts/lisa-npm-updater.mjs"),
      args: [join(context.cwd, "scripts/lisa-npm-updater.mjs"), "gate"],
      cwd: context.cwd,
    },
    subject: controllerSubject(
      { ...context, recoveryDescriptor: scope.recoveryDescriptor },
      "hook-read",
      null,
      scope.proofs
    ),
  };
  const broker = await startHookReadBroker(profile, context.token);
  try {
    const bin = nodeGateway(root, {
      version: 1,
      root,
      cwd: context.cwd,
      graph,
      native,
      reader: { root, path: broker.path, deadline: context.deadline },
    });
    return {
      installation,
      env: {
        ...installed,
        PATH: `${bin}:${installed.PATH}`,
        CI: "true",
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: context.policy.repository,
        GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
        GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT,
        GITHUB_SHA: context.proposal.parent,
        GITHUB_REF: "refs/heads/main",
        GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME,
      },
      close: broker.close,
    };
  } catch (error) {
    await broker.close();
    throw error;
  }
}
