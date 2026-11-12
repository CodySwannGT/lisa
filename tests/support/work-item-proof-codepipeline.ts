/**
 * A CDK host whose delivery is proven by a CodePipeline execution, served by
 * the argv-table fake `aws`. Payloads are synthetic and only test authorization.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { proofFixture } from "./work-item-proof-fixture.js";

export const PIPELINE = "host-delivery";
export const REGION = "us-east-1";
export const EXECUTION_ID = "3f1c9a52-7d4e-4b8a-9c21-5e6f7a8b9c0d";

/** A fixture whose configuration and accepted record use CodePipeline delivery. */
export type PipelineFixture = ReturnType<typeof proofFixture>;

/** The exact read-only call the verifier is allowed to make. */
export const GET_EXECUTION = [
  "codepipeline",
  "get-pipeline-execution",
  `--pipeline-name=${PIPELINE}`,
  `--pipeline-execution-id=${EXECUTION_ID}`,
  `--region=${REGION}`,
  "--output",
  "json",
];

/** The identity read made before the execution when an account is configured. */
export const GET_CALLER_IDENTITY = [
  "sts",
  "get-caller-identity",
  "--output=json",
];

/**
 * Register one exact `aws` argument vector and its answer.
 * @param fixture - Owned disposable host with the fake `aws` installed.
 * @param args - Exact AWS CLI argument vector.
 * @param response - `{ json }` to answer, or `{ failure, status }` to fail.
 */
export function setAws(
  fixture: PipelineFixture,
  args: string[],
  response: unknown
): void {
  const file = fixture.env.FAKE_AWS_API_FILE!;
  const table = JSON.parse(readFileSync(file, "utf8"));
  table[JSON.stringify(args)] = response;
  writeFileSync(file, JSON.stringify(table));
}

/**
 * Serve the pinned execution with a given status and source revision.
 * @param fixture - Owned disposable host.
 * @param status - CodePipeline execution status.
 * @param revision - The execution's source artifact revision, or several.
 */
export function setExecution(
  fixture: PipelineFixture,
  status: string,
  revision: string | readonly string[]
): void {
  const revisions = typeof revision === "string" ? [revision] : revision;
  setAws(fixture, GET_EXECUTION, {
    json: {
      pipelineExecution: {
        pipelineName: PIPELINE,
        pipelineVersion: 3,
        pipelineExecutionId: EXECUTION_ID,
        status,
        artifactRevisions: revisions.map((revisionId, index) => ({
          name: `SourceArtifact${index}`,
          revisionId,
          revisionSummary: "Merge fixture PR7",
        })),
      },
    },
  });
}

/**
 * Turn the standard proof fixture into a CodePipeline-delivered CDK host.
 * @param config - Delivery setting to write; defaults to the full mechanism.
 * @returns Fixture whose accepted record pins the CodePipeline execution.
 */
export function pipelineFixture(
  config: Record<string, unknown> = {
    mechanism: "aws-codepipeline",
    pipeline_name: PIPELINE,
    region: REGION,
  }
): PipelineFixture {
  const fixture = proofFixture();
  const configFile = path.join(fixture.root, ".lisa.config.json");
  const current = JSON.parse(readFileSync(configFile, "utf8"));
  current.verification.completion.delivery.production = config;
  writeFileSync(configFile, JSON.stringify(current));
  writeFileSync(path.join(fixture.root, "cdk.json"), "{}\n");
  fixture.record.obligations.delivery = {
    required: true,
    status: "pass",
    mechanism: "aws-codepipeline",
    pipeline_name: PIPELINE,
    region: REGION,
    execution_id: EXECUTION_ID,
    source_revision: fixture.merge,
  } as unknown as typeof fixture.record.obligations.delivery;
  return fixture;
}

/**
 * What the fake `aws` saw: every call, and any call it was not told to answer.
 * @param fixture - Owned disposable host.
 * @returns Parsed call log and the raw unhandled-call record.
 */
export function awsCalls(fixture: PipelineFixture) {
  const calls = readFileSync(fixture.env.FAKE_AWS_LOG!, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as string[]);
  const unhandled = readFileSync(fixture.env.FAKE_AWS_UNHANDLED_FILE!, "utf8");
  return { calls, unhandled };
}

/**
 * Leave no `aws` anywhere on the fixture's PATH, so the spawn fails ENOENT.
 * The fake `gh` runs through `#!/usr/bin/env node`, and `node` can share a
 * directory with a real `aws` (Homebrew), so node is reached through a
 * private directory holding only a `node` symlink. Appending node's real
 * directory would put that real `aws` — and its credentials — back on PATH.
 * @param fixture - Owned disposable host.
 */
export function removeAws(fixture: PipelineFixture): void {
  const nodeOnly = path.join(fixture.root, "node-only-bin");
  // Removed before PATH is filtered, so fake-bin (which holds the fake gh)
  // no longer holds an aws and stays on PATH.
  rmSync(path.join(fixture.root, "fake-bin/aws"));
  mkdirSync(nodeOnly);
  symlinkSync(process.execPath, path.join(nodeOnly, "node"));
  fixture.env.PATH = [
    ...(fixture.env.PATH ?? "")
      .split(path.delimiter)
      .filter(dir => dir && !existsSync(path.join(dir, "aws"))),
    nodeOnly,
  ].join(path.delimiter);
}
