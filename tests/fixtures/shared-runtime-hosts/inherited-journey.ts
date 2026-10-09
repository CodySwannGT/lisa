/* eslint-disable code-organization/enforce-statement-order -- Native CLI operations and proof captures are chronological. */
/** Genuine five additional framework journeys through one immutable packed CLI. */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "vitest";
import { resolveGit } from "../../support/git-executable.js";
import { qualifiedHostBun } from "../../support/qualified-host-bun.js";
import { type Candidate } from "./artifact.js";
import { apply, checkpoint } from "./actions.js";
import { snapshot, write } from "./host.js";
import {
  assertInheritedPolicy,
  assertInheritedUnitExecution,
  inheritedOutputs,
} from "./inherited-assertions.js";
import {
  INHERITED_NATIVE_SPEC,
  seedInheritedHost,
  type InheritedStack,
} from "./inherited-seeds.js";
import { nativeUnitDeadlineMs, run } from "./process.js";

/**
 * Initialize genuine detector source and inspect the installed detector itself.
 * @param candidate - Exact immutable tool and explicit native environment
 * @param stack - Additional supported route
 * @returns Initialized source-only host and actual native detector observation
 */
async function prepareInheritedHost(
  candidate: Candidate,
  stack: InheritedStack
) {
  const host = path.join(candidate.root, stack);
  const git = resolveGit();
  seedInheritedHost(host, stack);
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
  const detector = path.join(
    path.dirname(candidate.entry),
    "detection/index.js"
  );
  const script =
    'import {pathToFileURL} from "node:url"; const {DetectorRegistry}=await import(pathToFileURL(process.argv[1]).href); const registry=new DetectorRegistry(); const direct=await registry.detectAll(process.argv[2]); console.log(JSON.stringify({node:process.versions.node,abi:process.versions.modules,direct,expanded:registry.expandAndOrderTypes(direct)}));';
  await run(
    process.execPath,
    ["--input-type=module", "-e", script, detector, host],
    host,
    candidate.env,
    candidate.logs,
    `${stack}-detector`
  );
  const record = fs
    .readFileSync(path.join(candidate.logs, `${stack}-detector.log`), "utf8")
    .split("\n")
    .find(line => line.startsWith('{"node":'));
  expect(record).toBeDefined();
  const observation = JSON.parse(record!);
  expect(observation).toMatchObject({
    node: "24.21.0",
    abi: "137",
    expanded: ["typescript", stack],
  });
  await apply(candidate, host, stack, "bootstrap");
  await checkpoint(candidate, host, `${stack}-generated-baseline`);
  await apply(candidate, host, stack, "first-adoption");
  assertInheritedPolicy(host, stack);
  return { host, observation };
}

/**
 * Remove enclosing test leases before starting an independent host runner.
 * @param candidate - Parent-owned immutable execution environment
 * @returns Native environment retaining the measured fleet admission policy
 */
function inheritedNativeEnvironment(candidate: Candidate): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(candidate.env).filter(
      ([name]) =>
        ![
          "LISA_TEST_SCRATCH_SUITE",
          "LISA_TEST_SCRATCH_PREFIXES",
          "LISA_TEST_RUN_LEASE",
        ].includes(name)
    )
  );
}

/**
 * Install genuine tools and run actual native typecheck/build/nonzero unit work.
 * @param candidate - Immutable archive with qualified native Bun environment
 * @param host - Generated supported framework host
 * @param stack - Additional supported route
 * @param registry - Exact candidate loopback npm URL
 * @returns Observed installed versions and real output hashes
 */
