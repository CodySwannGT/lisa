/**
 * `lisa controls reconcile`, direction one: every enforcement point the
 * register claims, checked against what is installed (CodySwannGT/lisa#5000).
 *
 * The register is a record of intent. These cases take a repository whose
 * carriers were installed by the real installer, break the installation the
 * ways it breaks in practice (a hook script deleted, the runner deleted, a
 * new clone that was never wired, a pipeline file removed) and hold the
 * command to naming the register entry that is no longer enforced. Git is
 * real; nothing here starts a declared check.
 * @module tests/integration/controls-reconcile-points
 */
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXECUTOR_INVOCATION } from "../../src/controls/reconcile-executor.js";
import type { ReconciledPoint } from "../../src/controls/reconcile-types.js";
import { installCarriers } from "../support/carrier-install.js";
import {
  cloneOf,
  declaredRepository,
  evidencedPart,
  LINT,
  LINT_ENTRY,
  missingPoints,
  reconcile,
  RECONCILE_GATES,
  type ReconcileCommandRun,
  resultOf,
  TESTS_ENTRY,
  wiredRepository,
} from "../support/reconcile-run.js";

const COMMIT_SCRIPT = ".lisa/hooks/pre-commit";
const RUNNER = "scripts/lisa-run-gates.mjs";
const PIPELINE = ".gitlab-ci.yml";
const NOT_WIRED = "not-wired";

/** A linter checked at commit and on a pull request, from a host pipeline. */
const PIPELINE_GATES = {
  "code-style": {
    commit: "required",
    "pull-request": {
      executor: { path: PIPELINE, platform: "gitlab" },
      level: "required",
    },
    criteria: ["SI7"],
    parts: [evidencedPart(LINT)],
  },
};

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build a fully wired repository, removed when the case ends.
 * @param gates - The `gates` block
 * @returns The repository's root
 */
async function wired(gates = RECONCILE_GATES): Promise<string> {
  const repository = await wiredRepository(gates);
  cleanups.push(repository.cleanup);
  return repository.fixture.repoPath;
}

/**
 * The state of each enforcement point of a run, by entry and moment.
 * @param run - The finished run
 * @returns For example `{ "code-style@. commit": "wired" }`
 */
function states(run: ReconcileCommandRun): Record<string, string> {
  return Object.fromEntries(
    resultOf(run).enforcement_points.map((point: ReconciledPoint) => [
      `${point.entry_id} ${point.moment}`,
      point.state,
    ])
  );
}

describe("reconcile on a fully wired repository", () => {
  it("finds nothing in either direction", async () => {
    const run = await reconcile(await wired());

    expect(run.code).toBe(0);
    expect(resultOf(run)).toMatchObject({
      audit_findings: [],
      findings: [],
      hook_commands: [],
      hook_owner: "lisa",
      outcome: "in-step",
    });
    expect(states(run)).toEqual({
      [`${LINT_ENTRY} commit`]: "wired",
      [`${TESTS_ENTRY} push`]: "wired",
    });
    expect(run.said[0]).toMatch(
      /^reconcile: PASS\. The register and what is installed are in step: 2 of 2 enforcement points were confirmed/u
    );
  });
});

