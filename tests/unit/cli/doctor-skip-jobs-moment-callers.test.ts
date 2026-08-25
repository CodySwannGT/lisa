/**
 * Tests for the half of the `skip_jobs` remediation that depends on WHO ELSE
 * resolves a token's moment.
 *
 * CodySwannGT/lisa#3100. A gate declaration is keyed by gate and moment in
 * `.lisa.config.json`, never by workflow, so it governs every job resolving
 * that moment. In a repository whose `ci.yml` calls `quality.yml` directly and
 * whose `deploy.yml` reaches it through `release.yml`, both resolve
 * `pull-request` — and declaring the gate off to neutralise the token on
 * `deploy.yml` also stops the check running for `ci.yml`, which was running it
 * for real. An operator following the advice literally ends up worse off than
 * the token left them.
 *
 * Every assertion here reads what the OPERATOR IS TOLD. The classification was
 * already correct before the fix, so a test that checked only the status would
 * have stayed green while the advice stayed harmful — the failure mode #3101
 * found in the sibling case.
 * @module tests/unit/cli/doctor-skip-jobs-moment-callers
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  checkSkipJobsMigration,
  qualityCalls,
} from "../../../src/cli/doctor-skip-jobs-migration.js";

/** The `jobs:` key every fixture opens its job map with. */
const JOBS_KEY = "jobs:";

/** The `with:` key carrying a caller's inputs. */
const WITH_KEY = "    with:";

/** The `node_version` input every fixture passes. */
const NODE_VERSION_INPUT = "      node_version: '22'";

/** The moment `quality.yml` resolves when a caller declares none. */
const PULL_REQUEST = "pull-request";

/** The workflow that calls `quality.yml` directly. */
const CI_FILE = "ci.yml";

/** That workflow's path, as doctor reports it. */
const CI_PATH = ".github/workflows/ci.yml";

/** The workflow that reaches `quality.yml` through `release.yml`. */
const DEPLOY_FILE = "deploy.yml";

/** That workflow's path, as doctor reports it. */
const DEPLOY_PATH = ".github/workflows/deploy.yml";

/** The token the ticket's two-caller repository skips. */
const UNIT_TOKEN = "test:unit";

let project: string;

/**
 * The clause doctor prints about ONE token, isolated from the summary.
 *
 * Asserting on the whole detail cannot tell the two apart: the summary speaks
 * about every token at once, so a phrase found anywhere in the output proves
 * nothing about what the operator was told to do with a specific token.
 * @param detail - The doctor check's detail string
 * @param token - The token to isolate
 * @returns That token's clause, or "" when it is absent
 */
function clauseFor(detail: string, token: string): string {
  const start = detail.indexOf(`${token} → `);
  if (start === -1) return "";
  const rest = detail.slice(start);
  const end = rest.indexOf("; ");
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Write a caller workflow into the temporary project.
 * @param body - Workflow file contents
 * @param name - File name under `.github/workflows`
 */
async function writeCaller(body: string, name: string): Promise<void> {
  const dir = path.join(project, ".github", "workflows");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), body, "utf8");
}

/**
 * A caller that reaches `quality.yml` and passes no `skip_jobs` at all.
 *
 * The job that decides whether a declaration is safe is normally this one: it
 * resolves the same moment and is running the checks for real.
 * @param tokens - The raw `skip_jobs` value, omitted when it passes none
 * @returns The workflow file contents
 */
const directCaller = (tokens?: string): string =>
  [
    "name: CI",
    "on: [pull_request]",
    JOBS_KEY,
    "  quality:",
    "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main",
    WITH_KEY,
    ...(tokens === undefined ? [] : [`      skip_jobs: '${tokens}'`]),
    NODE_VERSION_INPUT,
    "",
  ].join("\n");

/**
 * A deploy-shaped caller reaching `quality.yml` through `release.yml`.
 *
 * `release.yml` forwards its `moment` input on to `quality.yml`, so a job
 * calling it with no `moment` resolves the same pull-request gate set a direct
 * `quality.yml` caller does.
 * @param tokens - The raw `skip_jobs` value
 * @param moment - The `moment` input, omitted when the caller declares none
 * @returns The workflow file contents
 */
const releaseCaller = (tokens: string, moment?: string): string =>
  [
    "name: Deploy",
    "on: [push]",
    JOBS_KEY,
    "  release:",
    "    uses: CodySwannGT/lisa/.github/workflows/release.yml@main",
    WITH_KEY,
    "      environment: production",
    ...(moment === undefined ? [] : [`      moment: '${moment}'`]),
    `      skip_jobs: '${tokens}'`,
    NODE_VERSION_INPUT,
    "",
  ].join("\n");

/**
 * Build the ticket's two-caller repository and report on it.
 * @returns The isolated clause doctor prints about `test:unit`
 */
async function twoCallerClause(): Promise<string> {
  await writeCaller(directCaller(), CI_FILE);
  await writeCaller(releaseCaller(UNIT_TOKEN), DEPLOY_FILE);
  const check = await checkSkipJobsMigration(project);
  return clauseFor(check.detail, UNIT_TOKEN);
}