async function runInheritedNative(
  candidate: Candidate,
  host: string,
  stack: InheritedStack,
  registry: string
) {
  const install = [
    "install",
    "--registry",
    registry,
    "--network-concurrency",
    "8",
    "--cache-dir",
    candidate.env["BUN_INSTALL_CACHE_DIR"]!,
  ];
  const nativeEnv = inheritedNativeEnvironment(candidate);
  const spec = INHERITED_NATIVE_SPEC[stack];
  await run(
    "bun",
    install,
    host,
    candidate.env,
    candidate.logs,
    `${stack}-install`,
    180_000
  );
  await run(
    "bun",
    ["run", "typecheck"],
    host,
    nativeEnv,
    candidate.logs,
    `${stack}-typecheck`,
    60_000
  );
  await run(
    "bun",
    ["run", "build"],
    host,
    nativeEnv,
    candidate.logs,
    `${stack}-build`,
    60_000
  );
  if (spec.buildScript !== "build")
    await run(
      "bun",
      ["run", spec.buildScript],
      host,
      nativeEnv,
      candidate.logs,
      `${stack}-framework-build`,
      60_000
    );
  await run(
    "bun",
    ["run", "test:unit"],
    host,
    nativeEnv,
    candidate.logs,
    `${stack}-unit`,
    60_000,
    nativeUnitDeadlineMs(nativeEnv)
  );
  assertInheritedUnitExecution(candidate, stack);
  const observed = inheritedOutputs(candidate, host, stack);
  await verifyInheritedStability(candidate, host, stack, install, observed);
  return observed;
}

/**
 * Keep all generated and native output bytes through repeat adoption/install.
 * @param candidate - Immutable archive and native environment
 * @param host - Built framework host
 * @param stack - Supported inherited route
 * @param install - Genuine dependency installation arguments
 * @param observed - Captured installed versions and native artifact hashes
 */
async function verifyInheritedStability(
  candidate: Candidate,
  host: string,
  stack: InheritedStack,
  install: readonly string[],
  observed: ReturnType<typeof inheritedOutputs>
): Promise<void> {
  await checkpoint(candidate, host, `${stack}-native-built`);
  const first = snapshot(host);
  await apply(candidate, host, stack, "second-adoption");
  expect(
    snapshot(host),
    "all managed and captured output bytes survive second apply"
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
    "frozen installation has no captured byte delta"
  ).toEqual(first);
  expect(inheritedOutputs(candidate, host, stack)).toEqual(observed);
}

/**
 * Observe complete additional native host adoption without cloud/UI claims.
 * @param candidate - Immutable packed CLI and genuine archive oracle
 * @param registry - Candidate-specific registry URL
 * @param stack - Supported inherited route
 */
export async function verifyInheritedHost(
  candidate: Candidate,
  registry: string,
  stack: InheritedStack
): Promise<void> {
  const started = performance.now();
  const bun = qualifiedHostBun();
  const nativeCandidate = {
    ...candidate,
    env: {
      ...candidate.env,
      PATH: `${path.dirname(bun.path)}${path.delimiter}${candidate.env["PATH"] ?? ""}`,
    },
  };
  const { host, observation } = await prepareInheritedHost(
    nativeCandidate,
    stack
  );
  const outputs = await runInheritedNative(
    nativeCandidate,
    host,
    stack,
    registry
  );
  write(candidate.logs, `${stack}-proof.json`, {
    stack,
    sourceHead: candidate.sourceHead,
    indexTree: candidate.indexTree,
    tarballSha256: candidate.tarballSha256,
    packedRegularMemberCount: candidate.memberCount,
    detector: observation,
    nativeBun: bun,
    setupCalls: 1,
    adoptionCalls: 2,
    ...outputs,
    nativeUnitCount: INHERITED_NATIVE_SPEC[stack].unitCount,
    secondAdoptionDelta: [],
    frozenInstallDelta: [],
    allPackedMemberBytesMatch: true,
    observedNodeVersion: observation.node,
    observedNodeAbi: observation.abi,
    caseWallMs: Math.round(performance.now() - started),
    limits:
      "Native framework build/unit observations; no cloud deployment, mobile-device execution, Harper server boot or rendered Phaser gameplay claim",
  });
}

/* eslint-enable code-organization/enforce-statement-order -- End the native owned-framework observations. */
