/** Detectors for the TypeScript, Expo, NestJS and CDK stacks. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { TypeScriptDetector } from "../../../src/detection/detectors/typescript.js";
import { ExpoDetector } from "../../../src/detection/detectors/expo.js";
import { NestJSDetector } from "../../../src/detection/detectors/nestjs.js";
import { CDKDetector } from "../../../src/detection/detectors/cdk.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";
import {
  PACKAGE_JSON,
  TSCONFIG_JSON,
  APP_JSON,
  NEST_CLI_JSON,
  CDK_JSON,
  EAS_JSON,
  TYPESCRIPT_TYPE,
  EXPO_DEP,
  NESTJS_TYPE,
  CDK_TYPE,
  HAS_CORRECT_TYPE,
} from "./detectors-fixtures.js";

describe("TypeScriptDetector", () => {
  let detector: TypeScriptDetector;
  let tempDir: string;

  beforeEach(async () => {
    detector = new TypeScriptDetector();
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it(HAS_CORRECT_TYPE, () => {
    expect(detector.type).toBe(TYPESCRIPT_TYPE);
  });

  it("detects by tsconfig.json presence", async () => {
    await fs.writeJson(path.join(tempDir, TSCONFIG_JSON), {});

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by typescript dependency", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { typescript: "^5.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by typescript devDependency", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      devDependencies: { typescript: "^5.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not a TypeScript project", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {});

    expect(await detector.detect(tempDir)).toBe(false);
  });

  it("returns false when no package.json", async () => {
    expect(await detector.detect(tempDir)).toBe(false);
  });
});

describe("ExpoDetector", () => {
  let detector: ExpoDetector;
  let tempDir: string;

  beforeEach(async () => {
    detector = new ExpoDetector();
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it(HAS_CORRECT_TYPE, () => {
    expect(detector.type).toBe(EXPO_DEP);
  });

  it("detects by app.json presence", async () => {
    await fs.writeJson(path.join(tempDir, APP_JSON), { expo: {} });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by eas.json presence", async () => {
    await fs.writeJson(path.join(tempDir, EAS_JSON), {});

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by expo dependency", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { expo: "^50.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not an Expo project", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {});

    expect(await detector.detect(tempDir)).toBe(false);
  });
});

describe("NestJSDetector", () => {
  let detector: NestJSDetector;
  let tempDir: string;

  beforeEach(async () => {
    detector = new NestJSDetector();
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it(HAS_CORRECT_TYPE, () => {
    expect(detector.type).toBe(NESTJS_TYPE);
  });

  it("detects by nest-cli.json presence", async () => {
    await fs.writeJson(path.join(tempDir, NEST_CLI_JSON), {});

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by @nestjs/core dependency", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { "@nestjs/core": "^10.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by @nestjs/* devDependency", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      devDependencies: { "@nestjs/testing": "^10.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not a NestJS project", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {});

    expect(await detector.detect(tempDir)).toBe(false);
  });
});

describe("CDKDetector", () => {
  let detector: CDKDetector;
  let tempDir: string;

  beforeEach(async () => {
    detector = new CDKDetector();
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it(HAS_CORRECT_TYPE, () => {
    expect(detector.type).toBe(CDK_TYPE);
  });

  it("detects by cdk.json presence", async () => {
    await fs.writeJson(path.join(tempDir, CDK_JSON), {});

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("does not detect a construct consumer with no cdk.json", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { "aws-cdk-lib": "^2.0.0", constructs: "^10.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(false);
  });

  it("does not detect on the aws-cdk CLI alone", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      devDependencies: { "aws-cdk": "^2.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(false);
  });

  it("does not detect on other aws-cdk-prefixed packages", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: {
        "@aws-cdk/aws-amplify-alpha": "^2.0.0",
        "aws-cdk-github-oidc": "^2.0.0",
      },
    });

    expect(await detector.detect(tempDir)).toBe(false);
  });

  it("detects an app that both has cdk.json and consumes constructs", async () => {
    await fs.writeJson(path.join(tempDir, CDK_JSON), {});
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { "aws-cdk-lib": "^2.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not a CDK project", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {});

    expect(await detector.detect(tempDir)).toBe(false);
  });
});
