/**
 * CDK app treatment requires a CDK app, on every surface that decides it.
 *
 * CodySwannGT/lisa#3533: four independent places implemented "is this CDK?" as
 * `cdk.json OR a dependency starting aws-cdk`, and the second arm answers a
 * different question. A repository consuming `aws-cdk-lib` to build constructs
 * was admitted to the CDK application preset, which force-merges a `bin` entry
 * pointing at `bin/infrastructure.js` and two CDK runtime dependencies into a
 * repository that has no `bin/`.
 *
 * The consequence worth pinning is the quiet one. The preset's knip `entry`
 * globs include `config/`, `util/`, `utils/` and `functions/` — ordinary names
 * in ordinary TypeScript services. The reported repository matched none of them
 * and knip exited 1, which is the lucky corner of the input space. A
 * mis-detected repository that happens to have a `utils/` directory gives the
 * dead-code gate a fraction of the codebase and a passing exit code.
 * @module tests/unit/detection/cdk-app-shape
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readConfinedDetectedStacks } from "../../../src/cli/ui-detected-stacks.js";
import { createDetectorRegistry } from "../../../src/detection/index.js";
import { detectHealthProjectTypes } from "../../../src/health/template-inspection.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const PACKAGE_JSON = "package.json";
const CDK_JSON = "cdk.json";
const CDK = "cdk";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

/**
 * Every dependency shape that means "uses CDK", none of which means "is an app".
 *
 * `aws-cdk` is in here deliberately. It is the CLI, it arrives directly in
 * toolchains that only build constructs, and matching it exactly rather than by
 * prefix is the narrowing that would pass a naive test while still misfiring on
 * the repository that produced the report.
 */
const CONSTRUCT_CONSUMER_MANIFEST = {
  name: "construct-consumer",
  dependencies: {
    "aws-cdk-lib": "^2.0.0",
    constructs: "^10.4.5",
    "@aws-cdk/aws-amplify-alpha": "^2.0.0",
    "aws-cdk-github-oidc": "^2.4.1",
  },
  devDependencies: { "aws-cdk": "^2.1127.0", typescript: "^5.0.0" },
} as const;

/**
 * Ask every detection surface what it thinks this directory is.
 * @param dir - Project directory to classify
 * @returns One list of types per surface, keyed by surface name
 */
async function classifyEverywhere(
  dir: string
): Promise<Record<string, readonly string[]>> {
  const registry = createDetectorRegistry();
  // package-lisa's detector is private, so it is reached through the public
  // audit that returns what it decided — pointed at the real template tree, so
  // this exercises the actual CDK preset rather than a fixture of it.
  const audit = await new PackageLisaStrategy().auditOverrideFloors(
    dir,
    REPO_ROOT
  );
  return {
    "detection/detectors/cdk": await registry.detectAll(dir),
    "health/template-inspection": [...(await detectHealthProjectTypes(dir))],
    "cli/ui-detected-stacks": [...(await readConfinedDetectedStacks(dir))],
    "strategies/package-lisa": [...audit.detectedTypes],
  };
}

/**
 * Name every surface whose verdict matches a predicate.
 * @param bySurface - Types each surface reported
 * @param predicate - True for a surface that got it wrong
 * @returns Surface names, so a failure names all of them at once
 */
function surfacesWhere(
  bySurface: Record<string, readonly string[]>,
  predicate: (types: readonly string[]) => boolean
): string[] {
  return Object.entries(bySurface)
    .filter(([, types]) => predicate(types))
    .map(([surface]) => surface);
}

