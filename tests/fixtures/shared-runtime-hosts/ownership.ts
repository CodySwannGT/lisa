/** Existing host choices remain intact through genuine packed CLI applies. */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "vitest";
import { resolveGit } from "../../support/git-executable.js";
import { type Candidate } from "./artifact.js";
import { apply, checkpoint } from "./actions.js";
import { seedHost, snapshot, write } from "./host.js";
import { run } from "./process.js";

const PREVIOUS_NODE = "22.23.3";
const PACKAGE_JSON = "package.json";
const LISA_CONFIG = ".lisa.config.json";

/** Distinct existing-host runtime ownership condition. */
type OwnershipMode = "known" | "ignored" | "custom";

const EXISTING_WORKFLOWS = [
  "ci.yml",
  "review-evidence.yml",
  "third-party-review-evidence.yml",
] as const;
const WORKFLOW_BYTES =
  "# Host-owned runtime override\nname: Host runtime\non: workflow_dispatch\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v6\n        with:\n          node-version: ${{ vars.NODE_VERSION || '22.23.3' }}\n";

/**
 * Seed a disposable TypeScript host into a fresh repository and checkpoint it.
 * @param candidate - Exact packed artifact and environment
 * @param host - Disposable host directory
 * @param name - Evidence log prefix for this ownership condition
 */
async function seedOwnershipRepository(
  candidate: Candidate,
  host: string,
  name: string
): Promise<void> {
  const git = resolveGit();
  seedHost(host, "typescript");
  await run(
    git,
    ["init", "--initial-branch=main"],
    host,
    candidate.env,
    candidate.logs,
    `${name}-init`
  );
  await run(
    git,
    ["config", "user.name", "Runtime verification"],
    host,
    candidate.env,
    candidate.logs,
    `${name}-name`
  );
  await run(
    git,
    ["config", "user.email", "verification@example.invalid"],
    host,
    candidate.env,
    candidate.logs,
    `${name}-email`
  );
  await checkpoint(candidate, host, `${name}-seed`);
}

/**
 * Write the host-owned runtime choices that later applies must preserve.
 * @param host - Bootstrapped host directory
 * @param mode - Distinct existing-host ownership condition
 * @returns Exact original `.nvmrc` bytes the host chose
 */
function writeExistingOwnership(host: string, mode: OwnershipMode): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(host, PACKAGE_JSON), "utf8")
  );
  const previous = mode === "custom" ? "24.999.0\n" : `${PREVIOUS_NODE}\n`;
  write(host, PACKAGE_JSON, {
    ...manifest,
    engines: { node: PREVIOUS_NODE },
  });
  write(host, ".nvmrc", previous);
  if (mode === "ignored") write(host, ".lisaignore", ".nvmrc\n");
  for (const workflow of EXISTING_WORKFLOWS)
    write(host, `.github/workflows/${workflow}`, WORKFLOW_BYTES);
  return previous;
}

/**
 * Seed a disposable existing host with explicit runtime ownership controls.
 * @param candidate - Exact packed artifact and environment
 * @param mode - Distinct existing-host ownership condition
 * @returns Seeded host paths and exact original ownership bytes
 */
async function prepareOwnershipHost(candidate: Candidate, mode: OwnershipMode) {
  const name = `ownership-${mode}`;
  const host = path.join(candidate.root, name);
  await seedOwnershipRepository(candidate, host, name);
  // Bootstrap creates the existing Lisa config; the measured two applies
  // below exercise adoption, rather than first-time gate onboarding.
  await apply(candidate, host, name, "bootstrap");
  const previous = writeExistingOwnership(host, mode);
  await checkpoint(candidate, host, `${name}-existing-ownership`);
  return { name, host, previous };
}

/**
 * Apply once and assert every host-owned runtime choice survived.
 * @param candidate - Exact packed artifact and environment
 * @param host - Host carrying existing ownership choices
 * @param name - Evidence log prefix for this ownership condition
 * @param expected - `.nvmrc` bytes the first apply must leave
 */
async function assertFirstApply(
  candidate: Candidate,
  host: string,
  name: string,
  expected: string
): Promise<void> {
  await apply(candidate, host, name, "first");
  expect(
    JSON.parse(fs.readFileSync(path.join(host, PACKAGE_JSON), "utf8")).engines
      .node
  ).toBe(PREVIOUS_NODE);
  expect(fs.readFileSync(path.join(host, ".nvmrc"), "utf8")).toBe(expected);
  for (const workflow of EXISTING_WORKFLOWS)
    expect(
      fs.readFileSync(path.join(host, ".github/workflows", workflow), "utf8")
    ).toBe(WORKFLOW_BYTES);
  await checkpoint(candidate, host, `${name}-first`);
}

/**
 * Apply again and assert the host is byte-identical to the first apply.
 * @param candidate - Exact packed artifact and environment
 * @param host - Host checkpointed after its first apply
 * @param name - Evidence log prefix for this ownership condition
 * @param mode - Distinct existing-host ownership condition
 */
async function assertSecondApplyIdentity(
  candidate: Candidate,
  host: string,
  name: string,
  mode: OwnershipMode
): Promise<void> {
  const first = snapshot(host);
  const configBefore = fs.readFileSync(path.join(host, LISA_CONFIG), "utf8");
  await apply(candidate, host, name, "second");
  const configAfter = fs.readFileSync(path.join(host, LISA_CONFIG), "utf8");
  if (configAfter !== configBefore)
    process.stdout.write(
      `${JSON.stringify({ mode, configBefore, configAfter }, null, 2)}\n`
    );
  expect(snapshot(host), "existing host second apply byte identity").toEqual(
    first
  );
}

/**
 * Exercise genuine CLI ownership boundaries with known, ignored and custom nvmrc.
 * @param candidate - Exact packed artifact and environment
 * @param mode - Distinct existing-host ownership condition
 */
export async function verifyRuntimeOwnership(
  candidate: Candidate,
  mode: OwnershipMode
): Promise<void> {
  const { name, host, previous } = await prepareOwnershipHost(candidate, mode);
  const expected = mode === "known" ? "24.21.0\n" : previous;
  await assertFirstApply(candidate, host, name, expected);
  await assertSecondApplyIdentity(candidate, host, name, mode);
  write(candidate.logs, `${name}-proof.json`, {
    sourceHead: candidate.sourceHead,
    indexTree: candidate.indexTree,
    tarballSha256: candidate.tarballSha256,
    mode,
    setupCalls: 1,
    adoptionCalls: 2,
    observedNodeVersion: process.versions.node,
    observedNodeAbi: process.versions.modules,
    engine: PREVIOUS_NODE,
    nvmrc: expected,
    existingWorkflowByteDelta: [],
    secondApplyDelta: [],
  });
}
