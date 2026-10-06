// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Released lifecycle and current native registration qualify a local Lisa owner. */
import { join } from "node:path";
import { existsSync, lstatSync } from "node:fs";
import { runNpm, effectiveEngineStrict } from "./npm-update-npm.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { qualifiedHelperFiles, helperOwner } from "./npm-update-helper.mjs";
import { SECTIONS, required, UpdaterError } from "./npm-update-contract.mjs";
import {
  runProcess,
  withPrivateRoot,
  readBytes,
} from "./npm-update-process-core.mjs";

/** A genuine second clone keeps released lifecycle effects out of the source checkout. */
const PLUGIN_HOOKS = "plugins/lisa/.codex-plugin/hooks.json";

/** Native registration is data; no candidate session hook is executed. */
export function nativeHooksEnabled(native) {
  // This bounded native registration shape refuses multiline TOML strings.
  if (native.includes('"""') || native.includes("'''")) return false;
  const lines = native.split("\n").map(line => line.split("#", 1)[0].trim());
  const begin = lines.indexOf("[features]");
  if (begin < 0 || begin !== lines.lastIndexOf("[features]")) return false;
  const tail = lines.slice(begin + 1);
  const end = tail.findIndex(line => line.startsWith("["));
  const hooks = tail
    .slice(0, end < 0 ? tail.length : end)
    .filter(line => /^hooks\b/.test(line));
  return hooks.length === 1 && /^hooks[ \t]*=[ \t]*true$/.test(hooks[0]);
}

async function ownerCheckout(cwd, app, policy, env) {
  const child = (command, args, options = {}) =>
    command === "npm"
      ? runNpm(args, { cwd: app, env, timeout: 1_800_000, ...options })
      : runProcess(command, args, {
          cwd: app,
          env,
          timeout: 1_800_000,
          ...options,
        });
  await runProcess("git", ["clone", "--no-local", cwd, app], {
    env,
    timeout: 120_000,
  });
  await child("git", [
    "checkout",
    "--detach",
    (await runProcess("git", ["rev-parse", "HEAD"], { cwd, env })).stdout
      .toString()
      .trim(),
  ]);
  await child("git", [
    "remote",
    "set-url",
    "origin",
    `https://github.com/${policy.repository}.git`,
  ]);
  return child;
}

/** Released Codex registration is checked as data; no session hook is invoked. */
async function localSessionOwner(app, installed, config) {
  const read = file => JSON.parse(readBytes(file, 1_048_576, false));
  const adopted = read(join(app, ".lisa.config.json"));
  required(
    ["codex", "fleet"].includes(adopted.harness) &&
      config.harness === adopted.harness &&
      adopted.autoUpdate !== false,
    "local Lisa session owner requires a qualified configured runtime"
  );
  const marketplace = read(join(app, ".agents/plugins/marketplace.json"));
  const entries = marketplace.plugins?.filter(plugin => plugin.name === "lisa");
  required(
    entries?.length === 1 &&
      entries[0].source?.source === "local" &&
      entries[0].source?.path ===
        "./node_modules/@codyswann/lisa/plugins/lisa" &&
      entries[0].policy?.installation === "INSTALLED_BY_DEFAULT",
    "current installed Lisa plugin registration differs"
  );
  const manifest = read(
    join(installed, "plugins/lisa/.codex-plugin/plugin.json")
  );
  required(
    manifest.hooks === "./.codex-plugin/hooks.json",
    "released plugin hook surface differs"
  );
  const catalog = join(installed, PLUGIN_HOOKS);
  const helper = await qualifiedHelperFiles(config, [
    PLUGIN_HOOKS,
    "plugins/lisa/hooks/auto-update.sh",
  ]);
  required(
    readBytes(catalog, 1_048_576, false).equals(helper.bytes.get(PLUGIN_HOOKS)),
    "released session catalog differs from immutable helper"
  );
  const hooks = read(catalog).hooks?.SessionStart;
  required(
    Array.isArray(hooks) &&
      hooks.some(
        group =>
          group.matcher === "startup" &&
          group.hooks?.some(
            hook =>
              hook.type === "command" &&
              hook.command === "${PLUGIN_ROOT}/hooks/auto-update.sh"
          )
      ),
    "actual released auto-update SessionStart is absent"
  );
  const script = "plugins/lisa/hooks/auto-update.sh";
  required(
    readBytes(join(installed, script), 1_048_576, false).equals(
      helper.bytes.get(script)
    ),
    "released local owner hook differs"
  );
  const native = readBytes(
    join(app, ".codex/config.toml"),
    65_536,
    false
  ).toString("utf8");
  required(nativeHooksEnabled(native), "current native hooks are not enabled");
  return "codex-plugin-session-start";
}

