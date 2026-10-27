// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Explicit shared completion refusal categories. */
export class CompletionProofError extends Error {
  constructor(category, message) {
    super(message);
    this.name = "CompletionProofError";
    this.category = category;
  }
}

/** Refuse unusable data with the exact obligation an operator can repair. */
export function requireProof(condition, message, category = "invalid-proof") {
  if (!condition) throw new CompletionProofError(category, message);
}
