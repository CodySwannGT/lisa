import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LISA_MANAGED_MARKER,
  LISA_SEEDED_MARKER,
  classifyWorkflowForDeletion,
  describeRefusal,
  isWorkflowDeletionPath,
} from "../../../src/core/workflow-deletion-ownership.js";

/** The header a `create-only` template carries, exactly as shipped. */
const SEEDED_HEADER = [
  "# Seeded by Lisa on first setup — this file is YOURS.",
  "# Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)",
].join("\n");

/** The header a `copy-overwrite` template carries, exactly as shipped. */
const MANAGED_HEADER = [
  "# This file is managed by Lisa and IS replaced on each `lisa` run.",
  "# Do not edit directly — durable changes belong upstream in Lisa.",
].join("\n");

/**
 * The `copy-overwrite` header Lisa shipped before the wording was revised.
 *
 * A consumer that has not upgraded in a long time is holding THIS text, and it
 * is exactly the population the guard must still classify correctly — the
 * retired workflows a manifest wants to clean up are old by definition.
 */
const RETIRED_MANAGED_HEADER = [
  "# This file is managed by Lisa.",
  "# Do not edit directly — changes will be overwritten on the next `lisa` run.",
].join("\n");

/** The verdict that keeps a file Lisa cannot account for. */
const UNATTRIBUTABLE = { kind: "unattributable" } as const;

/** The verdict that keeps a file Lisa seeded and disclaimed. */
const HOST_OWNED_SEED = { kind: "host-owned-seed" } as const;

/** The verdict that lets Lisa retire one of its own managed files. */
const LISA_MANAGED = { kind: "lisa-managed" } as const;

/** Strategy directory whose templates Lisa hands to the consumer. */
const CREATE_ONLY = "create-only";

/** Strategy directory whose templates Lisa replaces on every run. */
const COPY_OVERWRITE = "copy-overwrite";

/** A workflow body with no Lisa provenance anywhere. */
const HOST_BODY = [
  "name: Auto-update PR branches",
  "on:",
  "  push:",
  "    branches: [main]",
  "jobs:",
  "  update:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: echo update",
  "",
].join("\n");

describe("isWorkflowDeletionPath", () => {
  it("gates paths inside .github/workflows", () => {
    expect(isWorkflowDeletionPath(".github/workflows/ci.yml")).toBe(true);
  });

  it("gates the same path spelled with a leading ./", () => {
    expect(isWorkflowDeletionPath("./.github/workflows/ci.yml")).toBe(true);
  });

  it("gates the same path spelled with platform separators", () => {
    expect(
      isWorkflowDeletionPath(path.join(".github", "workflows", "ci.yml"))
    ).toBe(true);
  });

  it("leaves paths outside the workflows tree ungated", () => {
    // 213 of the 255 declared deletion paths are outside this tree and keep
    // their existing behaviour. Narrowing the gate is the deliberate scope of
    // CodySwannGT/lisa#3656, not an oversight.
    expect(isWorkflowDeletionPath("jest.config.ts")).toBe(false);
    expect(isWorkflowDeletionPath(".claude/skills/jira-create")).toBe(false);
  });

  it("does not gate the workflows directory itself", () => {
    expect(isWorkflowDeletionPath(".github/workflows")).toBe(false);
  });

  it("does not gate a path that merely starts with the same characters", () => {
    expect(isWorkflowDeletionPath(".github/workflows-archive/ci.yml")).toBe(
      false
    );
  });
});

