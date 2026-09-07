/**
 * Scan this repository's recent run history for reusable workflows that failed
 * to LOAD (CodySwannGT/lisa#3581).
 *
 * ## Why this runs on a schedule and not at a gate
 *
 * The failure is invisible at the moments a gate covers. On a pull request it
 * is already caught — `check-skipped-required-checks --pr=<n>` raises
 * `absent_required_check`, and a ruleset-required context that never reports
 * blocks the merge anyway. The incident this closes happened somewhere no gate
 * looks: a `push` handler failed five times in a row, ~40 minutes after an
 * upstream commit landed, with nothing changed on the consumer side and no red
 * job to open. A control that only runs where the failure cannot happen is not
 * a control, so the moment is the design decision here, not the mechanism.
 *
 * The sibling precedent is `lifecycle-drift-sweep.yml`, which exists because a
 * report nobody scheduled and nobody read is indistinguishable from no report.
 * This follows it: scheduled, and failing the job on drift so the finding lands
 * in the existing failure-to-issue path rather than a job summary nobody opens.
 *
 * ## Two ways to exit non-zero, and they mean different things
 *
 * Findings are one. **A window this scan could not cover is the other**, and it
 * is the more important of the two: the implementation this replaces read one
 * page, filtered by timestamp, and reported that a hundred runs were inspected
 * across a window that contained four known load failures. "Found nothing" and
 * "could not look" must never render as the same green.
 * @module scripts/check-workflow-load-failures
 */
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { callerDeclaresReusableWorkflow } from "../src/core/reusable-workflow-load-failure.js";
import {
  createRunPageFetcher,
  type GithubRequest,
} from "../src/core/reusable-workflow-load-adapter.js";
import {
  scanForLoadFailures,
  type ScanResult,
} from "../src/core/reusable-workflow-load-scan.js";

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
export async function buildPopulationTest(
  root: string
): Promise<(runPath: string) => boolean> {
  const dir = path.join(root, WORKFLOW_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  const declaring = await Promise.all(
    names
      .filter(name => name.endsWith(".yml") || name.endsWith(".yaml"))
      .map(async name => {
        const source = await readFile(path.join(dir, name), "utf8").catch(
          () => ""
        );
        return callerDeclaresReusableWorkflow(source) ? name : "";
      })
  );
  const declared = new Set(declaring.filter(name => name !== ""));
  return (runPath: string): boolean => declared.has(path.basename(runPath));
}

/**
 * A request function backed by the `gh` CLI.
 * @param repo - Repository in `owner/name` form, used only for error text
 * @returns A request function returning decoded JSON
 */
export function ghRequest(repo: string): GithubRequest {
  return async (apiPath: string): Promise<unknown> => {
    const { stdout } = await run("gh", ["api", apiPath], {
      maxBuffer: 32 * 1024 * 1024,
    });
    try {
      return JSON.parse(stdout) as unknown;
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
export function describe(result: ScanResult): string {
  if (!result.covered) {
    return `check-workflow-load-failures: INCOMPLETE. The scan ${result.reason} It inspected ${result.inspected} run(s), but that is not the same as having covered the window, so this is an error rather than a pass.`;
  }
  if (result.loadFailures.length === 0) {
    return `check-workflow-load-failures: OK. ${result.inspected} run(s) inspected across the last ${WINDOW_HOURS}h; every caller that declared a reusable workflow resolved one.`;
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
export async function main(repo: string, root: string): Promise<number> {
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

/* c8 ignore start -- entry point, exercised by the workflow rather than a test */
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  const repo = process.env["GITHUB_REPOSITORY"] ?? "CodySwannGT/lisa";
  main(repo, process.cwd())
    .then(code => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(String(error));
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
