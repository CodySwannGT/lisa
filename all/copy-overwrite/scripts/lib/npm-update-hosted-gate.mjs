// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Supported disposable Actions Linux gates use original native tools; publisher authority stays in another job. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { required, proposalFileNames } from "./npm-update-contract.mjs";
import { qualifiedBun, frozenBun } from "./npm-update-bun.mjs";
import { runProcess } from "./npm-update-process.mjs";
import { qualifiedControllerGraph } from "./npm-update-helper.mjs";
import { controllerTools } from "./npm-update-controller-factory.mjs";
import {
  openHostedReadScope,
  authenticateHostedRuntime,
} from "./npm-update-hosted-scope.mjs";
import { affirmRuntimeProfile } from "./npm-update-rails-runtime-contract.mjs";
import { prepareRailsTools } from "./npm-update-rails-tools.mjs";
import { openRailsMysqlRuntime } from "./npm-update-rails-mysql.mjs";
import { installOriginalManager } from "./npm-update-hook-installation.mjs";
import { withStage } from "./npm-update-invariants.mjs";

const INSTALL_STAGE = "gate-install";
const VALIDATE_STAGE = "gate-validate";

/** Only prepared browser hooks use a short supervisor base; candidate HOME and TMPDIR stay private. */
export function originalHookEnvironment(env, runtime) {
  return runtime?.browser ? { ...env, LISA_SCRATCH_BASE: "/tmp" } : env;
}

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
    ...(context.proposal.bunLockSha256 === undefined ? [] : ["bun.lock"]),
    ...(ruby ? ["Gemfile", "Gemfile.lock"] : []),
  ].map(name => [name, readFileSync(join(context.cwd, name))]);
  await nativeStep(context, installed, "npm", [
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  if (context.proposal.bunLockSha256 !== undefined) {
    const bun = await qualifiedBun(installed, { deadline: context.deadline });
    await frozenBun(bun, context.cwd, proposalFileNames(context.proposal), {
      timeout: remainingGateTime(context.deadline),
    });
  }
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

/** Authenticate before tools; keep frozen application setup separate from hook/tool authority. */
export async function prepareRailsApplication(
  context,
  root,
  env,
  scope,
  profile
) {
  await withStage(VALIDATE_STAGE, () =>
    authenticateHostedRuntime(context, root, scope, nativeStep)
  );
  const tools = await withStage("gate-tools", () =>
    prepareRailsTools(context, root, env, profile)
  );
  const installed = await withStage(INSTALL_STAGE, () =>
    installHostedDependencies(context, root, tools.env)
  );
  const application = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "LANG",
      "LC_ALL",
      "TZ",
      "TMPDIR",
      "BUNDLE_PATH",
      "BUNDLE_APP_CONFIG",
      "BUNDLE_FROZEN",
      "BUNDLE_SILENCE_ROOT_WARNING",
      "BUNDLER_VERSION",
    ]
      .filter(name => installed[name] !== undefined)
      .map(name => [name, installed[name]])
  );
  const runtime = await withStage(INSTALL_STAGE, () =>
    openRailsMysqlRuntime(
      {
        cwd: context.cwd,
        root,
        deadline: context.deadline,
        profile,
        docker: tools.docker,
      },
      application
    )
  );
  try {
    await withStage(INSTALL_STAGE, () => runtime.prepareSchemas());
    const databases = Object.fromEntries(
      [
        "DATABASE_NAME",
        "DATABASE_USER",
        "DATABASE_PASSWORD",
        "DATABASE_PORT",
        "PRIMARY_DB_HOST",
        "DATABASE_REPLICA_HOST",
        "DATABASE_SSL",
        "DATABASE_IAM_AUTH",
        "RAILS_ENV",
        "RACK_ENV",
      ].map(name => [name, runtime.env[name]])
    );
    required(
      Object.values(databases).every(value => typeof value === "string"),
      "prepared database environment differs"
    );
    return { env: { ...installed, ...databases }, close: runtime.close };
  } catch (error) {
    try {
      await runtime.close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "hosted schema preparation and cleanup failed",
        { cause: error }
      );
    }
    throw error;
  }
}

/** Attempt every owned close within its original deadline, preserving all actual failures. */
async function closeHostedResources(...resources) {
  const errors = [];
  for (const resource of resources) {
    if (!resource) continue;
    try {
      await resource.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length)
    throw new AggregateError(errors, "hosted resources cleanup failed");
}

/** A separate read-only capability is available during original gates; it cannot acquire publisher/issuer permissions. */
export async function createHostedGate(context, root, env) {
  await withStage(VALIDATE_STAGE, () => assertHostedGate(context));
  const runtime = await withStage(VALIDATE_STAGE, () =>
    affirmRuntimeProfile(
      context.proposal,
      context.policy,
      process.env.LISA_NPM_RUNTIME_PROFILE ?? "none"
    )
  );
  const native = await withStage("gate-tools", () =>
    controllerTools(context.config.automationProvenance)
  );
  const graph = await withStage("gate-graph", () =>
    qualifiedControllerGraph(context.cwd, context.config, [
      "lisa-work-item.mjs",
      "lisa-automation-provenance.mjs",
      "lisa-rails-prepush.mjs",
      "lib/npm-update-hosted-hook.mjs",
      "lib/npm-update-hook-preload.mjs",
    ])
  );
  let scope;
  let application;
  try {
    if (runtime) {
      scope = await openHostedReadScope(
        context,
        root,
        env,
        native,
        graph,
        nativeStep
      );
      application = await prepareRailsApplication(
        context,
        root,
        env,
        scope,
        runtime
      );
    }
    const installed =
      application?.env ??
      (await withStage(INSTALL_STAGE, () =>
        installHostedDependencies(context, root, env)
      ));
    const installation = await withStage("gate-hooks", () =>
      installOriginalManager(context, installed, nativeStep)
    );
    scope ??= await openHostedReadScope(
      context,
      root,
      installed,
      native,
      graph,
      nativeStep
    );
    return {
      installation,
      env: originalHookEnvironment(scope.environment(installed), runtime),
      close: () => closeHostedResources(application, scope),
    };
  } catch (error) {
    if (scope) {
      try {
        await withStage("gate-close", () =>
          closeHostedResources(application, scope)
        );
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          "hosted preparation and scope cleanup failed",
          { cause: error }
        );
      }
    }
    throw error;
  }
}
