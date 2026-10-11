/**
 * Stale Actions list snapshots must never masquerade as an old nightly failure.
 * The ordinary Node CLI makes outputs, summary and failure status observable.
 * @module tests/unit/scripts/nightly-e2e-health-discovery.test
 */
import { describe, expect, it } from "vitest";

import {
  discoveryRun,
  runDiscoveryCli,
} from "../../helpers/nightly-e2e-discovery-cli-harness.js";

const PASS_OUTPUT = "blocked=false";
const SCORED_FRESH = "scored run 101";
const STALE_LIST = "[list_stale]";
const DETAIL_FRESH = "GET /repos/o/r/actions/runs/101";

describe("nightly gate discovery HTTP boundary", () => {
  it("control: an unchanged fresh run passes the ordinary CLI", async () => {
    const fresh = discoveryRun(101);
    const result = await runDiscoveryCli({
      lists: [[fresh], []],
      details: { 101: fresh },
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain(PASS_OUTPUT);
    expect(result.summary).toContain(SCORED_FRESH);
    expect(result.requests).toContain(DETAIL_FRESH);
  });

  it("recovers the reported stale/stale/fresh discovery through a different query", async () => {
    const stale = discoveryRun(100, 240);
    const fresh = discoveryRun(101);
    const result = await runDiscoveryCli({
      lists: [[stale], [stale], [fresh]],
      details: { 100: stale, 101: fresh },
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain(PASS_OUTPUT);
    expect(result.summary).toContain(SCORED_FRESH);
    expect(result.requests).toContain(DETAIL_FRESH);
    expect(result.stderr).toContain("100@");
    expect(result.stderr).toContain("101@");
    expect(
      result.requests.some(
        request =>
          request.includes("per_page=100") &&
          !request.includes("status=") &&
          !request.includes("event=")
      )
    ).toBe(true);
  });

  it("keeps the fresh high-water discovery when the other event returns a stale snapshot", async () => {
    const fresh = discoveryRun(101);
    const stale = discoveryRun(100, 240);
    const result = await runDiscoveryCli({
      lists: [[fresh], [stale], [fresh]],
      details: { 100: stale, 101: fresh },
    });
    expect(result.code).toBe(0);
    expect(result.summary).toContain(SCORED_FRESH);
    expect(result.requests).not.toContain(
      "GET /repos/o/r/actions/runs/100/jobs?per_page=100&page=1&filter=latest"
    );
  });

  it("filters branch, workflow, completion and event in branchless alternate discovery", async () => {
    const stale = discoveryRun(100, 240);
    const fresh = discoveryRun(101);
    const foreign = [
      { ...discoveryRun(201), head_branch: "other" },
      { ...discoveryRun(202), path: ".github/workflows/other.yml" },
      { ...discoveryRun(203), status: "in_progress" },
      { ...discoveryRun(204), event: "pull_request" },
    ];
    const result = await runDiscoveryCli({
      lists: [[stale], [stale], [stale], [...foreign, fresh]],
      details: { 100: stale, 101: fresh },
    });
    expect(result.code).toBe(0);
    expect(result.summary).toContain(SCORED_FRESH);
    expect(result.requests).toContain(
      "GET /repos/o/r/actions/workflows/e2e.yml/runs?per_page=100"
    );
    expect(
      result.requests.some(request => /\/runs\/20[1-4]/u.test(request))
    ).toBe(false);
  });

  it("refuses persistent stale lists as a platform read, with no obsolete verdict or bypass advice", async () => {
    const stale = discoveryRun(100, 240);
    const result = await runDiscoveryCli({
      lists: [[stale]],
      details: { 100: stale },
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain("blocked=true");
    expect(result.output).toContain('"reason":"list_stale"');
    expect(result.summary).toContain(STALE_LIST);
    expect(result.summary).toContain("Re-run this check");
    expect(result.summary).not.toContain("stale_run");
    expect(result.summary).not.toContain("nightly-e2e-bypass");
    expect(result.summary).not.toContain("Fix the failure");
    expect(
      result.requests.filter(request =>
        request.includes("/workflows/e2e.yml/runs?")
      )
    ).toHaveLength(4);
    expect(result.requests.some(request => request.includes("/jobs"))).toBe(
      false
    );
  });

  it.each([
    { id: 999 },
    { head_branch: "other" },
    { event: "pull_request" },
    { status: "in_progress" },
    { workflow_id: 99 },
    { path: ".github/workflows/other.yml" },
    { created_at: "2020-01-01T00:00:00Z" },
    { head_sha: "b".repeat(40) },
  ])(
    "does not score a list claim whose direct read conflicts: %j",
    async override => {
      const fresh = discoveryRun(101);
      const result = await runDiscoveryCli({
        lists: [[fresh], []],
        details: { 101: { ...fresh, ...override } },
      });
      expect(result.code).toBe(1);
      expect(result.summary).toContain(STALE_LIST);
      expect(result.summary).toContain("missing or conflicting");
      expect(result.summary).not.toContain("nightly-e2e-bypass");
      expect(result.requests.some(request => request.includes("/jobs"))).toBe(
        false
      );
    }
  );

  it("does not ignore an unreadable direct read", async () => {
    const fresh = discoveryRun(101);
    const result = await runDiscoveryCli({
      lists: [[fresh], []],
      details: { 101: null },
    });
    expect(result.code).toBe(1);
    expect(result.summary).toContain(STALE_LIST);
    expect(result.requests.some(request => request.includes("/jobs"))).toBe(
      false
    );
  });

  it("refuses immutable identity disagreement for the same ID across snapshots", async () => {
    const fresh = discoveryRun(101);
    const result = await runDiscoveryCli({
      lists: [[fresh], [{ ...fresh, head_sha: "b".repeat(40) }]],
      details: { 101: { ...fresh, head_sha: "b".repeat(40) } },
    });
    expect(result.code).toBe(1);
    expect(result.summary).toContain(STALE_LIST);
    expect(result.summary).toContain("changed identity between list reads");
    expect(result.requests.some(request => request.includes("/jobs"))).toBe(
      false
    );
  });

  it("refuses malformed commit identity even when the list and detail agree", async () => {
    const fresh = { ...discoveryRun(101), head_sha: "not-a-commit" };
    const result = await runDiscoveryCli({
      lists: [[fresh], []],
      details: { 101: fresh },
    });
    expect(result.code).toBe(1);
    expect(result.summary).toContain(STALE_LIST);
  });

  it("keeps genuinely empty histories distinct from an observed stale list", async () => {
    const result = await runDiscoveryCli({ lists: [[]], details: {} });
    expect(result.code).toBe(1);
    expect(result.output).toContain('"reason":"no_run"');
    expect(result.summary).not.toContain(STALE_LIST);
  });

  it("accepts the vendor path's optional ref suffix", async () => {
    const fresh = {
      ...discoveryRun(101),
      path: ".github/workflows/e2e.yml@main",
    };
    const result = await runDiscoveryCli({
      lists: [[fresh], []],
      details: { 101: fresh },
    });
    expect(result.code).toBe(0);
  });

  it("preserves direct-read authority when a listed success actually failed", async () => {
    const fresh = discoveryRun(101);
    const result = await runDiscoveryCli({
      lists: [[fresh], []],
      details: { 101: { ...fresh, conclusion: "failure" } },
    });
    expect(result.code).toBe(1);
    expect(result.summary).toContain("scored run 101 (failure");
  });

  it("verifies both a zero-evidence cancellation and the older conclusive run", async () => {
    const cancelled = { ...discoveryRun(102, 0.5), conclusion: "cancelled" };
    const fresh = discoveryRun(101);
    const result = await runDiscoveryCli({
      lists: [[cancelled, fresh], []],
      details: { 101: fresh, 102: cancelled },
      jobs: { 102: [{ name: "preflight", conclusion: "cancelled" }] },
    });
    expect(result.code).toBe(0);
    expect(result.summary).toContain(SCORED_FRESH);
    expect(result.summary).toContain("skipped 102");
    expect(result.requests).toContain("GET /repos/o/r/actions/runs/102");
    expect(result.requests).toContain(DETAIL_FRESH);
  });

  it("keeps a substantive cancellation blocking instead of reaching for older green", async () => {
    const cancelled = { ...discoveryRun(102, 0.5), conclusion: "cancelled" };
    const fresh = discoveryRun(101);
    const result = await runDiscoveryCli({
      lists: [[cancelled, fresh], []],
      details: { 101: fresh, 102: cancelled },
      jobs: {
        102: [
          { name: "one", conclusion: "success" },
          { name: "two", conclusion: "cancelled" },
        ],
      },
    });
    expect(result.code).toBe(1);
    expect(result.summary).toContain("scored run 102");
    expect(result.requests).not.toContain(DETAIL_FRESH);
  });
});
