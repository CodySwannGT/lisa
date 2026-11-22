/** Real shipped wrappers must consume local overrides while executing application tests. */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { cleanupTempDir } from "../helpers/test-utils.js";
import {
  createStagedModuleFixture,
  runStagedTool,
} from "../support/staged-module-fixture.js";

useIoLatencyBudget();
const ROOT = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const VITEST = path.join(
  path.dirname(require.resolve("vitest/package.json")),
  "vitest.mjs"
);
const CONFIG = "vitest.config.ts";
const LOCAL = "vitest.config.local.ts";
const THRESHOLDS = "vitest.thresholds.json";
const TSCONFIG = "tsconfig.json";
const TITLE = "runs the application with its local override";

/** Actual Vitest JSON reporter output used to qualify execution and failures. */
interface RuntimeReport {
  readonly numTotalTests: number;
  readonly numPassedTests: number;
  readonly numFailedTests: number;
  readonly testResults: readonly {
    readonly assertionResults: readonly {
      readonly title: string;
      readonly status: string;
      readonly failureMessages: readonly string[];
    }[];
  }[];
}

/**
 * Seed an owned application using the real wrapper and a meaningful local setting.
 * @param directory - Owned fixture directory
 * @param stack - Actual root or shipped project stack
 * @returns Wrapper and immutable application inputs
 */
function prepareApplication(directory: string, stack: string) {
  const file = (name: string) => path.join(directory, name);
  const wrapper = fs.readFileSync(
    path.join(
      ROOT,
      stack === "root" ? CONFIG : `${stack}/copy-overwrite/${CONFIG}`
    ),
    "utf8"
  );
  const local = fs
    .readFileSync(path.join(ROOT, "typescript/create-only", LOCAL), "utf8")
    .replace(
      "const config: ViteUserConfig = {};",
      "const config: ViteUserConfig = {\n  test: {\n    env: { LISA_FIXTURE_LOCAL_PROOF: 'local-config-loaded' },\n  },\n};"
    );
  const test =
    stack === "cdk"
      ? "test/application.test.ts"
      : stack === "nestjs"
        ? "src/application.spec.ts"
        : "tests/application.test.ts";
  expect(local).toContain("env: { LISA_FIXTURE_LOCAL_PROOF:");
  fs.writeFileSync(file(CONFIG), wrapper);
  fs.writeFileSync(file(LOCAL), local);
  fs.copyFileSync(
    path.join(ROOT, "typescript/create-only", THRESHOLDS),
    file(THRESHOLDS)
  );
  fs.mkdirSync(file("src"), { recursive: true });
  fs.mkdirSync(path.dirname(file(test)), { recursive: true });
  fs.writeFileSync(
    file("src/application.ts"),
    "export const add = (a: number, b: number): number => a + b;\n"
  );
  fs.writeFileSync(
    file(test),
    `import { expect, it } from 'vitest';\nimport { add } from '${stack === "nestjs" ? "./application.js" : "../src/application.js"}';\nit('${TITLE}', () => { expect(add(2, 3)).toBe(5); expect(process.env.LISA_FIXTURE_LOCAL_PROOF).toBe('local-config-loaded'); });\n`
  );
  fs.writeFileSync(
    file(TSCONFIG),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        types: ["node"],
      },
      include: ["src/**/*.ts", "tests/**/*.ts", "test/**/*.ts", CONFIG],
    })
  );
  return {
    wrapper,
    preserved: [LOCAL, THRESHOLDS, TSCONFIG, "src/application.ts", test].map(
      name => ({ name, bytes: fs.readFileSync(file(name)) })
    ),
  };
}

/**
 * Require one actual application test and a causal failure in the negative arm.
 * @param report - Actual Vitest report
 * @param negative - Whether only the local config merge was removed
 */
function assertApplicationRun(report: RuntimeReport, negative: boolean): void {
  const assertions = report.testResults.flatMap(item => item.assertionResults);
  expect(report.numTotalTests).toBe(1);
  expect(report.numPassedTests).toBe(negative ? 0 : 1);
  expect(report.numFailedTests).toBe(negative ? 1 : 0);
  expect(assertions).toEqual([
    expect.objectContaining({
      title: TITLE,
      status: negative ? "failed" : "passed",
    }),
  ]);
  if (negative) {
    const failures = assertions
      .flatMap(item => item.failureMessages)
      .join("\n");
    expect(failures).toContain("local-config-loaded");
    expect(failures).toContain("undefined");
  }
}

describe.each([
  "root",
  "typescript",
  "cdk",
  "nestjs",
  "harper-fabric",
  "phaser",
])("%s real Vitest local customization", stack => {
  it("executes the named test and detects an ignored local override", async () => {
    const fixture = createStagedModuleFixture("emitted");
    try {
      const file = (name: string) => path.join(fixture.directory, name);
      const { wrapper, preserved } = prepareApplication(
        fixture.directory,
        stack
      );
      // Run the fixture under the caller's own temp root: os.tmpdir(), which
      // is TMPDIR when set and the platform default (a Linux runner leaves it
      // unset) otherwise. lisa-test-run no longer exports a private one
      // (CodySwannGT/lisa#4603).
      const env: NodeJS.ProcessEnv = {
        ...fixture.env,
        TMPDIR: os.tmpdir(),
        TMP: process.env["TMP"],
        TEMP: process.env["TEMP"],
      };
      expect(env.TMPDIR).toBeTruthy();
      delete env["LISA_FIXTURE_LOCAL_PROOF"];
      for (const negative of [false, true]) {
        const candidate = negative
          ? wrapper.replace("  localConfig\n", "")
          : wrapper;
        expect(candidate === wrapper).toBe(!negative);
        fs.writeFileSync(file(CONFIG), candidate);
        const output = file(negative ? "negative.json" : "positive.json");
        const result = runStagedTool({ ...fixture, env }, process.execPath, [
          VITEST,
          "run",
          "--config",
          CONFIG,
          "--reporter=json",
          "--outputFile",
          output,
        ]);
        expect(result.signal).toBeNull();
        expect(result.error).toBeUndefined();
        const report = JSON.parse(
          fs.readFileSync(output, "utf8")
        ) as RuntimeReport;
        expect(
          result.status,
          `${result.stdout}${result.stderr}\n${JSON.stringify(report)}`
        ).toBe(negative ? 1 : 0);
        assertApplicationRun(report, negative);
        for (const input of preserved)
          expect(fs.readFileSync(file(input.name))).toEqual(input.bytes);
      }
    } finally {
      await cleanupTempDir(fixture.directory);
    }
  });
});
