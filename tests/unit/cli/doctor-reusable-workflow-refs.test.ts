/**
 * Tests the doctor check that keeps callers of Lisa's reusable workflows on the
 * ref their role requires — `@main` for almost all, an immutable pin for the two
 * that are merge gates.
 *
 * The bite control is not synthetic: `expo/create-only` shipped
 * `nightly-e2e-health.yml` and `nightly-e2e-report.yml` at `@v2.345.1` while
 * every other caller in every stack tracked `@main`. By the time it was noticed
 * the pin was roughly a thousand releases behind, and nothing had reported
 * anything — which is the whole reason a check has to exist rather than a
 * convention.
 * @module tests/unit/cli/doctor-reusable-workflow-refs
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkReusableWorkflowRefs,
  reusableRefFindings,
} from "../../../src/cli/doctor-reusable-workflow-refs.js";

let target: string;

/** The reusable used for ordinary (non merge-gate) cases. */
const QUALITY = "quality.yml";

/** Merge-gate reusable checked with immutable refs. */
const NIGHTLY_E2E_HEALTH = "nightly-e2e-health.yml";

/** Merge-gate reusable checked with immutable refs. */
const NIGHTLY_E2E_REPORT = "nightly-e2e-report.yml";

/**
 * Write a workflow file into the fixture project.
 * @param name - File name under .github/workflows
 * @param body - File contents
 */
async function workflow(name: string, body: string): Promise<void> {
  const dir = path.join(target, ".github", "workflows");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), body, "utf8");
}

/**
 * A workflow whose job calls a Lisa reusable at a given ref.
 * @param file - Reusable workflow file name
 * @param ref - The ref the caller points at
 * @returns Workflow YAML
 */
const caller = (file: string, ref: string): string =>
  `name: CI\non:\n  pull_request:\njobs:\n  quality:\n    uses: CodySwannGT/lisa/.github/workflows/${file}@${ref}\n`;

beforeEach(async () => {
  target = await mkdtemp(path.join(tmpdir(), "lisa-refs-"));
});

afterEach(async () => {
  await rm(target, { recursive: true, force: true });
});

describe("callers tracking @main", () => {
  it("passes when every caller tracks main", async () => {
    await workflow("ci.yml", caller(QUALITY, "main"));
    await workflow("deploy.yml", caller("release.yml", "main"));
    const result = await checkReusableWorkflowRefs(target);
    expect(result.status).toBe("ok");
  });

  it("says how many files it scanned, so a green is not a measured zero", async () => {
    await workflow("ci.yml", caller(QUALITY, "main"));
    const result = await checkReusableWorkflowRefs(target);
    expect(result.detail).toContain("1 workflow file(s) scanned");
  });

  it("reports absence as absence, not as a passed audit", async () => {
    const result = await checkReusableWorkflowRefs(target);
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("No .github/workflows directory");
  });
});

describe("the pin that actually shipped", () => {
  it("ACCEPTS the expo pin, because that caller is a merge gate", async () => {
    // My first draft failed this and I unpinned the templates to make it pass,
    // deleting a deliberate guarantee. Two integration tests caught it:
    // nightly-e2e-health produces a REQUIRED merge-gate context, and the thing
    // deciding whether code may merge must not change between two runs of the
    // same pull request. `@main` is the defect there, not the pin.
    await workflow(NIGHTLY_E2E_HEALTH, caller(NIGHTLY_E2E_HEALTH, "v2.345.1"));
    expect((await checkReusableWorkflowRefs(target)).status).toBe("ok");
  });

  it("accepts a full commit SHA for a merge-gate caller", async () => {
    await workflow(
      NIGHTLY_E2E_HEALTH,
      caller(NIGHTLY_E2E_HEALTH, "a".repeat(40))
    );
    expect((await checkReusableWorkflowRefs(target)).status).toBe("ok");
  });

  it("FAILS a merge-gate caller that tracks @main", async () => {
    await workflow(NIGHTLY_E2E_REPORT, caller(NIGHTLY_E2E_REPORT, "main"));
    const result = await checkReusableWorkflowRefs(target);
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/merge-gate/i);
  });

  it("fails a SHA pin too, not only a tag", async () => {
    await workflow("ci.yml", caller(QUALITY, "a".repeat(40)));
    expect((await checkReusableWorkflowRefs(target)).status).toBe("fail");
  });

  it("names every pinned caller, not just the first", async () => {
    await workflow("a.yml", caller(QUALITY, "v1.0.0"));
    await workflow("b.yml", caller("release.yml", "v2.0.0"));
    const pinned = await reusableRefFindings(target);
    expect(pinned).toHaveLength(2);
    expect(
      pinned
        .map((f: { ref: string }) => f.ref)
        .slice()
        .sort((a: string, b: string) => a.localeCompare(b))
    ).toEqual(["v1.0.0", "v2.0.0"]);
  });
});

describe("what it deliberately leaves alone", () => {
  it("ignores third-party actions, which SHOULD be pinned", async () => {
    // The opposite rule applies to them, enforced by
    // doctor-readiness-action-pins. Flagging them here would put doctor in
    // contradiction with itself.
    await workflow(
      "ci.yml",
      "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v6\n"
    );
    expect((await checkReusableWorkflowRefs(target)).status).toBe("ok");
  });

  it("ignores another organisation's reusable workflows", async () => {
    await workflow(
      "ci.yml",
      "jobs:\n  a:\n    uses: someone/else/.github/workflows/quality.yml@v1\n"
    );
    expect((await checkReusableWorkflowRefs(target)).status).toBe("ok");
  });

  it("ignores a project's own local reusables", async () => {
    await workflow(
      "ci.yml",
      "jobs:\n  a:\n    uses: ./.github/workflows/x.yml\n"
    );
    expect((await checkReusableWorkflowRefs(target)).status).toBe("ok");
  });

  it("ignores Lisa workflow references in YAML comments", async () => {
    await workflow(
      "ci.yml",
      "jobs:\n  quality:\n    # uses: CodySwannGT/lisa/.github/workflows/quality.yml@v1.2.3\n    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main\n"
    );
    expect((await checkReusableWorkflowRefs(target)).status).toBe("ok");
  });
});

describe("it survives the files it will actually meet", () => {
  it("reads a quoted uses value", async () => {
    await workflow(
      "ci.yml",
      'jobs:\n  a:\n    uses: "CodySwannGT/lisa/.github/workflows/quality.yml@v1.2.3"\n'
    );
    expect((await checkReusableWorkflowRefs(target)).status).toBe("fail");
  });

  it("still audits a file whose YAML is malformed", async () => {
    // A text scan rather than a parse, deliberately: a caller with broken YAML
    // runs nothing and still needs reporting, and a parse failure would drop
    // the file from the audit — reporting a clean project because it could not
    // read one.
    await workflow(
      "broken.yml",
      "jobs: [\n  uses: CodySwannGT/lisa/.github/workflows/quality.yml@v9\n"
    );
    expect((await checkReusableWorkflowRefs(target)).status).toBe("fail");
  });
});
