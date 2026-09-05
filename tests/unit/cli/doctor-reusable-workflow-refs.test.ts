/**
 * Tests the doctor check that measures whether a repository is still calling
 * Lisa's reusable workflows at a mutable ref.
 *
 * This check asserted the opposite rule until CodySwannGT/lisa#3893 — `@main`
 * for ordinary callers, an immutable ref only for the two that are merge
 * gates — and the tests below are the inversion of the ones that encoded it.
 * The reason the rule flipped is not that mutability stopped being convenient:
 * it is that the pin is now maintained by the updater, so the failure that
 * made pinning unacceptable (a caller frozen a major behind, reporting
 * healthily, for months) can no longer happen. `expo/create-only` shipped both
 * nightly callers at `@v2.345.1` while every other caller tracked `@main`, and
 * by the time anyone noticed the pin was roughly a thousand releases behind
 * with nothing having reported anything.
 *
 * The check's job here is narrower than the pinner's: it does not care WHICH
 * commit, only that the ref cannot move. That is what makes "the rollout is
 * complete" a measurement instead of a claim.
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

/** The reusable used for ordinary cases. */
const QUALITY = "quality.yml";

/** A reusable that produces a required merge-gate context. */
const NIGHTLY_E2E_HEALTH = "nightly-e2e-health.yml";

/** A reusable that produces a required merge-gate context. */
const NIGHTLY_E2E_REPORT = "nightly-e2e-report.yml";

/** A full-length commit SHA, the only ref shape that passes. */
const SHA = "0123456789abcdef0123456789abcdef01234567";

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

describe("callers pinned at a full commit SHA", () => {
  it("passes when every caller names a 40-character SHA", async () => {
    await workflow("ci.yml", caller(QUALITY, SHA));
    await workflow("deploy.yml", caller("release.yml", SHA));
    const result = await checkReusableWorkflowRefs(target);
    expect(result.status).toBe("ok");
  });

  it("says how many files it scanned, so a green is not a measured zero", async () => {
    await workflow("ci.yml", caller(QUALITY, SHA));
    const result = await checkReusableWorkflowRefs(target);
    expect(result.detail).toContain("1 workflow file(s) scanned");
  });

  it("reports absence as absence, not as a passed audit", async () => {
    const result = await checkReusableWorkflowRefs(target);
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("No .github/workflows directory");
  });

  it("does not care WHICH commit — one release behind is not the defect", async () => {
    // A project a release behind self-heals on its next apply and, in the
    // meantime, runs a Lisa somebody reviewed. Reporting it here would bury the
    // repositories that never self-heal in the ones that always do.
    await workflow("ci.yml", caller(QUALITY, "f".repeat(40)));
    expect((await checkReusableWorkflowRefs(target)).status).toBe("ok");
  });
});

describe("the mutable refs it exists to find", () => {
  it("FAILS a caller tracking @main", async () => {
    await workflow("ci.yml", caller(QUALITY, "main"));
    const result = await checkReusableWorkflowRefs(target);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("@main");
  });

  it("FAILS a merge-gate caller pinned at a version tag", async () => {
    // The ratified exception this check used to carry: the two nightly callers
    // were allowed a tag because they back a required merge gate. A tag stopped
    // being acceptable when it stopped being the only alternative to `@main` —
    // this very caller sat at `@v2.345.1` for a thousand releases.
    await workflow(NIGHTLY_E2E_HEALTH, caller(NIGHTLY_E2E_HEALTH, "v2.345.1"));
    expect((await checkReusableWorkflowRefs(target)).status).toBe("fail");
  });

  it("FAILS a merge-gate caller tracking @main", async () => {
    await workflow(NIGHTLY_E2E_REPORT, caller(NIGHTLY_E2E_REPORT, "main"));
    expect((await checkReusableWorkflowRefs(target)).status).toBe("fail");
  });

  it("FAILS a SHORT SHA and says why, rather than accepting it as a SHA", async () => {
    // A short SHA is ambiguous by construction, and GitHub APIs have been
    // measured answering it with an empty result rather than an error — so a
    // check that accepted 7 hex characters would pass a ref nothing can resolve.
    await workflow("ci.yml", caller(QUALITY, "0123456"));
    const result = await checkReusableWorkflowRefs(target);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("SHORT commit SHA");
  });

  it("FAILS a 39-character SHA — the boundary, not just an obviously short one", async () => {
    await workflow("ci.yml", caller(QUALITY, "a".repeat(39)));
    expect((await checkReusableWorkflowRefs(target)).status).toBe("fail");
  });

  it("FAILS an uppercase SHA, which git will not resolve as written", async () => {
    await workflow("ci.yml", caller(QUALITY, "A".repeat(40)));
    expect((await checkReusableWorkflowRefs(target)).status).toBe("fail");
  });

  it("names every mutable caller, not just the first", async () => {
    await workflow("a.yml", caller(QUALITY, "v1.0.0"));
    await workflow("b.yml", caller("release.yml", "main"));
    const findings = await reusableRefFindings(target);
    expect(findings).toHaveLength(2);
    expect(
      findings
        .map((f: { ref: string }) => f.ref)
        .slice()
        .sort((a: string, b: string) => a.localeCompare(b))
    ).toEqual(["main", "v1.0.0"]);
  });
});

describe("what it deliberately leaves alone", () => {
  it("ignores third-party actions, which a different check pins", async () => {
    // doctor-readiness-action-pins owns step-level `uses:`. Flagging them here
    // would report the same defect twice with two different remedies.
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

  it("ignores a Lisa reference inside a YAML comment, and still sees the real one", async () => {
    await workflow(
      "ci.yml",
      "jobs:\n  quality:\n    # uses: CodySwannGT/lisa/.github/workflows/quality.yml@v1.2.3\n    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main\n"
    );
    const findings = await reusableRefFindings(target);
    expect(findings.map((f: { ref: string }) => f.ref)).toEqual(["main"]);
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

  it("reads a pinned caller carrying its version comment", async () => {
    await workflow(
      "ci.yml",
      `jobs:\n  a:\n    uses: CodySwannGT/lisa/.github/workflows/quality.yml@${SHA} # v4.4.11\n`
    );
    expect((await checkReusableWorkflowRefs(target)).status).toBe("ok");
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
