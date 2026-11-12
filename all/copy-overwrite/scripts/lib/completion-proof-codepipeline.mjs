// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Read-only CodePipeline delivery proof for hosts that do not deploy through
 * GitHub Actions — a CDK host releases from Actions and is delivered by its
 * pipeline, so the pipeline's own execution record is the delivery fact.
 *
 * The accepted record pins one execution; this module reads exactly that
 * execution with `codepipeline:GetPipelineExecution` and never writes. An
 * execution still running (including one waiting at a manual approval) is
 * pending, never delivered; one that ended any other way than Succeeded, or
 * that carried another commit, is refused with both facts named.
 */
import {
  CompletionProofError,
  MAX_NATIVE_JSON_BYTES,
  isObject,
  isOid,
  requireProof,
} from "./completion-proof-shape.mjs";

export const CODEPIPELINE = "aws-codepipeline";

/** Every delivery mechanism completion can verify; anything else is undeclared. */
export const DELIVERY_MECHANISMS = Object.freeze([
  "github-actions",
  CODEPIPELINE,
  "artifact",
  "external-deployment",
]);

/** A CodePipeline name as AWS accepts it. */
export const PIPELINE_NAME_PATTERN = /^[A-Za-z0-9.@_-]{1,100}$/;

/** An AWS region identifier such as `us-east-1`. */
export const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d$/;

/** An AWS account id: exactly twelve digits. */
export const ACCOUNT_ID_PATTERN = /^\d{12}$/;

const PENDING_PROOF = "pending-proof";
const READ_ERROR = "read-error";
const EXECUTION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OBSERVER_ACCESS =
  "read-only observer access that grants codepipeline:GetPipelineExecution on that pipeline";

/** The configured pipeline must be named before any record can be checked. */
function requireConfigured(configured, environment) {
  const setting = `verification.completion.delivery.${environment}`;
  requireProof(
    typeof configured.pipeline_name === "string" &&
      typeof configured.region === "string",
    `The aws-codepipeline delivery mechanism needs ${setting}.pipeline_name and ${setting}.region naming the pipeline that delivers ${environment}; add them and run canonical Verify/evidence.`,
    PENDING_PROOF
  );
  requireProof(
    PIPELINE_NAME_PATTERN.test(configured.pipeline_name) &&
      REGION_PATTERN.test(configured.region),
    `${setting}.pipeline_name or ${setting}.region is not a valid CodePipeline name or AWS region.`
  );
  requireProof(
    configured.account_id === undefined ||
      (typeof configured.account_id === "string" &&
        ACCOUNT_ID_PATTERN.test(configured.account_id)),
    `${setting}.account_id is not a 12-digit AWS account id.`
  );
}

/** The record pins the configured pipeline, one execution and the delivered commit. */
function requireRecorded(delivery, configured, deliveredSha) {
  requireProof(
    delivery.pipeline_name === configured.pipeline_name &&
      delivery.region === configured.region,
    `The accepted delivery names pipeline ${String(delivery.pipeline_name)} in ${String(delivery.region)}, but project configuration delivers through ${configured.pipeline_name} in ${configured.region}.`
  );
  requireProof(
    configured.account_id === undefined ||
      delivery.account_id === configured.account_id,
    `The accepted delivery names AWS account ${String(delivery.account_id)}, but project configuration delivers through account ${configured.account_id}.`
  );
  requireProof(
    typeof delivery.execution_id === "string" &&
      EXECUTION_ID.test(delivery.execution_id) &&
      isOid(delivery.source_revision) &&
      delivery.source_revision === deliveredSha,
    "The accepted CodePipeline delivery must pin one pipeline execution id and the delivered commit as its source revision."
  );
}

/** Why a read failed, in words an operator can act on, without echoing AWS output. */
function readFailureHint(result) {
  if (result.error?.code === "ENOENT")
    return " The AWS CLI is not installed where verification runs.";
  const stderr = String(result.stderr ?? "");
  if (/AccessDenied|not authorized/i.test(stderr))
    return " AWS denied the read.";
  if (
    /ExpiredToken|InvalidClientTokenId|Unable to locate credentials/i.test(
      stderr
    )
  )
    return " No valid AWS credentials were available.";
  if (/PipelineExecutionNotFound|PipelineNotFound/.test(stderr))
    return " AWS reports no such pipeline execution.";
  return "";
}

/**
 * One read-only AWS CLI call whose JSON reply must hold an object at `field`.
 * Any failure is a read-error naming what was read and what access it needs.
 */
