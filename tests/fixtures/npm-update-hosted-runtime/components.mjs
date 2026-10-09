/** Fixed component exercise uses genuine tools/hooks while preserving provider-proof separation. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { required } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { readBytes } from "../../../all/copy-overwrite/scripts/lib/npm-update-process-core.mjs";
import { prepareRailsTools } from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs";
import { openRailsMysqlRuntime } from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-mysql.mjs";
import { runtimeBinding } from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-runtime-contract.mjs";
import { originalHookEnvironment } from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-gate.mjs";
import { prepareApplication } from "./application.mjs";
import { failureMetadata, hookWitness } from "./observations.mjs";
import { hookSocketWitness } from "./socket-witness.mjs";
import {
  browserDriverControl,
  browserDriverQualification,
} from "./driver-diagnostic.mjs";
import { sandboxStatus } from "./sandbox-status.mjs";
const QUIET = "--quiet";
const NO_TRUNC = "--no-trunc";
const GIT = "/usr/bin/git";
const PROFILE = Object.freeze({
  profile: "rails-mysql",
  database: "lisa_runtime",
  browser: true,
  dockerFixtures: true,
});
const APPLICATION_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "BUNDLE_PATH",
  "BUNDLE_APP_CONFIG",
  "BUNDLE_FROZEN",
  "BUNDLER_VERSION",
  "BUNDLE_SILENCE_ROOT_WARNING",
];
/**
 * Inventory success, never an exception, establishes foreign object preservation.
 * @param {function(string, string, object, string, Array<string>): Promise<object>} native Bounded original process recorder.
 * @param {string} stage Closed inventory stage.
 * @param {string} source Actual checked-out source cwd.
 * @param {object} docker Qualified client and daemon.
 * @returns {Promise<object | undefined>} Checked component observation or earlier refusal.
 */
async function census(native, stage, source, docker) {
  const result = {};
  for (const [kind, args] of [
    ["containers", ["container", "ls", "--all", QUIET, NO_TRUNC]],
    ["networks", ["network", "ls", QUIET, NO_TRUNC]],
    ["volumes", ["volume", "ls", QUIET]],
    ["images", ["image", "ls", "--all", QUIET, NO_TRUNC]],
  ]) {
    const rows = await native(stage, source, docker.env, docker.path, args);
    const values = rows.stdout.toString().trim().split("\n").filter(Boolean);
    required(
      values.length <= 10000 &&
        values.every(value => /^[a-zA-Z0-9_.:-]{1,256}$/.test(value)),
      "daemon inventory is malformed"
    );
    result[kind] = new Set(values);
  }
  return result;
}

/**
 * Both fixed browser requests retain vendor sandbox flags and original native supervision.
 * @param {object} request Closed source-owned profile, URL, environment and recorder.
 * @param {string} request.root Original private owned root.
 * @param {object} request.application Frozen fixture and closed environment.
 * @param {function(string, string, object, string, Array<string>): Promise<object>} request.native Original supervised recorder.
 * @param {string} request.stage Fixed browser observation stage.
 * @param {string} request.name Fixed exclusive profile directory name.
 * @param {string} request.url Fixed source-owned diagnostic or sandbox URL.
 * @returns {Promise<object>} Original bounded command result.
 */
async function captureBrowser({ root, application, native, stage, name, url }) {
  const profile = join(root, name);
  mkdirSync(profile, { mode: 0o700 });
  return native(
    stage,
    application.cwd,
    application.env,
    application.env.CHROME_BINARY,
    [
      "--headless=new",
      "--allow-chrome-scheme-url",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--dump-dom",
      "--timeout=5000",
      url,
    ]
  );
}

/**
 * A separate post-failure profile distinguishes blank-page startup from internal-page capture.
 * Its success is diagnostic only and never replaces the original sandbox refusal.
 * @param {string} root Original private owned root.
 * @param {object} application Original frozen fixture and closed environment.
 * @param {function(string, string, object, string, Array<string>): Promise<object>} native Original recorder with unchanged deadlines.
 * @returns {Promise<object>} Diagnostic DOM observation, without sandbox qualification.
 */
