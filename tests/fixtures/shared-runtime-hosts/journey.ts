/* eslint-disable code-organization/enforce-statement-order -- Git checkpoints and real CLI operations are chronological operator steps. */
/** Actual packed CLI adoption, install, native tests and offline synth assertions. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { expect } from "vitest";
import { resolveGit } from "../../support/git-executable.js";
import { type Candidate } from "./artifact.js";
import { apply, checkpoint } from "./actions.js";
import { seedHost, snapshot, write } from "./host.js";
import { nativeUnitDeadlineMs, run } from "./process.js";
import {
  assertGeneratedPolicy,
  installedVersions,
  synth,
} from "./assertions.js";

/**
 * Seed and checkpoint the disposable operator host.
 * @returns Clean seeded host path
 * @param candidate - Exact packed candidate and child environment
 * @param stack - Supported host stack
 */
async function prepareHost(
  candidate: Candidate,
  stack: "typescript" | "cdk"
): Promise<string> {
  const host = path.join(candidate.root, stack);
  seedHost(host, stack);
  const git = resolveGit();
  await run(
    git,
    ["init", "--initial-branch=main"],
    host,
    candidate.env,
    candidate.logs,
    `${stack}-init`
  );
  await run(
    git,
    ["config", "user.name", "Runtime verification"],
    host,
    candidate.env,
    candidate.logs,
    `${stack}-name`
  );
  await run(
    git,
    ["config", "user.email", "verification@example.invalid"],
    host,
    candidate.env,
    candidate.logs,
    `${stack}-email`
  );
  await checkpoint(candidate, host, `${stack}-seed`);
  return host;
}

/**
 * Materialize the generated baseline and perform its first adoption.
 * @param candidate - Exact packed candidate and child environment
 * @param host - Generated host directory
 * @param stack - Supported host stack
 */
async function adoptBaseline(
  candidate: Candidate,
  host: string,
  stack: string
): Promise<void> {
  await apply(candidate, host, stack, "bootstrap");
  const bootstrap = snapshot(host);
  await checkpoint(candidate, host, `${stack}-generated-baseline`);
  await apply(candidate, host, stack, "first-adoption");
  const adopted = snapshot(host);
  write(candidate.logs, `${stack}-bootstrap-transition.json`, {
    setupCalls: 1,
    changedFiles: [
      ...new Set([...Object.keys(bootstrap), ...Object.keys(adopted)]),
    ].filter(name => bootstrap[name] !== adopted[name]),
  });
  assertGeneratedPolicy(host);
}

/**
 * Build genuine Bun registry and cache arguments.
 * @param candidate - Exact packed candidate and child environment
 * @param registry - Exact-artifact loopback registry URL
 * @returns Arguments for actual Bun installation
 */
function installCommand(
  candidate: Candidate,
  registry: string
): readonly string[] {
  return [
    "install",
    "--registry",
    registry,
    "--network-concurrency",
    "8",
    "--cache-dir",
    candidate.env["BUN_INSTALL_CACHE_DIR"]!,
  ];
}

/**
 * Run actual typecheck and assert nonzero native unit execution.
 * @param candidate - Exact packed candidate and child environment
 * @param host - Generated host directory
 * @param stack - Supported host stack
 */
