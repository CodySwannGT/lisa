/**
 * Every `actions/setup-node` step turns package-manager caching off
 * (CodySwannGT/lisa#4848).
 *
 * `actions/setup-node@v5+` reads `packageManager` and
 * `devEngines.packageManager` from package.json and turns on that manager's
 * dependency cache. The cache step fails when that manager's lockfile is
 * missing, for example an npm declaration on a bun host. These workflows are
 * called from host repositories using any package manager, so none of them
 * can let setup-node choose a cache from the manifest. Each one opts out
 * explicitly. The installs that need caching manage it themselves.
 * @module tests/unit/config/setup-node-package-manager-cache
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Directories whose workflows run in, or are copied into, host repos. */
const WORKFLOW_DIRS: readonly string[] = [
  ".github/workflows",
  ...readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => `${entry.name}/create-only/.github/workflows`)
    .filter(dir => existsSync(path.join(REPO_ROOT, dir))),
  ...["plugins", "plugins/src"].flatMap(root =>
    readdirSync(path.join(REPO_ROOT, root), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => `${root}/${entry.name}/ci`)
      .filter(dir => existsSync(path.join(REPO_ROOT, dir)))
  ),
];

/** One workflow step, as far as this file reads it. */
interface Step {
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
}

/**
 * Every setup-node step in a workflow file, labelled job/index.
 * @param file - Workflow path relative to the repository root
 * @returns Labelled setup-node steps
 */
function setupNodeSteps(file: string): readonly (readonly [string, Step])[] {
  const doc = parse(readFileSync(path.join(REPO_ROOT, file), "utf8")) as {
    readonly jobs?: Record<string, { readonly steps?: readonly Step[] }>;
  };
  return Object.entries(doc?.jobs ?? {}).flatMap(([job, body]) =>
    (body.steps ?? [])
      .map((step, index) => [`${file} ${job}[${index}]`, step] as const)
      .filter(([, step]) => step.uses?.startsWith("actions/setup-node@"))
  );
}

const STEPS = WORKFLOW_DIRS.flatMap(dir =>
  readdirSync(path.join(REPO_ROOT, dir))
    .filter(name => /\.ya?ml$/u.test(name))
    .flatMap(name => setupNodeSteps(`${dir}/${name}`))
);

describe("setup-node package-manager cache", () => {
  it("finds the setup-node steps it guards", () => {
    expect(STEPS.length).toBeGreaterThan(50);
  });

  it("turns package-manager caching off on every setup-node step", () => {
    const missing = STEPS.filter(
      ([, step]) => step.with?.["package-manager-cache"] !== false
    ).map(([label]) => label);
    expect(missing).toEqual([]);
  });
});