describe("classifyWorkflowForDeletion", () => {
  it("refuses a host-authored workflow carrying no Lisa header", () => {
    // The exact shape of the three files lost in CodySwannGT/lisa#3656 had
    // this been a file the consumer wrote from scratch.
    expect(classifyWorkflowForDeletion(HOST_BODY)).toEqual(UNATTRIBUTABLE);
  });

  it("refuses a workflow Lisa seeded and disclaimed", () => {
    // The create-only header is a PROMISE not to touch the file. All three
    // workflows lost in #3656 carried it.
    expect(
      classifyWorkflowForDeletion(`${SEEDED_HEADER}\n\n${HOST_BODY}`)
    ).toEqual(HOST_OWNED_SEED);
  });

  it("allows a workflow whose header says Lisa replaces it wholesale", () => {
    expect(
      classifyWorkflowForDeletion(`${MANAGED_HEADER}\n\n${HOST_BODY}`)
    ).toEqual(LISA_MANAGED);
  });

  it("allows one still carrying the retired copy-overwrite wording", () => {
    expect(
      classifyWorkflowForDeletion(`${RETIRED_MANAGED_HEADER}\n\n${HOST_BODY}`)
    ).toEqual(LISA_MANAGED);
  });

  it("reads the seed contract even when a document marker precedes it", () => {
    // all/create-only/.github/workflows/continuous-gates.yml opens with `---`.
    expect(
      classifyWorkflowForDeletion(`---\n${SEEDED_HEADER}\n\n${HOST_BODY}`)
    ).toEqual(HOST_OWNED_SEED);
  });

  it("keeps a seeded file even when the managed phrase also appears", () => {
    // Seed-before-managed is load-bearing: the create-only header's own second
    // line talks about copy-overwrite assets, and a managed-first check would
    // read every seeded workflow as Lisa's and delete the #3656 files again.
    expect(
      classifyWorkflowForDeletion(
        `${SEEDED_HEADER}\n${MANAGED_HEADER}\n\n${HOST_BODY}`
      )
    ).toEqual(HOST_OWNED_SEED);
  });

  it("ignores a Lisa mention buried in the workflow body", () => {
    // A step named after a Lisa command must not authorise deleting the file
    // it appears in — that is the false-negative direction that reintroduces
    // the defect.
    const body = [
      "name: Nightly",
      "on:",
      "  schedule:",
      "    - cron: '0 3 * * *'",
      "jobs:",
      "  run:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: this file is managed by Lisa somewhere far below",
      "        run: echo hi",
      "",
    ].join("\n");
    expect(classifyWorkflowForDeletion(body)).toEqual(UNATTRIBUTABLE);
  });

  it("classifies an empty file as unattributable", () => {
    expect(classifyWorkflowForDeletion("")).toEqual(UNATTRIBUTABLE);
  });
});

describe("describeRefusal", () => {
  it("names the seed contract when the file was seeded", () => {
    expect(describeRefusal(HOST_OWNED_SEED)).toContain("yours");
  });

  it("says Lisa has no proof when there is no header at all", () => {
    expect(describeRefusal(UNATTRIBUTABLE)).toContain("cannot prove");
  });
});

/**
 * The workflow templates in one lane/strategy tree.
 * @param root - Repository root
 * @param tree - Lane and copy strategy to read
 * @param tree.lane - Project-type lane directory
 * @param tree.strategy - Copy strategy directory
 * @returns Repo-relative path, strategy, and contents for each workflow there
 */
async function workflowsIn(
  root: string,
  tree: { lane: string; strategy: string }
): Promise<{ relativePath: string; strategy: string; contents: string }[]> {
  const dir = path.join(root, tree.lane, tree.strategy, ".github", "workflows");
  let names: string[];
  try {
    names = (await readdir(dir)).filter(name => /\.ya?ml$/u.test(name));
  } catch {
    return [];
  }
  return Promise.all(
    names.map(async name => ({
      relativePath: path.join(tree.lane, tree.strategy, name),
      strategy: tree.strategy,
      contents: await readFile(path.join(dir, name), "utf8"),
    }))
  );
}

/**
 * Every workflow template Lisa actually ships, with its lane's strategy.
 * @returns Repo-relative path, strategy, and contents for each shipped workflow
 */
async function shippedWorkflows(): Promise<
  { relativePath: string; strategy: string; contents: string }[]
> {
  const root = process.cwd();
  const lanes = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  const trees = lanes.flatMap(lane =>
    [CREATE_ONLY, COPY_OVERWRITE].map(strategy => ({ lane, strategy }))
  );
  const collected = await Promise.all(
    trees.map(tree => workflowsIn(root, tree))
  );
  return collected.flat();
}

describe("the markers against the workflows Lisa actually ships", () => {
  // The markers are substrings of headers enforced elsewhere
  // (tests/unit/templates/template-ownership-header.test.ts). This is the
  // cross-check that the guard reads the same headers that test writes: if the
  // wording is ever revised without updating the guard, deletion policy would
  // silently flip for every shipped workflow and nothing else would notice.

  it("finds at least one shipped workflow in each lane strategy", async () => {
    const shipped = await shippedWorkflows();
    expect(shipped.some(w => w.strategy === CREATE_ONLY)).toBe(true);
    expect(shipped.some(w => w.strategy === COPY_OVERWRITE)).toBe(true);
  });

  it("classifies every shipped workflow according to its lane", async () => {
    const misclassified = (await shippedWorkflows()).filter(workflow => {
      const expected =
        workflow.strategy === "create-only"
          ? "host-owned-seed"
          : "lisa-managed";
      return classifyWorkflowForDeletion(workflow.contents).kind !== expected;
    });

    expect(misclassified.map(w => w.relativePath)).toEqual([]);
  });

  it("keeps the two markers distinguishable", () => {
    expect(SEEDED_HEADER).toContain(LISA_SEEDED_MARKER);
    expect(SEEDED_HEADER).not.toContain(LISA_MANAGED_MARKER);
    expect(MANAGED_HEADER).toContain(LISA_MANAGED_MARKER);
    expect(MANAGED_HEADER).not.toContain(LISA_SEEDED_MARKER);
  });
});