async function nativeChecks(
  candidate: Candidate,
  host: string,
  stack: string
): Promise<void> {
  // Each generated host owns a new native wrapper lease/profile. Do not pass
  // the outer Lisa runner's identity as an assertion about that host.
  const hostEnv = Object.fromEntries(
    Object.entries(candidate.env).filter(
      ([name]) =>
        ![
          "LISA_TEST_SCRATCH_SUITE",
          "LISA_TEST_SCRATCH_PREFIXES",
          "LISA_TEST_RUN_LEASE",
        ].includes(name)
    )
  );
  await run(
    "bun",
    ["run", "typecheck"],
    host,
    hostEnv,
    candidate.logs,
    `${stack}-typecheck`,
    60_000
  );
  await run(
    "bun",
    ["run", "build"],
    host,
    hostEnv,
    candidate.logs,
    `${stack}-build`,
    60_000
  );
  await run(
    "bun",
    ["run", "test:unit"],
    host,
    hostEnv,
    candidate.logs,
    `${stack}-unit`,
    60_000,
    nativeUnitDeadlineMs(hostEnv)
  );
  expect(
    fs
      .readFileSync(path.join(candidate.logs, `${stack}-unit.log`), "utf8")
      .replace(/\u001b\[[0-9;]*m/g, ""),
    "nonzero actual host unit execution"
  ).toMatch(new RegExp(`Tests\\s+${stack === "cdk" ? 2 : 1} passed`));
}

/**
 * Install and execute the real native host; then prove the second adoption.
 * @param candidate - Exact packed candidate and child environment
 * @param host - Generated host directory
 * @param stack - Supported host stack
 * @param registry - Exact-artifact loopback registry URL
 */
async function executeHost(
  candidate: Candidate,
  host: string,
  stack: string,
  registry: string
): Promise<void> {
  const install = installCommand(candidate, registry);
  await run(
    "bun",
    install,
    host,
    candidate.env,
    candidate.logs,
    `${stack}-install`,
    180_000
  );
  const versions = installedVersions(candidate, host);
  await nativeChecks(candidate, host, stack);
  const template =
    stack === "cdk"
      ? await synth(candidate, host, "cdk-first-synth")
      : undefined;
  await checkpoint(candidate, host, `${stack}-first-adoption-installed`);
  const first = snapshot(host);
  expect(Object.keys(first).length).toBeGreaterThan(50);
  await apply(candidate, host, stack, "second-adoption");
  expect(
    snapshot(host),
    "second adoption has zero full managed-byte delta"
  ).toEqual(first);
  await run(
    "bun",
    [...install, "--frozen-lockfile"],
    host,
    candidate.env,
    candidate.logs,
    `${stack}-frozen`,
    180_000
  );
  expect(
    snapshot(host),
    "frozen install has zero full managed-byte delta"
  ).toEqual(first);
  expect(installedVersions(candidate, host)).toEqual(versions);
  if (template !== undefined)
    expect(await synth(candidate, host, "cdk-second-synth")).toEqual(template);
  write(candidate.logs, `${stack}-proof.json`, {
    stack,
    sourceHead: candidate.sourceHead,
    indexTree: candidate.indexTree,
    tarballSha256: candidate.tarballSha256,
    packedRegularMemberCount: candidate.memberCount,
    setupCalls: 1,
    adoptionCalls: 2,
    versions,
    managedFileCount: Object.keys(first).length,
    secondAdoptionDelta: [],
    frozenInstallDelta: [],
    allPackedMemberBytesMatch: true,
    observedNodeVersion: process.versions.node,
    observedNodeAbi: process.versions.modules,
    nativeUnitCount: stack === "cdk" ? 2 : 1,
    synthTemplateSha256:
      template === undefined
        ? null
        : createHash("sha256").update(template).digest("hex"),
  });
}

/**
 * Execute the complete bootstrap plus two-adoption host journey.
 * @param candidate - Exact packed candidate and child environment
 * @param registry - Exact-artifact loopback registry URL
 * @param stack - Supported host stack
 */
export async function verifyHost(
  candidate: Candidate,
  registry: string,
  stack: "typescript" | "cdk"
): Promise<void> {
  const started = performance.now();
  const host = await prepareHost(candidate, stack);
  await adoptBaseline(candidate, host, stack);
  await executeHost(candidate, host, stack, registry);
  const proofPath = path.join(candidate.logs, `${stack}-proof.json`);
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  write(candidate.logs, `${stack}-proof.json`, {
    ...proof,
    caseWallMs: Math.round(performance.now() - started),
  });
}

/* eslint-enable code-organization/enforce-statement-order -- End the chronological fixture harness. */
