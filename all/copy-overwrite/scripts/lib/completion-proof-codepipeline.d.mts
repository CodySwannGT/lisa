// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** The CodePipeline delivery mechanism name. */
export const CODEPIPELINE: "aws-codepipeline";

/** Every delivery mechanism completion can verify. */
export const DELIVERY_MECHANISMS: readonly string[];

/** A CodePipeline name as AWS accepts it. */
export const PIPELINE_NAME_PATTERN: RegExp;

/** An AWS region identifier such as `us-east-1`. */
export const REGION_PATTERN: RegExp;

/** An AWS account id: exactly twelve digits. */
export const ACCOUNT_ID_PATTERN: RegExp;

/** Prove a CodePipeline delivery from the pipeline's own execution record. */
export function validateCodePipelineDelivery(
  delivery: object,
  configured: object,
  context: object,
  deliveredSha: string
): void;

/** One report line naming what delivered the work, or "". */
export function describeCodePipelineDelivery(record?: object): string;
