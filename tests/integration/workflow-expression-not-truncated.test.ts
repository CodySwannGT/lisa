/**
 * No shipped workflow may carry a TRUNCATED `${{` expression.
 *
 * This is the defect class that took the auto-update dispatch handler off the
 * air on every consumer repository within an hour of 7760f543 shipping
 * (CodySwannGT/lisa#3512). One line:
 *
 * ```yaml
 * name: ${{ inputs.action == 'x' && format('Update PR #{0}', inputs.pr_number) }}
 * ```
 *
 * In a plain (unquoted) YAML scalar, ` #` opens a comment. YAML therefore reads
 * that line as `${{ inputs.action == 'x' && format('Update PR` and discards the
 * rest — and it is not a YAML error, because nothing about YAML says a scalar
 * has to close a brace it does not know about.
 *
 * ## Why every existing check passed it
 *
 * The file parses. `yaml.load` returns a document, `loadWorkflow` returns a
 * workflow, the job graph is well-formed, `workflow_call` inputs still match
 * every caller, and the declared permission scopes are unchanged. 2068 tests
 * were green on the commit that shipped it. A parser-based assertion cannot see
 * this defect BY CONSTRUCTION: the parser is the thing that removed the
 * evidence.
 *
 * What sees it is the parsed VALUE. GitHub does not parse YAML and stop; it then
 * evaluates the scalar as an expression, and an unterminated `${{` is a load
 * failure for the whole file. The run that results has zero jobs and its `name`
 * degrades to its `path`, so it never reads red per-job and no annotation names
 * the line.
 *
 * ## The rule, and why it is one-sided
 *
 * Flag `${{` outnumbering `}}`. NOT mere imbalance — the mirror is legitimate:
 * `release.yml` passes `--releaseCommitMessageFormat "{{currentTag}}"` to
 * standard-version, a mustache template whose `}}` is nothing to do with
 * Actions. Flagging imbalance in both directions produced false positives on
 * real files; flagging only the truncating direction produced none across all
 * 62 shipped workflows.
 * @module tests/integration/workflow-expression-not-truncated
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { trackedPaths } from "../helpers/tracked-files.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Every workflow this repository SHIPS — its own plus every stack template.
 *
 * Discovered by walking rather than listed, so a new stack tree is covered with
 * nobody editing this file. Fixture trees are excluded on purpose: several hold
 * deliberately malformed workflows as the subject of other suites.
 * @returns Repo-relative paths of every shipped workflow file.
 */
function shippedWorkflows(): readonly string[] {
  return trackedPaths(REPO_ROOT).filter(
    entry =>
      /\.github\/workflows\/[^/]+\.ya?ml$/.test(entry) &&
      !entry.includes("fixtures/") &&
      !entry.startsWith("tests/")
  );
}

/** One truncated scalar, located well enough to fix without searching. */
interface Truncation {
  readonly where: string;
  readonly value: string;
}

/**
 * Walks a parsed YAML document and reports every scalar that opens more Actions
 * expressions than it closes.
 * @param node - The current node in the parsed document.
 * @param where - Dotted path to `node`, for the failure message.
 * @param found - Accumulator the walk appends to.
 */
function collectTruncations(
  node: unknown,
  where: string,
  found: Truncation[]
): void {
  if (typeof node === "string") {
    const opened = node.split("${{").length - 1;
    const closed = node.split("}}").length - 1;
    if (opened > closed) found.push({ where, value: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      collectTruncations(child, `${where}[${index}]`, found)
    );
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) {
      collectTruncations(child, `${where}.${key}`, found);
    }
  }
}

/**
 * The detector, over YAML source text.
 *
 * The sweep and the bite control below both call THIS function. A control that
 * exercised a second copy of the rule would prove that copy works and say
 * nothing about the one guarding the repository.
 * @param source - Raw YAML text.
 * @returns Every truncated expression the document contains.
 */
function truncationsIn(source: string): readonly Truncation[] {
  const found: Truncation[] = [];
  collectTruncations(yaml.load(source), "", found);
  return found;
}

describe("shipped workflow expressions", () => {
  it("discovers the shipped workflow set", () => {
    // Guards the sweep below against silently measuring nothing: a filter that
    // matched zero files would pass every assertion in this suite.
    expect(shippedWorkflows().length).toBeGreaterThan(40);
  });

  it.each(shippedWorkflows())("%s closes every expression it opens", file => {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    const truncated = truncationsIn(source);

    expect(
      truncated.map(t => `${t.where}: ${JSON.stringify(t.value)}`),
      `${file} opens an Actions expression it never closes. Almost always an ` +
        `unquoted scalar containing " #", which YAML reads as a comment and ` +
        `truncates. Wrap the whole scalar in double quotes. GitHub will refuse ` +
        `to LOAD this file — the run gets zero jobs and never reads red.`
    ).toEqual([]);
  });
});

describe("the detector bites", () => {
  // Mirror-and-mutate. The sweep above passes on a clean tree, which is also
  // what a detector that can never fire would do. This reintroduces the exact
  // defect into the exact file it shipped in and requires the detector to catch
  // it — so a green sweep means "checked and clean", not "checked nothing".
  const SUBJECT = path.join(
    REPO_ROOT,
    ".github/workflows/reusable-auto-update-pr-branches-dispatch.yml"
  );

  it("catches the unquoted job name that broke CodySwannGT/lisa#3512", () => {
    const fixed = fs.readFileSync(SUBJECT, "utf8");
    expect(truncationsIn(fixed)).toEqual([]);

    // The only difference is the quoting. Strip the double quotes GitHub needs
    // and the ` #` inside the scalar reverts to opening a YAML comment.
    const quoted =
      `    name: "\${{ inputs.action == 'auto-update-pr-branch' && ` +
      `format('Update PR #{0}', inputs.pr_number) || ` +
      `format('Update open PRs targeting {0}', inputs.ref_name) }}"`;
    expect(fixed).toContain(quoted);

    const mutant = fixed.replace(quoted, quoted.replace(/"/g, ""));
    expect(mutant).not.toEqual(fixed);

    const caught = truncationsIn(mutant);
    expect(caught).toHaveLength(1);
    expect(caught[0]?.where).toBe(".jobs.update-pr-branches.name");
    expect(caught[0]?.value).toBe(
      "${{ inputs.action == 'auto-update-pr-branch' && format('Update PR"
    );
  });
});
