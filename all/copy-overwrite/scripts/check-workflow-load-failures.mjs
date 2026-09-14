#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { callerDeclaresReusableWorkflow } from "./lib/reusable-workflow-load-failure.mjs";
import { createRunPageFetcher } from "./lib/reusable-workflow-load-adapter.mjs";
import { scanForLoadFailures } from "./lib/reusable-workflow-load-scan.mjs";
const run = promisify(execFile);
/** Where caller workflows live, relative to the repository root. */
const WORKFLOW_DIR = ".github/workflows";
/** How far back to scan, in hours. */
const WINDOW_HOURS = 26;
/**
 * Page cap.
 *
 * Hitting it is NOT coverage — the scan reports the window as uncovered and
 * this script exits non-zero, because a cap is a budget somebody set and not
 * evidence about the runs beyond it.
 */
const MAX_PAGES = 20;
/**
 * Build the population test by reading the callers' own source.
 *
 * Derived, never enumerated: there is no list of known callers here, because a
 * roster silently excludes every workflow nobody remembered to add and the
 * exclusion looks exactly like a pass.
 * @param root - Repository root
 * @returns A predicate over a run's caller `path`
 */
export async function buildPopulationTest(root) {
  const dir = path.join(root, WORKFLOW_DIR);
  const names = await readdir(dir);
  const declaring = await Promise.all(
    names
      .filter(name => name.endsWith(".yml") || name.endsWith(".yaml"))
      .map(async name => {
        const source = await readFile(path.join(dir, name), "utf8");
        return callerDeclaresReusableWorkflow(source) ? name : "";
      })
  );
  const declared = new Set(declaring.filter(name => name !== ""));
  return runPath => declared.has(path.basename(runPath));
}
/**
 * A request function backed by the `gh` CLI.
 * @param repo - Repository in `owner/name` form, used only for error text
 * @returns A request function returning decoded JSON
 */
export function ghRequest(repo) {
  return async apiPath => {
    const { stdout } = await run("gh", ["api", apiPath], {
      maxBuffer: 32 * 1024 * 1024,
    });
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(
        `check-workflow-load-failures: \`gh api ${apiPath}\` on ${repo} returned a body that is not JSON. Treating that as "nothing found" would be a pass produced by a broken read, so this is an error.`
      );
    }
  };
}
/**
 * Render the scan's answer for an operator.
 * @param result - What the scan found, and whether it could see
 * @returns Operator-readable lines
 */
export function describe(result) {
  if (!result.covered) {
    return `check-workflow-load-failures: INCOMPLETE. The scan ${result.reason} It inspected ${result.inspected} run(s), but that is not the same as having covered the window, so this is an error rather than a pass.`;
  }
  if (result.loadFailures.length === 0) {
    return `check-workflow-load-failures: OK. ${result.inspected} run(s) inspected across the last ${WINDOW_HOURS}h; no reusable workflow load failures found.`;
  }
  const lines = result.loadFailures.map(
    finding =>
      `  - run ${finding.id} (${finding.path}) declared a reusable workflow and resolved none`
  );
  return [
    `check-workflow-load-failures: ${result.loadFailures.length} run(s) failed to LOAD a reusable workflow.`,
    ...lines,
    "",
    "A load failure creates NO jobs, so there is no red job to open and no annotation naming the line. Check the upstream workflow's most recent commit for a syntax or schema error.",
  ].join("\n");
}
/**
 * Scan, report, and choose an exit code.
 * @param repo - Repository in `owner/name` form
 * @param root - Repository root
 * @returns 0 when the window was covered and clean, 1 otherwise
 */
export async function main(repo, root) {
  const windowStart = new Date(
    Date.now() - WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();
  const result = await scanForLoadFailures({
    fetchPage: createRunPageFetcher({ repo, request: ghRequest(repo) }),
    windowStart,
    inPopulation: await buildPopulationTest(root),
    maxPages: MAX_PAGES,
  });
  console.log(describe(result));
  return result.covered && result.loadFailures.length === 0 ? 0 : 1;
}
/** Run against the repository explicitly supplied by the workflow. */
export async function runCli() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    console.error("Set GITHUB_REPOSITORY to the owner/repository to scan.");
    process.exitCode = 1;
    return;
  }
  try {
    process.exitCode = await main(repo, process.cwd());
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCli();
}
