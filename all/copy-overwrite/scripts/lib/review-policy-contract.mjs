// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
// Separate from the legacy verdict so adopting the new policy is explicit.
export const REVIEW_POLICY_CONTEXT = "🕵️ Review policy verdict";
export const REVIEW_POLICY_APP = 15368;
export const REVIEW_POLICY_WORKFLOW = "review-policy.yml";
export const REVIEW_HEAD = /^[a-f0-9]{40}$/u;
export const REVIEW_REPO =
  /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/u;

/** Parse a positive integer exactly as a GitHub selector. */
export function nativeNumber(value) {
  return /^[1-9]\d*$/u.test(String(value)) &&
    Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;
}
