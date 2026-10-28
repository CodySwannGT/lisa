/**
 * Native-shaped synthetic provider data around a real disposable Git merge.
 * These payloads test authorization; they are not claimed as hosted evidence.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  renderLisaUsageSection,
  createLisaUsageRollup,
  type LisaUsageEntry,
} from "../../src/utils/usage-accounting.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  createFixture,
  githubConfig,
  git,
  commit,
  type Fixture,
} from "./work-item-cli.js";
import { putAsset, PUBLISHER } from "./work-item-proof-assets.js";
import { prepareProofProvider } from "./work-item-proof-resources.js";
import { makeProofRecord } from "./work-item-proof-payload.js";
import { SPEC } from "./work-item-proof-spec.js";
export { SPEC } from "./work-item-proof-spec.js";
export {
  digest,
  putAsset,
  setApi,
  setCompare,
  PUBLISHER,
} from "./work-item-proof-assets.js";
const GITHUB_ACTIONS = "github-actions";
const ENTRYPOINT = "scripts/lisa-work-item.mjs";

export const PROOF_REF = "acme/code#42";
const WORKFLOW = ".github/workflows/deploy.yml";
/**
 * Canonical unavailable metrics are valid; future acceptance is not invented.
 * @param sourceRef - Exact canonical source work-item reference.
 * @returns Canonical stored usage section with explicitly unavailable metrics.
 */
export function proofUsage(sourceRef: string): string {
  const entry: LisaUsageEntry = {
    artifactRef: sourceRef.includes("#")
      ? `github:${sourceRef}`
      : `linear:acme/${sourceRef}`,
    cachedInputTokens: null,
    cost: null,
    currency: null,
    entryId: "verify-42",
    flow: "lisa-verify",
    inputTokens: null,
    model: "synthetic-fixture",
    outputTokens: null,
    parentArtifactRef: null,
    pricingSource: null,
    pricingStatus: "unavailable",
    provider: "fixture",
    reasoningTokens: null,
    runId: "fixture-run",
    source: "unavailable",
    totalTokens: null,
  };
  return renderLisaUsageSection({
    entries: [entry],
    rollup: createLisaUsageRollup([entry]),
  });
}

/**
 * Configure the real disposable host without changing lifecycle mappings.
 * @param fixture - Owned existing host repository.
 * @returns Configured production branch.
 */
function configureFixture(fixture: Fixture): string {
  const configFile = path.join(fixture.root, ".lisa.config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const branch =
    config.deploy?.branches?.production ??
    config.policy?.repository?.default_branch ??
    "main";
  const entrypoint = path.join(fixture.root, ENTRYPOINT);
  config.verification ??= {};
  config.verification.completion ??= {};
  config.verification.completion.delivery ??= {};
  config.verification.completion.delivery.production = {
    mechanism: GITHUB_ACTIONS,
    workflow_path: WORKFLOW,
    events: ["push"],
  };
  writeFileSync(configFile, JSON.stringify(config));
  mkdirSync(path.join(fixture.root, "scripts"), { recursive: true });
  if (!existsSync(entrypoint))
    symlinkSync(path.join(process.cwd(), ENTRYPOINT), entrypoint);
  return branch;
}
/**
 * Apply the actual fixture merge before its commit identity is read.
 * @param fixture - Owned disposable Git repository.
 * @returns Actual native-shaped merge commit.
 */
function mergeOnMain(fixture: Fixture): string {
  git(fixture.root, ["switch", "-q", "main"], fixture.env);
  git(
    fixture.root,
    ["merge", "--no-ff", "-q", "-m", "Merge fixture PR7", "feature/tracked"],
    fixture.env
  );
  return git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
}
/**
 * Coherent positive input built from actual fixture source and captured bytes.
 * @param sourceRef - Exact canonical source work item.
 * @param existing - Optional existing disposable host retaining its configuration.
 * @returns Owned fixture with native proof resources and coherent accepted record.
 */
export function proofFixture(sourceRef = PROOF_REF, existing?: Fixture) {
  const repository = sourceRef.includes("#")
    ? sourceRef.split("#")[0]!
    : "acme/code";
  const number = sourceRef.includes("#") ? Number(sourceRef.split("#")[1]) : 42;
  const fixture =
    existing ??
    createFixture({
      ...githubConfig("full", "code"),
      deploy: { branches: { production: "main" } },
    });
  const branch = configureFixture(fixture);
  const before = git(fixture.root, ["rev-parse", "main"], fixture.env);
  const prHead = commit(
    fixture,
    `fix: synthetic behavior\n\nWork-Item: ${sourceRef}\n`
  );
  const merge = mergeOnMain(fixture);
  const now = new Date().toISOString();
  const body = SPEC + proofUsage(sourceRef);
  const facts = prepareProofProvider(fixture, {
    repository,
    number,
    sourceRef,
    branch,
    before,
    prHead,
    merge,
    now,
    body,
  });
  const record = makeProofRecord(fixture, facts);
  return { ...fixture, before, prHead, merge, record, body };
}

/**
 * Attach a trusted record without pretending the fixture publication is live.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param record - Exact proof revision to attach.
 */
export function attachRecord(
  fixture: ReturnType<typeof proofFixture>,
  record = fixture.record
) {
  const pointer = putAsset(fixture, 4, record);
  const state = JSON.parse(
    readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")
  );
  const now = new Date().toISOString();
  state.comments.push({
    id: 2,
    body: `[lisa-completion-authorization]\n${JSON.stringify({
      schema_version: 1,
      repository: record.repository.name,
      record_id: record.record_id,
      revision: record.revision,
      asset_id: 4,
      sha256: pointer.sha256,
    })}`,
    user: PUBLISHER,
    created_at: now,
    updated_at: now,
  });
  writeFileSync(fixture.env.FAKE_GH_STATE_FILE!, JSON.stringify(state));
}

/**
 * Execute the live canonical MJS, never an app-dist replacement.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param args - Exact provider or CLI argument vector.
 * @returns Actual executable exit and captured output.
 */
export function proofCli(fixture: Fixture, args: string[]) {
  return boundedSpawnSync({
    label: `actual completion CLI ${args[0]}`,
    command: process.execPath,
    args: [ENTRYPOINT, ...args],
    cwd: fixture.root,
    env: { ...fixture.env, GH_TOKEN: "", GITHUB_TOKEN: "" },
  });
}
