// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import { parseArgs } from "node:util";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  nativeNumber,
  REVIEW_HEAD,
  REVIEW_REPO,
} from "./lib/review-policy-contract.mjs";
import {
  loadReviewConfig,
  loadReviewDeclaration,
  policyReviewReport,
  readPolicyReview,
} from "./lib/review-policy-reader.mjs";

/** Read the provider policy and native review evidence for one pull-request head.
 * @param {string[]} argv - CLI arguments.
 * @param {object} [io] - Runtime inputs, replaceable in isolated tests.
 * @returns {number} Zero for reviewed, one for withheld, two for invalid input.
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const error = io.stderr ?? process.stderr;
  const root = io.cwd ?? process.cwd();
  try {
    const { tokens, values } = parseArgs({
      args: argv,
      options: {
        repo: { type: "string" },
        pr: { type: "string" },
        sha: { type: "string" },
        json: { type: "boolean" },
      },
      tokens: true,
    });
    if (
      tokens.some(token => token.kind !== "option") ||
      new Set(tokens.map(token => token.name)).size !== tokens.length ||
      !REVIEW_REPO.test(values.repo ?? "") ||
      nativeNumber(values.pr) === null ||
      !REVIEW_HEAD.test(values.sha ?? "")
    ) {
      error.write(
        "Give a repository, pull request and 40-character head SHA.\n"
      );
      return 2;
    }
    const verdict = readPolicyReview({
      config: loadReviewConfig(root),
      declaration: loadReviewDeclaration(root),
      repo: values.repo,
      pr: Number(values.pr),
      head: values.sha,
      api: io.api,
    });
    const report = values.json
      ? JSON.stringify(verdict)
      : policyReviewReport(verdict);
    out.write(`${report}\n`);
    return verdict.outcome === "reviewed" ? 0 : 1;
  } catch {
    error.write(
      "Review policy could not be read. Check the arguments and project configuration.\n"
    );
    return 2;
  }
}

if (invokedAsScript(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
