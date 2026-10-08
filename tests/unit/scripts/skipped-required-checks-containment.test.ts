/** Verify that declaration and workflow reads stay inside the real repository. */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectSkipJobTokens,
  loadDeclaration,
} from "../../../typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

const leases: string[] = [];
const workflow = ".github/workflows/ci.yml";
const declaration = ".github/required-checks.json";
const contents = "skip_jobs: lint\n";
const config = {
  required_contexts: [],
  workflows: [workflow],
  skip_job_declarations: {},
};

/** An owned root and sibling, including the misleading common path prefix. */
function fixture() {
  const lease = mkdtempSync(join(tmpdir(), "skipreq-containment-"));
  const root = join(lease, "repo");
  const outside = join(lease, "repo-outside");
  leases.push(lease);
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(outside);
  return { lease, root, outside };
}

afterEach(() => {
  for (const lease of leases.splice(0))
    rmSync(lease, { recursive: true, force: true });
});

describe("real repository containment for required-check inputs", () => {
  it("refuses a workflow symlink to a sibling with the same path prefix", () => {
    const { root, outside } = fixture();
    const foreign = join(outside, "ci.yml");
    writeFileSync(foreign, "skip_jobs: 'outside,lint'\n");
    symlinkSync(foreign, join(root, workflow));
    expect(() => collectSkipJobTokens(root, [workflow])).toThrow(
      /outside the repository root/
    );
  });

  it("refuses a declaration symlink outside the repository", () => {
    const { root, outside } = fixture();
    const foreign = join(outside, "required-checks.json");
    writeFileSync(foreign, JSON.stringify(config));
    symlinkSync(foreign, join(root, declaration));
    expect(() => loadDeclaration(root)).toThrow(/outside the repository root/);
  });

  it("refuses reads through a linked parent directory", () => {
    const { root, outside } = fixture();
    writeFileSync(join(outside, "ci.yml"), contents);
    symlinkSync(outside, join(root, "linked"), "dir");
    expect(() => collectSkipJobTokens(root, ["linked/ci.yml"])).toThrow(
      /outside the repository root/
    );
  });

  it("retains the lexical traversal refusal before checking existence", () => {
    const { root } = fixture();
    expect(() => collectSkipJobTokens(root, ["../missing.yml"])).toThrow(
      /outside the repository root/
    );
  });

  it("accepts a workflow symlink whose resolved target remains inside", () => {
    const { root } = fixture();
    writeFileSync(join(root, "actual.yml"), contents);
    symlinkSync("../../actual.yml", join(root, workflow));
    expect(collectSkipJobTokens(root, [workflow]).tokens).toEqual(["lint"]);
  });

  it("accepts a declaration symlink whose target remains inside", () => {
    const { root } = fixture();
    writeFileSync(join(root, "actual.json"), JSON.stringify(config));
    symlinkSync("../actual.json", join(root, declaration));
    expect(loadDeclaration(root)).toEqual(config);
  });

  it("normalizes a root symlink before comparing its contained inputs", () => {
    const { root, lease } = fixture();
    const alias = join(lease, "root-alias");
    writeFileSync(join(root, workflow), contents);
    writeFileSync(join(root, declaration), JSON.stringify(config));
    symlinkSync(root, alias, "dir");
    expect(collectSkipJobTokens(alias, [workflow]).tokens).toEqual(["lint"]);
    expect(loadDeclaration(alias)).toEqual(config);
  });

  it("keeps missing and dangling input refusals explicit", () => {
    const { root, outside } = fixture();
    symlinkSync(join(outside, "missing.yml"), join(root, workflow));
    expect(() => collectSkipJobTokens(root, [workflow])).toThrow(
      /does not exist/
    );
    expect(() => loadDeclaration(root)).toThrow(/does not exist/);
  });
});
