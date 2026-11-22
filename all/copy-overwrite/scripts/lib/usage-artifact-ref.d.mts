// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

export declare const LINEAR_REQUIRED_FORM: "linear:<workspace>/<KEY-N>";
export declare function canonicalArtifactRefViolation(
  ref: string
): string | null;
export declare function assertCanonicalArtifactRef(ref: string): void;
