// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Early signed verification uses the original read-only broker, never application credentials. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { required } from "./npm-update-contract.mjs";
import { withStage } from "./npm-update-invariants.mjs";
import { writeJson } from "./npm-update-process.mjs";
import { controllerSubject } from "./npm-update-controller-factory.mjs";
import { startHookReadBroker } from "./npm-update-hook-provider.mjs";
import {
  PROPOSAL_PREDICATE,
  RECOVERY_PREDICATE,
} from "./github-attestation-verifier.mjs";

/** Proof paths remain the fixed slots installed for the unchanged canonical verifier. */
async function proofScope(context, env, step) {
  const result = await step(context, env, "/usr/bin/git", [
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

/** PATH preserves original commands; the fixed Node gateway carries no provider token. */
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

/** Scope construction uses the same original allocation and proof subject as ordinary hooks. */
function hookProfile(context, root, native, scope) {
  return {
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
}

/** Exit ten means no proof; only the real signed verifier's zero permits runtime side effects. */
export async function authenticateHostedRuntime(context, root, scope, step) {
  const result = await step(
    context,
    { ...scope.env, LISA_NPM_HOOK_ROLE: "commit" },
    "node",
    ["scripts/lisa-automation-provenance.mjs", join(root, "message")]
  );
  required(result.code === 0, "canonical runtime proof was not authenticated");
}

/** Retain qualified install paths while adding only the existing gateway and hosted identity. */
function hostedEnvironment(context, root, bin, installed) {
  required(
    installed.HOME === root && typeof installed.PATH === "string",
    "installed hosted environment differs"
  );
  return {
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
  };
}

/** Gateway publication failures positively close an already allocated original listener. */
export async function openHostedReadScope(
  context,
  root,
  env,
  native,
  graph,
  step
) {
  const scope = await withStage("gate-scope", () =>
    proofScope(context, env, step)
  );
  const profile = await withStage("gate-scope", () => {
    mkdirSync(join(root, "gh-config"), { mode: 0o700 });
    return hookProfile(context, root, native, scope);
  });
  const broker = await withStage("gate-broker", () =>
    startHookReadBroker(profile, context.token)
  );
  try {
    const bin = await withStage("gate-gateway", () =>
      nodeGateway(root, {
        version: 1,
        root,
        cwd: context.cwd,
        graph,
        native,
        reader: { root, path: broker.path, deadline: context.deadline },
      })
    );
    const environment = installed =>
      hostedEnvironment(context, root, bin, installed);
    return {
      env: environment(env),
      environment,
      close: broker.close,
    };
  } catch (error) {
    try {
      await withStage("gate-close", () => broker.close());
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "hosted gateway publication and scope cleanup failed",
        { cause: error }
      );
    }
    throw error;
  }
}
