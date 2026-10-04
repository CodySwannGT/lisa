#!/usr/bin/env node
/** Ordinary installed compatibility smoke checks for the dependency refresh. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  SCRATCH_SUPERVISION_LEASE_ENV,
  createSupervisedWorkerScope,
  parseScratchSupervisionLease,
  removeSupervisedWorkerScope,
} from "../dist/configs/vitest/scratch-supervision.js";

const root = path.resolve(process.env.LISA_NPM_PROOF_ROOT ?? ".");
const packageFile = "package.json";
const require = createRequire(path.join(root, packageFile));
const serializedLease = process.env[SCRATCH_SUPERVISION_LEASE_ENV];
assert.ok(serializedLease, "Run through lisa-test-run with its owned lease");
const lease = parseScratchSupervisionLease(serializedLease);
const scope = createSupervisedWorkerScope(lease);
const temporary = scope.path;
const checks = [];

try {
  const j = require("jscodeshift").withParser("tsx");
  const tree = j("const value: number = 1; const view = <div>{value}</div>;");
  tree.find(j.Identifier, { name: "value" }).forEach(p => {
    p.node.name = "answer";
  });
  assert.ok(tree.toSource().includes("{answer}"));
  checks.push("jscodeshift: TSX transform");

  const eslintRequire = createRequire(require.resolve("eslint"));
  const Ajv6 = eslintRequire("ajv");
  const validate6 = new Ajv6().compile({
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  });
  assert.equal(validate6({ name: "ordinary" }), true);
  assert.equal(validate6({ name: 1 }), false);
  const commitlintRequire = createRequire(require.resolve("@commitlint/cli"));
  const Ajv8 = createRequire(
    commitlintRequire.resolve("@commitlint/config-validator")
  )("ajv");
  const validate8 = new Ajv8.default().compile({ type: "integer" });
  assert.equal(validate8(42), true);
  assert.equal(validate8("42"), false);
  checks.push("Ajv: distinct v6/v8 schema APIs");

  const legacyMatch = eslintRequire("minimatch");
  assert.equal(typeof legacyMatch, "function");
  assert.equal(legacyMatch("src/file.ts", "**/*.ts"), true);
  assert.equal(legacyMatch("src/file.js", "**/*.ts"), false);
  const modernMatch = require("minimatch").minimatch;
  assert.equal(modernMatch("src/file.ts", "**/*.ts"), true);
  assert.equal(modernMatch("src/file.js", "**/*.ts"), false);
  checks.push("minimatch: legacy callable and modern object APIs");

  const strykerRequire = createRequire(
    require.resolve("@stryker-mutator/core")
  );
  const restRequire = createRequire(
    strykerRequire.resolve("typed-rest-client/HttpClient")
  );
  const qs = restRequire("qs");
  assert.deepEqual(qs.parse("name=ordinary&tasks=lint&tasks=test"), {
    name: "ordinary",
    tasks: ["lint", "test"],
  });
  assert.equal(qs.stringify({ name: "ordinary" }), "name=ordinary");
  assert.equal(
    typeof strykerRequire("@stryker-mutator/core").Stryker,
    "function"
  );
  checks.push(
    "Stryker: installed core and compatible qs6 parse/stringify APIs"
  );

  const functionalPath = require.resolve("eslint-plugin-functional");
  const functional = (await import(pathToFileURL(functionalPath).href)).default;
  const functionalRequire = createRequire(functionalPath);
  const { deepmerge } = functionalRequire("deepmerge-ts");
  assert.deepEqual(
    deepmerge(
      { labels: ["first"], options: { enabled: true } },
      { labels: ["second"], options: { level: 2 } }
    ),
    {
      labels: ["first", "second"],
      options: { enabled: true, level: 2 },
    }
  );
  const { Linter } = require("eslint");
  const linter = new Linter();
  const functionalConfig = [
    {
      plugins: { functional },
      rules: {
        "functional/no-let": ["error", { ignoreIdentifierPattern: "^ignored" }],
      },
    },
  ];
  const ordinaryLet = linter.verify(
    "let answer = 42; answer;",
    functionalConfig
  );
  assert.equal(
    ordinaryLet.filter(message => message.ruleId === "functional/no-let")
      .length,
    1
  );
  assert.deepEqual(
    linter.verify("const answer = 42; answer;", functionalConfig),
    []
  );
  checks.push("functional: actual ESLint rule and installed deepmerge APIs");

  const cdk = require("aws-cdk-lib");
  const app = new cdk.App({ outdir: path.join(temporary, "cdk.out") });
  const stack = new cdk.Stack(app, "AnonymousProof");
  new cdk.aws_s3.Bucket(stack, "Storage", {
    enforceSSL: true,
    versioned: true,
    blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
  });
  new cdk.CfnOutput(stack, "Proof", { value: "synth-only" });
  const template = app.synth().getStackArtifact(stack.artifactId).template;
  assert.equal(template.Outputs.Proof.Value, "synth-only");
  assert.ok(
    Object.values(template.Resources).some(
      resource => resource.Type === "AWS::S3::Bucket"
    )
  );
  checks.push("CDK: actual local synthesis without cloud operations");

  const release = path.join(temporary, "release");
  fs.mkdirSync(release);
  fs.writeFileSync(
    path.join(release, packageFile),
    JSON.stringify({ name: "anonymous-release-proof", version: "1.0.0" })
  );
  const original = process.cwd();
  process.chdir(release);
  try {
    await require("standard-version")({
      dryRun: true,
      releaseAs: "patch",
      skip: { changelog: true, commit: true, tag: true },
      silent: true,
    });
    assert.equal(
      JSON.parse(fs.readFileSync(packageFile, "utf8")).version,
      "1.0.0"
    );
  } finally {
    process.chdir(original);
  }
  checks.push(
    "standard-version: ordinary release dry run leaves manifest unchanged"
  );
  console.log(JSON.stringify({ success: true, checks }, null, 2));
} finally {
  removeSupervisedWorkerScope(scope, lease);
}