/** Genuine apply diagnostics require committed reconciliation rather than receipt filtering. */
export function validateOwnerReceipt(receipt, version, status, harness) {
  required(
    receipt.schema_version === 1,
    "genuine full-apply receipt schema differs"
  );
  required(
    receipt.apply_mode === "full",
    "genuine full-apply receipt mode differs"
  );
  required(
    receipt.lisa_version === version,
    "genuine full-apply receipt version differs"
  );
  required(
    ["codex", "fleet"].includes(harness) && receipt.harness === harness,
    "genuine full-apply receipt harness differs from configured Codex channel"
  );
  if (
    !Array.isArray(receipt.stale_paths) ||
    receipt.stale_paths.length ||
    status
  ) {
    const error = new UpdaterError(
      !Array.isArray(receipt.stale_paths) || receipt.stale_paths.length
        ? "genuine full-apply receipt has stale paths"
        : "full apply requires committed host reconciliation first"
    );
    error.qualification = {
      applyExit: 0,
      schema: receipt.schema_version,
      mode: receipt.apply_mode,
      version: receipt.lisa_version,
      stalePaths: receipt.stale_paths,
      ...(status ? { status } : {}),
    };
    throw error;
  }
  return receipt;
}

/** A fresh host proves the released local owner; an ignored foreign receipt never grants authority. */
export async function qualifyLisaOwner(
  cwd,
  before,
  policy,
  config,
  suppliedEngineStrict
) {
  const engineStrict =
    suppliedEngineStrict ?? (await effectiveEngineStrict(cwd));
  const declares = SECTIONS.some(
    section => before[section]?.["@codyswann/lisa"]
  );
  if (!declares) {
    required(policy.lisaOwner === "absent", "Lisa owner contradicts manifest");
    return { status: "absent" };
  }
  required(
    policy.lisaOwner === "verified-local-full-apply" &&
      config.autoUpdate !== false &&
      ["codex", "fleet"].includes(config.harness),
    "adopt the enabled local Lisa owner before generic updates"
  );
  return withPrivateRoot(async (root, env) => {
    const app = join(root, "qualification");
    const child = await ownerCheckout(cwd, app, policy, env);
    await child("npm", [
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...(engineStrict ? ["--engine-strict"] : []),
    ]);
    const installed = join(app, "node_modules/@codyswann/lisa");
    const metadata = JSON.parse(
      readBytes(join(installed, "package.json"), 1_048_576, false)
    );
    await releasedLisaIdentity(child, installed, metadata, config);
    await child(
      process.execPath,
      [join(installed, "dist/index.js"), "apply", ".", "--yes", "--full-apply"],
      { env: { ...env, CI: "true", LISA_BOOTSTRAP: "1" } }
    );
    const receipt = JSON.parse(
      readBytes(join(app, ".lisa/apply-receipt.json"), 1_048_576, false)
    );
    validateOwnerReceipt(receipt, metadata.version, "", config.harness);
    const status = (
      await child("git", ["status", "--porcelain", "--untracked-files=all"])
    ).stdout
      .toString()
      .trim();
    validateOwnerReceipt(receipt, metadata.version, status, config.harness);
    return {
      status: "qualified-local-owner",
      version: metadata.version,
      gitHead: config.automationProvenance.signerDigest,
      applyMode: receipt.apply_mode,
      baselineUnchanged: true,
      sessionHook: await localSessionOwner(app, installed, config),
    };
  });
}

/** Verify public release and the actual installed session hook before executing package code. */
export async function releasedLisaIdentity(child, installed, metadata, config) {
  required(
    metadata.name === "@codyswann/lisa" &&
      metadata.bin?.lisa === "dist/index.js",
    "released Lisa executable identity differs"
  );
  const result = await child("npm", [
    "view",
    `@codyswann/lisa@${metadata.version}`,
    "--json",
  ]);
  const registry = JSON.parse(result.stdout.toString());
  required(
    registry.name === metadata.name &&
      registry.version === metadata.version &&
      registry.gitHead === config.automationProvenance?.signerDigest &&
      typeof registry.dist?.integrity === "string",
    "approved released helper identity is unavailable"
  );
  const lock = JSON.parse(
    readBytes(join(installed, "../../../package-lock.json"), 1_048_576, false)
  );
  required(
    lock.packages["node_modules/@codyswann/lisa"]?.integrity ===
      registry.dist.integrity,
    "installed Lisa registry integrity differs"
  );
  const hook = join(installed, "plugins/lisa/hooks/auto-update.mjs");
  const hold = join(
    installed,
    "plugins/lisa/scripts/intake-blocker-reprobe.mjs"
  );
  required(
    [hook, hold].every(
      file => existsSync(file) && !lstatSync(file).isSymbolicLink()
    ),
    "released local updater or hold classifier is missing"
  );
  const sourcePackage = helperOwner().metadata;
  required(
    sourcePackage.version === metadata.version,
    "installed Lisa differs from approved helper version"
  );
  const members = [
    "plugins/lisa/hooks/auto-update.mjs",
    "plugins/lisa/scripts/intake-blocker-reprobe.mjs",
    "plugins/lisa/scripts/intake-prework-denominator.mjs",
  ];
  const trusted = await qualifiedHelperFiles(config, members);
  for (const relative of members)
    required(
      sha256(readBytes(join(installed, relative), 1_048_576, false)) ===
        sha256(trusted.bytes.get(relative)),
      "packaged helper import differs from immutable source"
    );
}