beforeEach(async () => {
  project = await mkdtemp(path.join(tmpdir(), "lisa-skip-jobs-moment-"));
});

describe("skip_jobs remediation with two callers on one moment", () => {
  it("names both workflows that resolve the pull-request moment", async () => {
    const clause = await twoCallerClause();
    expect(clause).toContain(CI_PATH);
    expect(clause).toContain(DEPLOY_PATH);
  });

  it("withholds the declare-off instruction instead of issuing it", async () => {
    // Before the fix this clause read `test:unit → declare "test-correctness":
    // { "pull-request": "off" } and delete the token` — the instruction the
    // ticket measured as a strict downgrade.
    const clause = await twoCallerClause();
    expect(clause).not.toContain("→ declare ");
    expect(clause).toContain("HOLD, do not declare this gate off yet");
  });

  it("says it cannot tell whether the other caller runs the check for real", async () => {
    const clause = await twoCallerClause();
    expect(clause).toContain("may be running the check for real");
    expect(clause).toContain("Doctor cannot tell from here");
  });

  it("sends the caller to a moment of its own, as release.yml documents", async () => {
    const clause = await twoCallerClause();
    expect(clause).toContain("moment: pre-deploy:<environment>");
    expect(clause).toContain("release.yml's moment input");
  });

  it("warns that a moment with nothing declared runs no checks", async () => {
    // The cost the ticket flags: moving a caller to a pre-deploy moment takes
    // it from running most gates to running whatever is declared there, which
    // in a project that has declared nothing is none of them.
    const clause = await twoCallerClause();
    expect(clause).toContain("a moment with nothing declared runs no checks");
  });

  it("stops the summary telling the operator to add every declaration", async () => {
    await writeCaller(directCaller(), CI_FILE);
    await writeCaller(releaseCaller(UNIT_TOKEN), DEPLOY_FILE);
    const check = await checkSkipJobsMigration(project);
    expect(check.detail).toContain("1 is marked HOLD below");
    expect(check.detail).not.toContain("has a gate to migrate to");
  });
});

describe("skip_jobs remediation where only one caller resolves the moment", () => {
  it("leaves the single-caller remediation exactly as it was", async () => {
    // The negative control. When ci.yml is the only path to quality.yml the
    // token and the moment correspond one-to-one, and declaring the gate off
    // records exactly the decision the token was making silently. Pinned as an
    // exact string so no future caveat can leak into this case.
    await writeCaller(directCaller(UNIT_TOKEN), CI_FILE);
    const check = await checkSkipJobsMigration(project);
    expect(clauseFor(check.detail, UNIT_TOKEN)).toBe(
      'test:unit → declare "test-correctness": { "pull-request": "off" } and ' +
        "delete the token"
    );
    expect(check.detail).toContain("1 of those has a gate to migrate to");
    expect(check.detail).not.toContain("HOLD");
  });

  it("does not hold a token whose caller resolves a moment of its own", async () => {
    // deploy.yml already passes a moment, so nothing else resolves it and the
    // declaration is safe. The caveat must not fire on every project that
    // happens to have two callers.
    await writeCaller(directCaller(), CI_FILE);
    await writeCaller(
      releaseCaller(UNIT_TOKEN, "pre-deploy:production"),
      DEPLOY_FILE
    );
    const check = await checkSkipJobsMigration(project);
    expect(clauseFor(check.detail, UNIT_TOKEN)).toBe(
      'test:unit → declare "test-correctness": ' +
        '{ "pre-deploy:production": "off" } and delete the token'
    );
  });
});

describe("it enumerates every job that reaches quality.yml", () => {
  it("counts a caller that passes no skip_jobs, which is the whole point", async () => {
    await writeCaller(directCaller(), CI_FILE);
    await writeCaller(releaseCaller(UNIT_TOKEN), DEPLOY_FILE);
    expect(await qualityCalls(project)).toEqual([
      { file: CI_PATH, moment: PULL_REQUEST },
      { file: DEPLOY_PATH, moment: PULL_REQUEST },
    ]);
  });

  it("does not count a reusable workflow that only forwards its caller's moment", async () => {
    // A project that vendors release.yml locally would otherwise be reported
    // as having an extra caller nobody triggers, on a moment doctor read out
    // of an expression.
    await writeCaller(directCaller(), CI_FILE);
    await writeCaller(
      [
        "name: Release",
        "on:",
        "  workflow_call:",
        "    inputs:",
        "      moment:",
        "        type: string",
        "        default: ''",
        JOBS_KEY,
        "  quality:",
        "    uses: ./.github/workflows/quality.yml",
        WITH_KEY,
        "      moment: ${{ inputs.moment || 'pull-request' }}",
        "",
      ].join("\n"),
      "release.yml"
    );
    expect((await qualityCalls(project)).map(call => call.file)).toEqual([
      CI_PATH,
    ]);
  });
});
