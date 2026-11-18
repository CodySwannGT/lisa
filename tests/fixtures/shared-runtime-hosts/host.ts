/** Synthetic host source, independent of the managed templates under test. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

/**
 * Persist one fixture file, creating its parent directory.
 * @param root - Isolated fixture root
 * @param name - Relative fixture path
 * @param value - Fixture bytes or JSON value
 */
export function write(root: string, name: string, value: unknown): void {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`
  );
}

/**
 * Create genuine TS/CDK sources with the stack's actual native test directory.
 * @param root - Isolated fixture root
 * @param stack - Supported host stack
 */
export function seedHost(root: string, stack: "typescript" | "cdk"): void {
  const tests = stack === "cdk" ? "test" : "tests";
  write(root, "package.json", {
    name: `packed-runtime-${stack}`,
    version: "1.0.0",
    private: true,
    type: "module",
  });
  write(root, "tsconfig.json", {
    extends: [`@codyswann/lisa/tsconfig/${stack}`, "./tsconfig.local.json"],
    compilerOptions: { ignoreDeprecations: "6.0" },
  });
  write(root, "tsconfig.local.json", {
    compilerOptions: {
      rootDir: ".",
      outDir: "dist",
      strict: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
    },
    include: ["src/**/*.ts", `${tests}/**/*.ts`],
    exclude: ["node_modules", "dist", "cdk.out"],
    files: [],
  });
  write(root, "src/value.ts", "export const value = 42;\n");
  write(
    root,
    `${tests}/value.test.ts`,
    'import { expect, it } from "vitest";\nimport { value } from "../src/value.js";\nit("executes real host source", () => { expect(value).toBe(42); });\n'
  );
  if (stack !== "cdk") return;
  write(root, "cdk.json", {
    app: "node --import tsx src/app.ts",
    context: {
      "aws:cdk:enable-path-metadata": false,
      "aws:cdk:enable-asset-metadata": false,
    },
  });
  write(
    root,
    "src/stack.ts",
    'import { App, Stack, aws_s3 as s3 } from "aws-cdk-lib";\nexport function createStack(app: App) { const stack = new Stack(app, "RuntimeFixture", { analyticsReporting: false, env: { account: "123456789012", region: "us-east-1" } }); new s3.Bucket(stack, "Bucket", { blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.S3_MANAGED }); return stack; }\n'
  );
  write(
    root,
    "src/app.ts",
    'import { App } from "aws-cdk-lib";\nimport { createStack } from "./stack.js";\nconst app = new App({ context: { "aws:cdk:enable-path-metadata": false, "aws:cdk:enable-asset-metadata": false } }); createStack(app); app.synth();\n'
  );
  write(
    root,
    `${tests}/stack.test.ts`,
    'import { App } from "aws-cdk-lib";\nimport { Template } from "aws-cdk-lib/assertions";\nimport { expect, it } from "vitest";\nimport { createStack } from "../src/stack.js";\nit("synthesizes the actual offline stack", () => { const template = Template.fromStack(createStack(new App())); template.resourceCountIs("AWS::S3::Bucket", 1); template.hasResourceProperties("AWS::S3::Bucket", { PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } }); expect(Object.keys(template.toJSON().Resources)).toHaveLength(1); });\n'
  );
}

/**
 * Enumerate all regular files; the packed oracle includes every tar member.
 * @param root - Isolated fixture root
 * @param excluded - Operational directory names to omit
 * @param includeLinks - Include symbolic link identities in managed snapshots
 * @returns All relative regular-file paths, optionally including symbolic links
 */
export function files(
  root: string,
  excluded: readonly string[] = [],
  includeLinks = false
): readonly string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (excluded.includes(entry.name)) return [];
    const target = path.join(root, entry.name);
    if (entry.isDirectory())
      return files(target, excluded, includeLinks).map(child =>
        path.join(entry.name, child)
      );
    return entry.isFile() || (includeLinks && entry.isSymbolicLink())
      ? [entry.name]
      : [];
  });
}

/**
 * Hash every managed byte, excluding only documented operational outputs.
 * @param root - Isolated fixture root
 * @returns Full managed path-to-content hash mapping
 */
export function snapshot(root: string): Readonly<Record<string, string>> {
  // Dependency/build outputs and Git internals are not managed source. Receipts
  // and backup trees intentionally record each apply; no config is excluded.
  const excluded = [
    ".git",
    "node_modules",
    "cdk.out",
    "coverage",
    ".lisabak",
    ".lisa-backups",
  ];
  return Object.fromEntries(
    files(root, excluded, true)
      .filter(name => name !== path.join(".lisa", "apply-receipt.json"))
      .map(name => [
        name,
        createHash("sha256")
          .update(
            fs.lstatSync(path.join(root, name)).isSymbolicLink()
              ? `symlink:${fs.readlinkSync(path.join(root, name))}`
              : fs.readFileSync(path.join(root, name))
          )
          .digest("hex"),
      ])
  );
}
