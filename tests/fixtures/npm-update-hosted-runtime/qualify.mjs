/** Ubuntu component qualification is deliberately separate from signed provider/Bot acceptance. */
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { required } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import {
  withPrivateRoot,
  readBytes,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process-core.mjs";
import {
  digest,
  failureMetadata,
  nativeRecorder,
  privateResult,
} from "./observations.mjs";

import { qualifyComponents } from "./components.mjs";

const GIT = "/usr/bin/git";
const SOURCES = [
  "all/copy-overwrite/scripts/lisa-scratch-run.sh",
  "all/copy-overwrite/scripts/lib/npm-update-hosted-gate.mjs",
  "tests/fixtures/npm-update-hosted-runtime/support/socket-hook.mjs",
  "tests/fixtures/npm-update-hosted-runtime/socket-witness.mjs",
  "tests/fixtures/npm-update-hosted-runtime/components.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-rails-tool-identity.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-rails-tool-downloads.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-rails-mysql.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-rails-mysql-resource.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-rails-mysql-storage.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-rails-mysql-daemon.mjs",
  "tests/fixtures/npm-update-hosted-runtime/application.mjs",
  "tests/fixtures/npm-update-hosted-runtime/observations.mjs",
  "tests/fixtures/npm-update-hosted-runtime/driver-probe.mjs",
  "tests/fixtures/npm-update-hosted-runtime/driver-diagnostic.mjs",
  "tests/fixtures/npm-update-hosted-runtime/browser-process-observation.mjs",
  "tests/fixtures/npm-update-hosted-runtime/qualify.mjs",
  "tests/fixtures/npm-update-hosted-runtime/verify-hook.rb",
];

/** Explicit source/result argv prevent hidden worktree selection and alias output publication. */
async function main() {
  const { values } = parseArgs({
    options: { source: { type: "string" }, result: { type: "string" } },
    allowPositionals: false,
  });
  if (
    !(
      values.source &&
      values.result &&
      realpathSync(values.source) === values.source &&
      process.cwd() === values.source
    )
  )
    required(false, "qualification source identity differs");
  const output = privateResult(values.result);
  const captures = join(dirname(values.result), "captures");
  const summary = {
    format: 1,
    providerAuthorityVerified: false,
    productionHostedGateVerified: false,
    actualUbuntuAmd64: false,
    nativeSuccess: false,
    ownedRootAbsent: false,
    foreignResourcesPreserved: false,
    cleanupFailures: [],
    native: [],
  };
  const deadline = Date.now() + 1800000;
  const state = {};
  try {
    mkdirSync(captures, { mode: 0o700 });
    required(
      process.platform === "linux" &&
        process.arch === "x64" &&
        process.getuid() !== 0 &&
        process.versions.node === "22.23.3",
      "qualification native process identity differs"
    );
    const os = readFileSync("/etc/os-release", "utf8");
    required(
      /^ID=ubuntu$/m.test(os) && /^VERSION_ID="24\.04"$/m.test(os),
      "qualification requires Ubuntu 24.04"
    );
    summary.actualUbuntuAmd64 = true;
    const native = nativeRecorder(captures, deadline, summary.native);
    await withPrivateRoot(async (owned, env) => {
      state.root = owned;
      try {
        const head = await native("source", values.source, env, GIT, [
          "rev-parse",
          "HEAD",
        ]);
        summary.sourceHead = head.stdout.toString().trim();
        required(
          /^[a-f0-9]{40}$/.test(summary.sourceHead),
          "qualification source head malformed"
        );
        await native("source", values.source, env, GIT, [
          "diff",
          "--exit-code",
          "HEAD",
          "--",
        ]);
        await native("source", values.source, env, GIT, [
          "ls-files",
          "--error-unmatch",
          "--",
          ...SOURCES,
        ]);
        summary.sourceSha256 = Object.fromEntries(
          SOURCES.map(path => [
            path,
            digest(readBytes(join(values.source, path), 4194304, false)),
          ])
        );
        await qualifyComponents(
          values.source,
          state.root,
          env,
          native,
          summary,
          deadline
        );
      } catch (error) {
        state.failure = error;
      }
    });
    summary.ownedRootAbsent = !existsSync(state.root);
    required(summary.ownedRootAbsent, "qualification owned root remains");
  } catch (error) {
    if (state.failure) summary.cleanupFailures.push(failureMetadata(error));
    else state.failure = error;
  } finally {
    summary.failure = failureMetadata(state.failure);
    summary.nativeSuccess =
      !state.failure &&
      summary.ownedRootAbsent &&
      summary.foreignResourcesPreserved &&
      summary.cleanupFailures.length === 0;
    try {
      output.write(summary);
    } finally {
      output.close();
    }
  }
  if (!summary.nativeSuccess) {
    process.stderr.write(
      "Rails component qualification failed; inspect sanitized summary.\n"
    );
    process.exitCode = 1;
  }
}

await main();
