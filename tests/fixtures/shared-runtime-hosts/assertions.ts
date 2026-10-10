/* eslint-disable code-organization/enforce-statement-order -- Assertions inspect real child outputs in chronological order. */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "vitest";
import { assertInstalledBytes, type Candidate } from "./artifact.js";
import { run } from "./process.js";

const NODE_VERSION = "24.21.0";
const MANIFEST = "package.json";
/**
 * Check literal accepted floors before invoking any expensive host install.
 * @param host - Generated host directory
 */
export function assertGeneratedPolicy(host: string): void {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(host, MANIFEST), "utf8")
  );
  expect(manifest.engines.node, "generated Node policy").toBe(NODE_VERSION);
  expect(fs.readFileSync(path.join(host, ".nvmrc"), "utf8").trim()).toBe(
    NODE_VERSION
  );
  const workflows = path.join(host, ".github/workflows");
  expect(fs.readFileSync(path.join(workflows, "ci.yml"), "utf8")).toContain(
    `node_version: '${NODE_VERSION}'`
  );
  expect(
    fs.readFileSync(path.join(workflows, "review-evidence.yml"), "utf8")
  ).toContain(`node-version: '${NODE_VERSION}'`);
  expect(
    fs.readFileSync(
      path.join(workflows, "third-party-review-evidence.yml"),
      "utf8"
    )
  ).toContain(`node-version: \${{ vars.NODE_VERSION || '${NODE_VERSION}' }}`);
  expect(manifest.devDependencies.vitest).toBe("^4.1.11");
  expect(manifest.devDependencies["@vitest/coverage-v8"]).toBe("^4.1.11");
  expect(
    manifest.overrides.vite === "$vite"
      ? manifest.devDependencies.vite
      : manifest.overrides.vite
  ).toBe("^8.3.2");
}

/**
 * Inspect all five distinct source channels in the genuine extracted package.
 * @param candidate - Immutable packed source and identity
 */
export function assertPackedRuntimePolicy(candidate: Candidate): void {
  const root = path.join(candidate.oracle, "typescript");
  expect(
    fs.readFileSync(path.join(root, "copy-overwrite/.nvmrc"), "utf8").trim()
  ).toBe(NODE_VERSION);
  expect(
    JSON.parse(
      fs.readFileSync(path.join(root, "package-lisa/package.lisa.json"), "utf8")
    ).defaults.engines.node
  ).toBe(NODE_VERSION);
  for (const [name, value] of [
    ["ci.yml", `node_version: '${NODE_VERSION}'`],
    ["review-evidence.yml", `node-version: '${NODE_VERSION}'`],
    [
      "third-party-review-evidence.yml",
      `node-version: \${{ vars.NODE_VERSION || '${NODE_VERSION}' }}`,
    ],
  ]) {
    expect(
      fs.readFileSync(
        path.join(root, "create-only/.github/workflows", name!),
        "utf8"
      )
    ).toContain(value);
  }
}

/**
 * Assert actual installed supported majors, patched floors and lock identity.
 * @param candidate - Exact packed candidate and child environment
 * @param host - Generated host directory
 * @returns Actual installed tool versions after full byte and lock verification
 */
export function installedVersions(
  candidate: Candidate,
  host: string
): Readonly<Record<string, string>> {
  const majors = {
    vitest: 4,
    "@vitest/coverage-v8": 4,
    vite: 8,
    typescript: 6,
    eslint: 9,
    knip: 5,
    husky: 8,
  };
  const versions = Object.fromEntries(
    Object.keys(majors).map(name => [
      name,
      JSON.parse(
        fs.readFileSync(path.join(host, "node_modules", name, MANIFEST), "utf8")
      ).version as string,
    ])
  );
  const lock = fs.readFileSync(path.join(host, "bun.lock"), "utf8");
  Object.entries(majors).forEach(([name, major]) => {
    expect(Number(versions[name]!.split(".")[0]), name).toBe(major);
    expect(lock, name).toContain(`${name}@${versions[name]}`);
  });
  ["vitest", "@vitest/coverage-v8"].forEach(name =>
    expect(
      Number(versions[name]!.split(".")[1]) * 100_000 +
        Number(versions[name]!.split(".")[2]),
      name
    ).toBeGreaterThanOrEqual(100_011)
  );
  expect(
    Number(versions["vite"]!.split(".")[1]) * 100_000 +
      Number(versions["vite"]!.split(".")[2])
  ).toBeGreaterThanOrEqual(300_002);
  const installed = path.join(host, "node_modules", "@codyswann", "lisa");
  expect(
    JSON.parse(fs.readFileSync(path.join(installed, MANIFEST), "utf8")).version
  ).toBe(candidate.version);
  expect(lock).toContain(candidate.integrity);
  assertInstalledBytes(candidate, installed);
  return versions;
}

/**
 * Inspect the actual no-lookups CloudFormation output, without normalization.
 * @param candidate - Exact packed candidate and child environment
 * @param host - Generated host directory
 * @param label - Named evidence log boundary
 * @returns Raw synthesized CloudFormation template bytes
 */
export async function synth(
  candidate: Candidate,
  host: string,
  label: string
): Promise<Buffer> {
  await run(
    "bun",
    ["run", "cdk", "synth", "--no-lookups", "--quiet"],
    host,
    candidate.env,
    candidate.logs,
    label
  );
  const bytes = fs.readFileSync(
    path.join(host, "cdk.out", "RuntimeFixture.template.json")
  );
  const template = JSON.parse(bytes.toString());
  expect(Object.keys(template.Resources)).toHaveLength(1);
  const bucket = Object.values(template.Resources)[0] as {
    Type: string;
    Properties: Record<string, unknown>;
  };
  expect(bucket.Type).toBe("AWS::S3::Bucket");
  expect(bucket.Properties["PublicAccessBlockConfiguration"]).toEqual({
    BlockPublicAcls: true,
    BlockPublicPolicy: true,
    IgnorePublicAcls: true,
    RestrictPublicBuckets: true,
  });
  expect(bucket.Properties["BucketEncryption"]).toEqual({
    ServerSideEncryptionConfiguration: [
      { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
    ],
  });
  expect(
    JSON.parse(
      fs.readFileSync(path.join(host, "cdk.out", "manifest.json"), "utf8")
    ).missing ?? []
  ).toEqual([]);
  return bytes;
}

/* eslint-enable code-organization/enforce-statement-order -- End the chronological fixture harness. */
