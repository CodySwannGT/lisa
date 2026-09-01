/**
 * Pins the neutral, opt-in mutation performance measurement workflow.
 *
 * This is deliberately not a quality gate. It can only be armed by a
 * maintainer-controlled label on an exact pull-request head (or dispatched
 * after it exists on main), has read-only permissions, and never runs on a
 * schedule. CodySwannGT/lisa#3304 needs comparable evidence before it chooses
 * an optimization; this file prevents the evidence collector from becoming an
 * optimization or a second verdict path by accident.
 * @module tests/unit/config/mutation-performance-baseline-wired
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW = ".github/workflows/mutation-performance-baseline.yml";
const REQUIRED_CHECKS = ".github/required-checks.json";

const read = (relative: string): string =>
  readFileSync(path.join(ROOT, relative), "utf8");

describe("the mutation performance baseline workflow", () => {
  const body = read(WORKFLOW);
  const workflow = parse(body) as Record<string, unknown>;

  it("is opt-in measurement, never a scheduled or ordinary required gate", () => {
    expect(body).toContain("on:\n  workflow_dispatch:");
    expect(body).toContain("pull_request:\n    types: [labeled]");
    for (const trigger of [
      "schedule",
      "push",
      "pull_request_target",
      "workflow_call",
    ]) {
      expect(body).not.toContain(`\n  ${trigger}:`);
    }
    expect(body).toContain("measure:mutation-baseline");
    expect(body).toContain("github.event.action == 'labeled'");
    expect(body).toContain("github.repository == 'CodySwannGT/lisa'");
    expect(read(REQUIRED_CHECKS)).not.toContain(
      "Mutation performance baseline"
    );
  });

  it("checks out and proves the exact frozen subject without credentials", () => {
    expect(body).toContain("github.event.pull_request.head.sha");
    expect(body).not.toContain("github.event.pull_request.merge_commit_sha");
    expect(body).toContain("persist-credentials: false");
    expect(body).toContain('[[ "$SUBJECT_SHA" =~ ^[0-9a-f]{40}$ ]]');
    expect(body).toContain('test "$(git rev-parse HEAD)" = "$SUBJECT_SHA"');
  });

  it("has read-only authority and no cache, secret, or privileged context", () => {
    expect(workflow["permissions"]).toEqual({ contents: "read" });
    for (const authority of [
      "actions/cache",
      "pull_request_target",
      "id-token:",
      "packages: write",
      "contents: write",
      "secrets.",
    ]) {
      expect(body).not.toContain(authority);
    }
    expect(
      body.split("\n").some(line => line.trimStart().startsWith("environment:"))
    ).toBe(false);
  });

  it("runs exactly three fresh Ubuntu draws for Vitest and Jest", () => {
    expect(body).toContain("stack: [vitest, jest]");
    expect(body).toContain("draw: [1, 2, 3]");
    expect(body).toContain("max-parallel: 2");
    expect(body).toContain("runs-on: ubuntu-latest");
    expect(body).toContain("timeout-minutes: 50");
    expect(body).toContain("timeout-minutes: 30");
    expect(body).toContain("timeout-minutes: 10");
    expect(body).toContain("340");
    expect(body).not.toMatch(/stack:.*rails/u);
  });

  it("uploads raw evidence on every terminal path and aggregates only after all cells", () => {
    expect(
      body.match(/if:\s*always\(\)/gu)?.length ?? 0
    ).toBeGreaterThanOrEqual(2);
    expect(body).toContain("actions/upload-artifact@");
    expect(body).toContain("run_attempt");
    expect(body).toContain("needs: [prepare, measure]");
    expect(body).toContain("measurement-only");
  });

  it("does not couple Stage 1 to the production mutation gate", () => {
    for (const production of [
      ".github/workflows/quality.yml",
      ".github/workflows/quality-rails.yml",
      "typescript/copy-overwrite/scripts/lisa-mutation.mjs",
    ]) {
      expect(body).not.toContain(production);
    }
    expect(body).not.toMatch(
      /--mutate|--testFiles|--concurrency|--threshold|actions\/cache/u
    );
  });
});