describe("reconcile when an enforcement point no longer exists", () => {
  it("names the entry whose carrier file was deleted", async () => {
    const root = await wired();
    rmSync(path.join(root, COMMIT_SCRIPT));

    const run = await reconcile(root);

    expect(run.code).toBe(0);
    expect(missingPoints(run)).toEqual([
      expect.objectContaining({
        criteria: ["SI7"],
        entry_id: LINT_ENTRY,
        location: "local-checkout",
        moment: "commit",
      }),
    ]);
    expect(missingPoints(run)[0]?.message).toBe(
      `The register says "code-style" is checked at commit, but nothing in this checkout runs it (register entry ${LINT_ENTRY}). ${COMMIT_SCRIPT} is missing, so the pre-commit hook cannot start the gate runner at commit.`
    );
    expect(states(run)[`${TESTS_ENTRY} push`]).toBe("wired");
    expect(run.said[0]).toMatch(/^reconcile: FINDINGS\. /u);
    expect(run.said[1]).toContain(`register entry ${LINT_ENTRY}`);
  });

  it("names every entry when the runner itself was deleted", async () => {
    const root = await wired();
    rmSync(path.join(root, RUNNER));

    const run = await reconcile(root);

    expect(missingPoints(run).map(finding => finding.entry_id)).toEqual([
      LINT_ENTRY,
      TESTS_ENTRY,
    ]);
    expect(missingPoints(run)[0]?.message).toContain(`${RUNNER} is missing`);
  });

  it("names every entry in a new clone that was never wired", async () => {
    const clone = cloneOf(await wired());
    cleanups.push(clone.cleanup);

    const run = await reconcile(clone.root);

    expect(run.code).toBe(0);
    expect(resultOf(run).hook_owner).toBe("none");
    expect(missingPoints(run).map(finding => finding.entry_id)).toEqual([
      LINT_ENTRY,
      TESTS_ENTRY,
    ]);
    expect(missingPoints(run)[0]?.message).toContain(
      "core.hooksPath is not set"
    );
    expect(missingPoints(run)[0]?.next).toContain(
      'Run "lisa controls install-carriers" in this checkout.'
    );
  });

  it("stops reporting the clone once the carriers are installed in it", async () => {
    const clone = cloneOf(await wired());
    cleanups.push(clone.cleanup);
    await installCarriers(clone.root);

    expect(resultOf(await reconcile(clone.root)).findings).toEqual([]);
  });

  it("names every entry where nothing was ever installed", async () => {
    const repository = declaredRepository();
    cleanups.push(repository.cleanup);

    const run = await reconcile(repository.fixture.repoPath);

    expect(states(run)).toEqual({
      [`${LINT_ENTRY} commit`]: NOT_WIRED,
      [`${TESTS_ENTRY} push`]: NOT_WIRED,
    });
  });
});

describe("reconcile on a pull-request pipeline the host wrote", () => {
  it("names the entry when the pipeline file is missing", async () => {
    const run = await reconcile(await wired(PIPELINE_GATES));

    expect(missingPoints(run)).toEqual([
      expect.objectContaining({
        entry_id: LINT_ENTRY,
        location: "hosting-platform",
        moment: "pull-request",
      }),
    ]);
    expect(missingPoints(run)[0]?.message).toBe(
      `The register says "code-style" is checked on a pull request, but nothing was found that enforces it there (register entry ${LINT_ENTRY}). ${PIPELINE}, the file the register names as running the checks on a pull request, is not in this checkout.`
    );
    expect(missingPoints(run)[0]?.next).toContain(`Put ${PIPELINE} back`);
  });

  it("names the entry when the file does not run the gate runner", async () => {
    const root = await wired(PIPELINE_GATES);
    writeFileSync(
      path.join(root, PIPELINE),
      `lint:\n  script:\n    # ${EXECUTOR_INVOCATION}\n    - ruff check .\n`
    );

    const run = await reconcile(root);

    expect(states(run)[`${LINT_ENTRY} pull-request`]).toBe(NOT_WIRED);
    expect(missingPoints(run)[0]?.message).toContain(
      `none of its lines runs "${EXECUTOR_INVOCATION}"`
    );
  });

  it("accepts the file that runs it, and says what that does not prove", async () => {
    const root = await wired(PIPELINE_GATES);
    writeFileSync(
      path.join(root, PIPELINE),
      `gates:\n  script:\n    - ${EXECUTOR_INVOCATION}\n`
    );

    const run = await reconcile(root);
    const point = resultOf(run).enforcement_points.find(
      each => each.moment === "pull-request"
    );

    expect(missingPoints(run)).toEqual([]);
    expect(point).toMatchObject({ checked: PIPELINE, state: "wired" });
    expect(point?.reason).toContain(
      "it does not show that GitLab runs the pipeline or requires it before a merge"
    );
  });
});

describe("reconcile on a place it cannot look", () => {
  it("says a deployment pipeline is not verifiable, and reports no finding", async () => {
    const root = await wired({
      "code-style": {
        commit: "required",
        "pre-deploy:production": "required",
        parts: [evidencedPart(LINT)],
      },
    });

    const run = await reconcile(root);

    expect(resultOf(run).findings).toEqual([]);
    expect(states(run)).toEqual({
      [`${LINT_ENTRY} commit`]: "wired",
      [`${LINT_ENTRY} pre-deploy:production`]: "not-verifiable",
    });
    expect(run.said[0]).toContain(
      "1 of 2 enforcement points was confirmed, 1 could not be checked by this run"
    );
  });
});