function readAws(run, args, field, subject, needs) {
  const result = run("aws", args, {
    allowFailure: true,
    maxBuffer: MAX_NATIVE_JSON_BYTES,
  });
  if (result.status !== 0 || result.error)
    throw new CompletionProofError(
      READ_ERROR,
      `The ${subject} could not be read.${readFailureHint(result)} Verification needs ${needs}.`
    );
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    value = undefined;
  }
  if (!isObject(value) || (field && !isObject(value[field])))
    throw new CompletionProofError(
      READ_ERROR,
      `The ${subject} read did not return a complete reply.`
    );
  return field ? value[field] : value;
}

/**
 * The credentials must belong to the configured account before any execution
 * is read: same-named pipelines in another stage's account would otherwise
 * read as this environment's delivery. `sts:GetCallerIdentity` needs no grant.
 */
function requireAccount(run, configured) {
  if (configured.account_id === undefined) return;
  const identity = readAws(
    run,
    ["sts", "get-caller-identity", "--output=json"],
    null,
    "AWS caller identity",
    `AWS credentials for account ${configured.account_id}`
  );
  requireProof(
    identity.Account === configured.account_id,
    `The AWS credentials verification is using belong to account ${String(identity.Account)}, not ${configured.account_id}, the account that runs ${configured.pipeline_name}; use credentials for that account and run canonical Verify/evidence again.`
  );
}

/** Exactly one read-only native read of the pinned execution. */
function readExecution(run, delivery) {
  return readAws(
    run,
    [
      "codepipeline",
      "get-pipeline-execution",
      `--pipeline-name=${delivery.pipeline_name}`,
      `--pipeline-execution-id=${delivery.execution_id}`,
      `--region=${delivery.region}`,
      "--output",
      "json",
    ],
    "pipelineExecution",
    `CodePipeline execution ${delivery.execution_id} of ${delivery.pipeline_name} in ${delivery.region}`,
    OBSERVER_ACCESS
  );
}

/** Succeeded at the delivered commit is delivery; anything else is not. */
function decideExecution(execution, delivery, sha) {
  const id = delivery.execution_id;
  requireProof(
    execution.pipelineExecutionId === id &&
      execution.pipelineName === delivery.pipeline_name,
    `The CodePipeline read returned another execution than ${id} of ${delivery.pipeline_name}.`
  );
  const revisions = (execution.artifactRevisions ?? [])
    .map(row => row?.revisionId)
    .filter(value => typeof value === "string");
  requireProof(
    revisions.includes(sha),
    `CodePipeline execution ${id} of ${delivery.pipeline_name} carried source revision ${revisions.join(", ") || "(none)"}, not the delivered commit ${sha}.`
  );
  requireProof(
    execution.status !== "InProgress",
    `CodePipeline execution ${id} of ${delivery.pipeline_name} is still InProgress (it may be waiting at a manual approval), so ${sha} is not delivered yet; run canonical Verify/evidence again once it succeeds.`,
    PENDING_PROOF
  );
  const state =
    execution.status === "Stopping"
      ? "is Stopping"
      : `ended ${String(execution.status)}`;
  requireProof(
    execution.status === "Succeeded",
    `CodePipeline execution ${id} of ${delivery.pipeline_name} ${state}, so it did not deliver ${sha}; pin an execution that Succeeded at that commit.`
  );
}

/**
 * Prove a CodePipeline delivery from the pipeline's own execution record.
 * @param {object} delivery - The accepted record's delivery obligation.
 * @param {object} configured - `verification.completion.delivery.<env>`.
 * @param {object} context - Completion context (`environment`, `run`).
 * @param {string} deliveredSha - The record's delivered commit.
 */
export function validateCodePipelineDelivery(
  delivery,
  configured,
  context,
  deliveredSha
) {
  requireConfigured(configured, context.environment);
  requireRecorded(delivery, configured, deliveredSha);
  requireAccount(context.run, configured);
  decideExecution(readExecution(context.run, delivery), delivery, deliveredSha);
}

/**
 * One report line naming what delivered the work, for a CodePipeline record.
 * @param {object} [record] - The accepted completion record.
 * @returns {string} A leading-newline line, or "" for other mechanisms.
 */
export function describeCodePipelineDelivery(record) {
  const delivery = record?.obligations?.delivery;
  if (delivery?.mechanism !== CODEPIPELINE) return "";
  return `\ndelivered by CodePipeline ${delivery.pipeline_name} execution ${delivery.execution_id} at ${delivery.source_revision}`;
}