export async function browserControl(root, application, native) {
  const result = await captureBrowser({
    root,
    application,
    native,
    stage: "browser-control",
    name: "browser-control-profile",
    url: "about:blank",
  });
  const html = result.stdout.toString();
  required(
    html.includes("<html") && html.includes("</html>"),
    "native blank-page diagnostic DOM is unavailable"
  );
  return { diagnosticOnly: true, nativeDomVerified: true };
}

/**
 * Original internal-page qualification still requires the real SUID sandbox evidence.
 * @param {string} root Private owned root.
 * @param {object} application Frozen fixture and token-free environment.
 * @param {function(string, string, object, string, Array<string>): Promise<object>} native Original supervised recorder.
 * @returns {Promise<object>} Checked sandbox observation or earlier refusal.
 */
export async function browser(root, application, native) {
  const state = {};
  state.result = await captureBrowser({
    root,
    application,
    native,
    stage: "browser",
    name: "browser-profile",
    url: "chrome://sandbox",
  });
  state.html = state.result.stdout.toString();
  state.sandbox = sandboxStatus(state.html);
  required(
    state.sandbox.nativeSandboxVerified,
    "native browser sandbox is unavailable"
  );
  required(
    state.sandbox.suidSandboxActive,
    "native browser SUID sandbox is unavailable"
  );
  return {
    nativeSandboxVerified: true,
    suidSandboxActive: true,
    driverSessionVerified: false,
  };
}

/**
 * Real hooks use the same installed manager and native process path as production.
 * @param {object} application Prepared four-role fixture.
 * @param {function(string, string, object, string, Array<string>): Promise<object>} native Original supervised recorder.
 * @returns {Promise<object | undefined>} Checked component observation or earlier refusal.
 */
async function hooks(application, native) {
  writeFileSync(
    join(application.cwd, "native-hook-change.txt"),
    "genuine original hooks\n",
    { flag: "wx", mode: 0o600 }
  );
  await native("fixture-git", application.cwd, application.env, GIT, [
    "add",
    "native-hook-change.txt",
  ]);
  await native("original-commit", application.cwd, application.env, GIT, [
    "commit",
    QUIET,
    "-m",
    "test: exercise original runtime hooks",
  ]);
  hookWitness(
    JSON.parse(
      readBytes(join(application.cwd, "hook-observation.json")).toString()
    )
  );
  await native("original-push", application.cwd, application.env, GIT, [
    "push",
    QUIET,
    "origin",
    "HEAD:refs/heads/main",
  ]);
  return {
    originalCommitHookVerified: true,
    originalPrepushHookVerified: true,
    fourNativeRoleWitnesses: true,
  };
}

/**
 * Runtime closing retains a prior operation refusal and records separate cleanup refusal metadata.
 * @param {object | undefined} runtime Owned runtime or undefined before allocation.
 * @param {object} summary Closed component report.
 * @param {Error | undefined} primary Earlier operation refusal.
 * @returns {Promise<object | undefined>} Checked component observation or earlier refusal.
 */
async function closeRuntime(runtime, summary, primary) {
  const state = { primary };
  if (!runtime) return state.primary;
  try {
    await runtime.close();
  } catch (error) {
    summary.cleanupFailures.push(failureMetadata(error));
    state.primary ??= error;
  }
  summary.runtime = {
    prepared: runtime.receipt.prepared,
    closed: runtime.receipt.closed,
    foreignPreserved: runtime.receipt.foreignPreserved,
    imageId: runtime.receipt.imageId,
  };
  return state.primary;
}

/**
 * Frozen fixture installation precedes the same owned production runtime API and original hooks.
 * @param {string} source Original checkout containing the real supervisor.
 * @param {string} root Owned root.
 * @param {object} tools Qualified tools.
 * @param {function(string, string, object, string, Array<string>): Promise<object>} native Original recorder.
 * @param {object} summary Closed report.
 * @param {number} deadline Original absolute phase expiry.
 * @returns {Promise<object | undefined>} Checked component observation or earlier refusal.
 */
