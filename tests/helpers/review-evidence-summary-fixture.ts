/** Raw external responses for the real installed review-evidence command. */
import * as fs from "fs-extra";
import * as path from "node:path";

/** A realistic, sanitized completed-review response from the provider. */
export const COMPLETED_REVIEW_SUMMARY = [
  "Result: Success - Review completed",
  "",
  "Run metadata: synthetic controlled response",
  "Head: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "",
  "| Step | Status |",
  "| --- | --- |",
  "| Load pull request | Success |",
  "| Review changes | Success |",
  "| Publish review | Success |",
].join("\n");

/**
 * Builds a raw check run; overrides describe external API observations.
 * @param head The exact inspected commit.
 * @param overrides Fields supplied by a particular response case.
 * @returns A raw GitHub check run, before the prover's projection.
 */
export function rawSummaryCheckRun(
  head: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 101,
    name: "CodeRabbit",
    head_sha: head,
    status: "completed",
    conclusion: "success",
    app: { id: 347564, slug: "coderabbitai", name: "CodeRabbit" },
    created_at: "2026-10-28T10:00:00Z",
    started_at: "2026-10-28T10:00:01Z",
    completed_at: "2026-10-28T10:01:00Z",
    output: { title: "Finished", summary: COMPLETED_REVIEW_SUMMARY },
    ...overrides,
  };
}

/**
 * Supplies raw GitHub API payloads and executes the CLI's actual jq projection.
 * Only external observations are controlled; the prover and its imports are real.
 * @param bindir The isolated executable directory.
 * @param head The exact inspected commit.
 * @param observations Optional raw check runs and commit statuses.
 * @param observations.checkRuns Raw check-run rows, before jq projection.
 * @param observations.statuses Raw legacy commit statuses, before projection.
 * @param observations.responses Additional raw REST envelopes keyed by route.
 * @returns Completion after the raw responses and GitHub command are written.
 */
export async function installRawSummaryReviewGh(
  bindir: string,
  head: string,
  observations: {
    checkRuns?: readonly Record<string, unknown>[];
    statuses?: readonly Record<string, unknown>[];
    responses?: Record<string, unknown>;
  } = {}
): Promise<void> {
  await fs.writeJson(
    path.join(bindir, "response-overrides.json"),
    observations.responses ?? {}
  );
  await fs.writeJson(path.join(bindir, "commit-status-response.json"), {
    state: "success",
    sha: head,
    statuses: observations.statuses ?? [],
  });
  await fs.writeJson(path.join(bindir, "check-run-response.json"), {
    total_count: observations.checkRuns?.length ?? 1,
    check_runs: observations.checkRuns ?? [rawSummaryCheckRun(head)],
  });
  await fs.writeFile(
    path.join(bindir, "gh"),
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const args = process.argv.slice(2);
const head = ${JSON.stringify(head)};
const endpoint = args[1] ?? "";
const overrides = JSON.parse(fs.readFileSync(path.join(__dirname, "response-overrides.json"), "utf8"));
let raw;
if (args[0] === "api" && Object.hasOwn(overrides, endpoint.split("?")[0])) {
  raw = overrides[endpoint.split("?")[0]];
} else if (args[0] === "pr" && endpoint === "view") {
  raw = {headRefOid: head, baseRefName: "main", isDraft: false};
} else if (args[0] === "api" && endpoint.startsWith("repos/acme/code/commits/" + head + "/status")) {
  raw = JSON.parse(fs.readFileSync(path.join(__dirname, "commit-status-response.json"), "utf8"));
} else if (args[0] === "api" && endpoint.startsWith("repos/acme/code/commits/" + head + "/check-runs")) {
  raw = JSON.parse(fs.readFileSync(path.join(__dirname, "check-run-response.json"), "utf8"));
} else if (args[0] === "api" && endpoint.startsWith("repos/acme/code/pulls/1234/commits")) {
  raw = [{sha: head, parents: [{sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]}];
} else if (args[0] === "api" && ["repos/acme/code/pulls/1234/reviews", "repos/acme/code/issues/1234/comments", "repos/acme/code/commits/" + head + "/pulls"].some(value => endpoint.startsWith(value))) {
  raw = [];
} else if (args[0] === "api" && endpoint === "graphql") {
  raw = {data:{repository:{pullRequest:{reviews:{totalCount:0,nodes:[]},reviewThreads:{totalCount:0,nodes:[]}}}}};
} else if (args[0] === "api" && endpoint === "repos/acme/code/pulls/1234") {
  raw = {head:{sha:head},base:{ref:"main"},draft:false,additions:1,deletions:0,changed_files:1,commits:1};
} else {
  process.stderr.write("Unexpected controlled GitHub read: " + JSON.stringify(args) + "\\n");
  process.exitCode = 1;
  return;
}
const at = args.indexOf("--jq");
const query = at < 0 ? null : args[at + 1];
const result = query === null ? {status:0,stdout:JSON.stringify(raw) + "\\n",stderr:""} : spawnSync("jq", ["-r", query], {input:JSON.stringify(raw),encoding:"utf8"});
fs.appendFileSync(path.join(__dirname,"api-trace.jsonl"),JSON.stringify({args,raw,query,status:result.status,stdout:result.stdout,stderr:result.stderr}) + "\\n");
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;
`,
    { mode: 0o755 }
  );
}
