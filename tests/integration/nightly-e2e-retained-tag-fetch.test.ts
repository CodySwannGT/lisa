/**
 * @file nightly-e2e-retained-tag-fetch.test.ts
 * @description Runtime contract for scoped exact-ref certificate inputs
 * @module tests/integration/nightly-e2e-retained-tag-fetch
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import yaml from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";

import { RETAINED_RELEASES } from "../../scripts/generate-nightly-e2e-guard-certificate.mjs";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../helpers/io-latency-budget.js";

const QUALITY = path.join(process.cwd(), ".github", "workflows", "quality.yml");
const FETCH_STEP_NAME = "📎 Fetch retained nightly guard release tags";
const LISA_REPOSITORY = "CodySwannGT/lisa";
const SCRATCH: string[] = [];

/** Minimal parsed workflow step used by the execution fixture. */
interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
}

/** Minimal parsed workflow shape used by the execution fixture. */
interface Workflow {
  readonly jobs: Readonly<
    Record<string, { readonly steps?: readonly WorkflowStep[] }>
  >;
}

const workflow = yaml.load(fs.readFileSync(QUALITY, "utf8")) as Workflow;
const FETCH = workflow.jobs.test_unit?.steps?.find(
  step => step.name === FETCH_STEP_NAME
)?.run;

if (!FETCH) throw new Error("retained nightly guard tag fetch step not found");

afterAll(() => {
  for (const directory of SCRATCH) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Run git with the repository's bounded subprocess contract.
 * @param cwd - Fixture repository receiving the command
 * @param args - Exact git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, args: readonly string[]): string {
  return boundedExecFileSync({
    label: `retained-tag fixture git ${args[0] ?? "command"}`,
    command: "/usr/bin/git",
    args,
    cwd,
  }).trim();
}

/**
 * Create a depth-one Lisa-shaped checkout whose remote alone has retained tags.
 * @returns Tag-empty shallow checkout path
 */
function shallowLisaCheckout(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-retained-tags-"));
  const origin = path.join(root, "origin");
  const checkout = path.join(root, "checkout");
  SCRATCH.push(root);
  fs.mkdirSync(origin);
  git(origin, ["init", "--initial-branch=main"]);
  git(origin, ["config", "user.email", "fixture@example.invalid"]);
  git(origin, ["config", "user.name", "Fixture"]);
  fs.mkdirSync(path.join(origin, "scripts"));
  fs.writeFileSync(
    path.join(origin, "scripts", "generate-nightly-e2e-guard-certificate.mjs"),
    "export const RETAINED_RELEASES = [];\n"
  );
  fs.writeFileSync(path.join(origin, "marker"), "old\n");
  git(origin, ["add", "."]);
  git(origin, ["commit", "-m", "fixture base"]);
  RETAINED_RELEASES.forEach((ref, index) => {
    fs.writeFileSync(path.join(origin, "marker"), `${ref}\n`);
    git(origin, ["add", "marker"]);
    git(origin, ["commit", "-m", `fixture tag ${index}`]);
    git(origin, ["tag", ref]);
  });
  fs.writeFileSync(path.join(origin, "marker"), "head\n");
  git(origin, ["add", "marker"]);
  git(origin, ["commit", "-m", "fixture head"]);
  git(root, ["clone", "--depth=1", "--no-tags", `file://${origin}`, checkout]);
  expect(git(checkout, ["tag", "--list"])).toBe("");
  return checkout;
}

describe("retained nightly guard release tag fetch", () => {
  it("fetches every exact retained ref into a tag-empty shallow Lisa checkout", () => {
    const checkout = shallowLisaCheckout();
    const result = boundedSpawnSync({
      label: "retained tag fetch from shallow Lisa checkout",
      command: "/bin/bash",
      args: ["-euo", "pipefail", "-c", FETCH],
      cwd: checkout,
      env: {
        ...process.env,
        GH_TOKEN: "fixture-token",
        GITHUB_REPOSITORY: LISA_REPOSITORY,
      },
    });
    expect(result.status, `${result.stdout ?? ""}${result.stderr ?? ""}`).toBe(
      0
    );
    expect(new Set(git(checkout, ["tag", "--list"]).split("\n"))).toEqual(
      new Set(RETAINED_RELEASES)
    );
  });

  it("does not fetch or fail in a private-style non-Lisa caller", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-caller-tags-"));
    const bin = path.join(root, "bin");
    const marker = path.join(root, "git-invoked");
    SCRATCH.push(root);
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(root, "scripts"));
    fs.writeFileSync(
      path.join(root, "scripts", "generate-nightly-e2e-guard-certificate.mjs"),
      "export const RETAINED_RELEASES = [];\n"
    );
    fs.writeFileSync(
      path.join(bin, "git"),
      `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nexit 97\n`,
      { mode: 0o755 }
    );

    const result = boundedSpawnSync({
      label: "retained tag no-op in private-style caller",
      command: "/bin/bash",
      args: ["-euo", "pipefail", "-c", FETCH],
      cwd: root,
      env: {
        ...process.env,
        GH_TOKEN: "",
        GITHUB_REPOSITORY: "example/private-caller",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
    });
    expect(result.status, `${result.stdout ?? ""}${result.stderr ?? ""}`).toBe(
      0
    );
    expect(fs.existsSync(marker)).toBe(false);
    expect(FETCH).not.toContain("refs/tags/*");
  });
});