async function runtimeExercise(source, root, tools, native, summary, deadline) {
  const application = await prepareApplication(root, tools, native);
  summary.fixtureLockSha256 = application.lockSha256;
  const closed = Object.fromEntries(
    APPLICATION_KEYS.filter(
      name => typeof application.env[name] === "string"
    ).map(name => [name, application.env[name]])
  );
  const state = {};
  try {
    state.runtime = await openRailsMysqlRuntime(
      {
        cwd: application.cwd,
        root,
        deadline,
        profile: PROFILE,
        docker: tools.docker,
      },
      closed
    );
    await state.runtime.prepareSchemas();
    application.env = { ...application.env, ...state.runtime.env };
    summary.hooks = await hooks(application, native);
    summary.browser = await browserDriverQualification(
      root,
      application,
      native
    );
    const scratch = await native(
      "original-push",
      application.cwd,
      originalHookEnvironment(application.env, PROFILE),
      "/bin/sh",
      [
        join(source, "all/copy-overwrite/scripts/lisa-scratch-run.sh"),
        "--suite",
        "runtime-socket",
        "--",
        process.execPath,
        join(
          source,
          "tests/fixtures/npm-update-hosted-runtime/support/socket-hook.mjs"
        ),
      ]
    );
    const witness = JSON.parse(scratch.stdout.toString());
    summary.nestedHookScratch = hookSocketWitness(witness);
  } catch (error) {
    state.primary = error;
    if (summary.native.at(-1)?.stage === "browser-driver-qualification") {
      try {
        summary.browserControl = await browserControl(
          root,
          application,
          native
        );
      } catch (diagnosticError) {
        summary.browserControl = {
          diagnosticOnly: true,
          nativeDomVerified: false,
          failure: failureMetadata(diagnosticError),
        };
      }
      try {
        summary.browserDriver = await browserDriverControl(
          root,
          application,
          native
        );
      } catch (driverError) {
        summary.browserDriver = {
          diagnosticOnly: true,
          failure: failureMetadata(driverError),
        };
      }
    }
  } finally {
    state.primary = await closeRuntime(state.runtime, summary, state.primary);
  }
  if (state.primary) throw state.primary;
}

/**
 * No provider signature is minted by the component job; the production gate remains independently authenticated.
 * @param {string} source Explicit original checkout.
 * @param {string} root Owned private root.
 * @param {{[key: string]: string}} env Closed candidate environment.
 * @param {function(string, string, object, string, Array<string>): Promise<object>} native Original native recorder.
 * @param {object} summary Metadata-only report.
 * @param {number} deadline Original absolute expiry.
 * @returns {Promise<object | undefined>} Checked component observation or earlier refusal.
 */
export async function qualifyComponents(
  source,
  root,
  env,
  native,
  summary,
  deadline
) {
  const policy = { runtime: PROFILE };
  const tools = await prepareRailsTools(
    { cwd: source, deadline, policy, proposal: runtimeBinding(policy) },
    root,
    env,
    PROFILE
  );
  const before = await census(native, "daemon-before", source, tools.docker);
  const state = {};
  summary.tools = {
    dockerVersion: tools.docker.version,
    dockerSha256: tools.docker.sha256,
    clientVersion: tools.client.version,
    clientSha256: tools.client.sha256,
    clientHeaderSha256: tools.client.headerSha256,
    browserVersion: "154.0.8037.92",
    bundlerVersion: "2.4.10",
    rubyVersion: "3.4.11",
    nodeVersion: process.versions.node,
  };
  try {
    await runtimeExercise(source, root, tools, native, summary, deadline);
  } catch (error) {
    state.primary = error;
  } finally {
    try {
      const after = await census(native, "daemon-after", source, tools.docker);
      summary.foreignResourcesPreserved = Object.keys(before).every(kind =>
        [...before[kind]].every(id => after[kind].has(id))
      );
      required(
        summary.foreignResourcesPreserved,
        "foreign daemon resources changed"
      );
    } catch (error) {
      summary.cleanupFailures.push(failureMetadata(error));
      state.primary ??= error;
    }
  }
  if (state.primary) throw state.primary;
}
