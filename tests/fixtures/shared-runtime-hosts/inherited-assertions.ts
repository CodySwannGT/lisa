/** Observe generated policy, genuine installed dependencies and native outputs. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { expect } from "vitest";
import { assertInstalledBytes, type Candidate } from "./artifact.js";
import { files } from "./host.js";
import {
  INHERITED_NATIVE_SPEC,
  type InheritedStack,
} from "./inherited-seeds.js";

const NODE = "24.21.0";
const PACKAGE_JSON = "package.json";

/**
 * Check each actual generated route without changing force/default ownership.
 * @param host - Owned real CLI destination
 * @param stack - Genuine detected inherited route
 */
export function assertInheritedPolicy(
  host: string,
  stack: InheritedStack
): void {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(host, PACKAGE_JSON), "utf8")
  );
  const forced = stack === "phaser" || stack === "harper-fabric";
  const workflowRoot = path.join(host, ".github/workflows");
  expect(manifest.engines.node).toBe(forced ? `>= ${NODE}` : NODE);
  expect(fs.readFileSync(path.join(host, ".nvmrc"), "utf8").trim()).toBe(NODE);
  expect(fs.readFileSync(path.join(workflowRoot, "ci.yml"), "utf8")).toContain(
    `node_version: '${NODE}'`
  );
  expect(
    fs.readFileSync(path.join(workflowRoot, "review-evidence.yml"), "utf8")
  ).toContain(`node-version: '${NODE}'`);
  expect(
    fs.readFileSync(
      path.join(workflowRoot, "third-party-review-evidence.yml"),
      "utf8"
    )
  ).toContain(`node-version: \${{ vars.NODE_VERSION || '${NODE}' }}`);
  if (stack === "expo") {
    expect(
      JSON.parse(fs.readFileSync(path.join(host, "eas.json"), "utf8")).build
        .base.node
    ).toBe(NODE);
    expect(manifest.devDependencies["jest-expo"]).toBe("~57.0.1");
  }
}

/**
 * Confirm each real framework runner executed the expected nonzero test count.
 * @param candidate - Exact native log boundary
 * @param stack - Supported framework runner
 */
export function assertInheritedUnitExecution(
  candidate: Candidate,
  stack: InheritedStack
): void {
  const spec = INHERITED_NATIVE_SPEC[stack];
  const unitOutput = fs
    .readFileSync(path.join(candidate.logs, `${stack}-unit.log`), "utf8")
    .replace(/\u001b\[[0-9;]*m/g, "");
  expect(unitOutput, "actual nonzero framework unit execution").toMatch(
    new RegExp(
      `Tests${stack === "expo" ? ":" : ""}\\s+${spec.unitCount} passed`
    )
  );
}

/**
 * Inspect actual native artifacts and full installed candidate bytes.
 * @param candidate - Exact immutable archive and oracle
 * @param host - Actual installed/generated host
 * @param stack - Native framework route
 * @returns Observed package versions and output hashes
 */
export function inheritedOutputs(
  candidate: Candidate,
  host: string,
  stack: InheritedStack
) {
  const spec = INHERITED_NATIVE_SPEC[stack];
  const versions = Object.fromEntries(
    spec.frameworkPackages.map(name => [
      name,
      JSON.parse(
        fs.readFileSync(
          path.join(host, "node_modules", name, PACKAGE_JSON),
          "utf8"
        )
      ).version,
    ])
  );
  const installed = path.join(host, "node_modules/@codyswann/lisa");
  const outputRoot =
    stack === "nestjs"
      ? ".build"
      : stack === "harper-fabric"
        ? "harper-app"
        : "dist";
  const outputFiles = files(path.join(host, outputRoot));
  const hashes = Object.fromEntries(
    outputFiles.map(name => [
      path.join(outputRoot, name),
      createHash("sha256")
        .update(fs.readFileSync(path.join(host, outputRoot, name)))
        .digest("hex"),
    ])
  );
  expect(
    JSON.parse(fs.readFileSync(path.join(installed, PACKAGE_JSON), "utf8"))
      .version
  ).toBe(candidate.version);
  expect(fs.readFileSync(path.join(host, "bun.lock"), "utf8")).toContain(
    candidate.integrity
  );
  assertInstalledBytes(candidate, installed);
  for (const name of spec.artifacts)
    expect(fs.statSync(path.join(host, name)).size, name).toBeGreaterThan(0);
  expect(outputFiles.length).toBeGreaterThan(0);
  return { versions, outputHashes: hashes };
}