describe("CDK app treatment requires a CDK app", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(projectDir);
  });

  it("does not admit a construct consumer on any surface", async () => {
    await fs.writeJson(
      path.join(projectDir, PACKAGE_JSON),
      CONSTRUCT_CONSUMER_MANIFEST
    );
    // The directory that turns the loud failure into a silent pass: it matches
    // the preset's `utils/**/*.ts` entry glob, so knip would analyse this one
    // file, find nothing dead, and exit 0.
    await fs.ensureDir(path.join(projectDir, "utils"));
    await fs.writeFile(
      path.join(projectDir, "utils", "helper.ts"),
      "export const helper = (): number => 1;\n"
    );

    const bySurface = await classifyEverywhere(projectDir);

    // Collected rather than asserted per surface inside the loop. A loop of
    // bare expects stops at the first failure, so it would prove one surface
    // red under injection and say nothing about the rest — a coverage claim
    // the run did not actually measure.
    expect(surfacesWhere(bySurface, types => types.includes(CDK))).toEqual([]);
  });

  it("still detects a real CDK app on every surface", async () => {
    await fs.writeJson(path.join(projectDir, CDK_JSON), {});
    await fs.writeJson(path.join(projectDir, PACKAGE_JSON), {
      name: "an-app",
    });

    const bySurface = await classifyEverywhere(projectDir);

    expect(surfacesWhere(bySurface, types => !types.includes(CDK))).toEqual([]);
  });

  it("detects an app that is also a construct consumer, on cdk.json", async () => {
    await fs.writeJson(path.join(projectDir, CDK_JSON), {});
    await fs.writeJson(
      path.join(projectDir, PACKAGE_JSON),
      CONSTRUCT_CONSUMER_MANIFEST
    );

    const bySurface = await classifyEverywhere(projectDir);

    expect(surfacesWhere(bySurface, types => !types.includes(CDK))).toEqual([]);
  });
});

describe("what admission to the CDK preset actually costs", () => {
  it("names the CDK template as the sole source of the reported merge", async () => {
    const cdkTemplate = (await fs.readJson(
      path.join(REPO_ROOT, "cdk", "package-lisa", "package.lisa.json")
    )) as { force?: Record<string, unknown> };
    const force = cdkTemplate.force ?? {};

    // The `bin` entry and the CDK runtime dependencies the issue reports being
    // backed out downstream both come from here. Detection is what admits it,
    // which is why narrowing detection removes this instance at the source.
    expect(force.bin).toEqual({ infrastructure: "bin/infrastructure.js" });
    expect(force.dependencies).toMatchObject({
      "aws-cdk-github-oidc": expect.any(String),
      constructs: expect.any(String),
    });
  });
});

describe("no surface reintroduces the dependency arm", () => {
  /**
   * Source files whose CODE may name an `aws-cdk` package.
   *
   * This is a net for a surface that neither the fix nor its tests know about,
   * which is the failure it pins: enumerating the call sites I already found
   * and testing exactly those proves consistency, not coverage.
   *
   * Comments are stripped before the scan, so explaining the rule never trips
   * it and the detector itself stays in scope rather than being excused. It is
   * still a blunt instrument — it keys on the package name, so a surface that
   * reintroduced the arm under a different spelling would slip past. The
   * per-surface assertions above are what cover the surfaces that exist today.
   */
  const ALLOWED = new Set([
    // Asks a different question: does this repository need AWS credentials?
    // A construct consumer genuinely does, and this arm is independent of the
    // `cdk` project type, so narrowing detection does not weaken it.
    "src/cli/remote-environment-detection.ts",
  ]);

  /**
   * Remove line and block comments so prose about the rule is not the rule.
   * @param source - TypeScript source text
   * @returns The same source with comment bodies blanked
   */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
  }

  it("keeps the aws-cdk dependency name out of project-type detection", async () => {
    // Walked rather than listed through `git ls-files`: a child process here
    // would need a bounded spawn and an absolute path to git, and buys nothing
    // when every TypeScript file under src is tracked anyway.
    const entries = await fs.readdir(path.join(REPO_ROOT, "src"), {
      recursive: true,
    });
    const listed = entries
      .map(entry => `src/${entry.split(path.sep).join("/")}`)
      .filter(file => file.endsWith(".ts"))
      .filter(file => !file.includes("upstream-evidence-manifest"))
      .filter(file => !file.includes("lisa-owned-hash-ledger"))
      .filter(file => !ALLOWED.has(file));

    const offenders: string[] = [];
    for (const file of listed) {
      const source = await fs.readFile(path.join(REPO_ROOT, file), "utf8");
      if (stripComments(source).includes("aws-cdk")) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
