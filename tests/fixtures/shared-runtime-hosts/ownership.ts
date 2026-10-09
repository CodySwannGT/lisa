/* eslint-disable code-organization/enforce-statement-order -- Real CLI operations and before/after observations must stay chronological. */
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

/**
 * Seed a disposable existing host with explicit runtime ownership controls.
 * @param candidate - Exact packed artifact and environment
 * @param mode - Distinct existing-host ownership condition
 * @returns Seeded host paths and exact original ownership bytes
 */
async function prepareOwnershipHost(
  candidate: Candidate,
  mode: "known" | "ignored" | "custom"
) {
  const name = `ownership-${mode}`;
  const host = path.join(candidate.root, name);
  seedHost(host, "typescript");
  const git = resolveGit();
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
  // Bootstrap creates the existing Lisa config; the measured two applies
  // below exercise adoption, rather than first-time gate onboarding.
  await apply(candidate, host, name, "bootstrap");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(host, PACKAGE_JSON), "utf8")
  );
  write(host, PACKAGE_JSON, {
    ...manifest,
    engines: { node: PREVIOUS_NODE },
  });
  const previous = mode === "custom" ? "24.999.0\n" : `${PREVIOUS_NODE}\n`;
  write(host, ".nvmrc", previous);
  if (mode === "ignored") write(host, ".lisaignore", ".nvmrc\n");
  const existingWorkflows = [
    "ci.yml",
    "review-evidence.yml",
    "third-party-review-evidence.yml",
  ];
  const workflowBytes =
    "# Host-owned runtime override\nname: Host runtime\non: workflow_dispatch\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v6\n        with:\n          node-version: ${{ vars.NODE_VERSION || '22.23.3' }}\n";
  for (const workflow of existingWorkflows)
    write(host, `.github/workflows/${workflow}`, workflowBytes);
  await checkpoint(candidate, host, `${name}-existing-ownership`);
  return { name, host, previous, existingWorkflows, workflowBytes };
}

/**
 * Exercise genuine CLI ownership boundaries with known, ignored and custom nvmrc.
 * @param candidate - Exact packed artifact and environment
 * @param mode - Distinct existing-host ownership condition
 */
export async function verifyRuntimeOwnership(
  candidate: Candidate,
  mode: "known" | "ignored" | "custom"
): Promise<void> {
  const { name, host, previous, existingWorkflows, workflowBytes } =
    await prepareOwnershipHost(candidate, mode);
  await apply(candidate, host, name, "first");
  expect(
    JSON.parse(fs.readFileSync(path.join(host, PACKAGE_JSON), "utf8")).engines
      .node
  ).toBe(PREVIOUS_NODE);
  const expected = mode === "known" ? "24.21.0\n" : previous;
  expect(fs.readFileSync(path.join(host, ".nvmrc"), "utf8")).toBe(expected);
  for (const workflow of existingWorkflows)
    expect(
      fs.readFileSync(path.join(host, ".github/workflows", workflow), "utf8")
    ).toBe(workflowBytes);
  await checkpoint(candidate, host, `${name}-first`);
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

/* eslint-enable code-organization/enforce-statement-order -- End the chronological owned-host observations. */
