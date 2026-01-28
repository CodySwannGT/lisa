import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs-extra";
import * as path from "node:path";
import { TypeScriptDetector } from "../../../src/detection/detectors/typescript.js";
import { ExpoDetector } from "../../../src/detection/detectors/expo.js";
import { NestJSDetector } from "../../../src/detection/detectors/nestjs.js";
import { CDKDetector } from "../../../src/detection/detectors/cdk.js";
import { DetectorRegistry } from "../../../src/detection/index.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const PACKAGE_JSON = "package.json";
const TSCONFIG_JSON = "tsconfig.json";
const APP_JSON = "app.json";
const NEST_CLI_JSON = "nest-cli.json";
const CDK_JSON = "cdk.json";
const EAS_JSON = "eas.json";
const TYPESCRIPT_TYPE = "typescript";
const EXPO_DEP = "expo";
const NESTJS_TYPE = "nestjs";
const CDK_TYPE = "cdk";
const HAS_CORRECT_TYPE = "has correct type";

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

  it("detects by aws-cdk-lib dependency", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { "aws-cdk-lib": "^2.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by aws-cdk devDependency", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      devDependencies: { "aws-cdk": "^2.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not a CDK project", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {});

    expect(await detector.detect(tempDir)).toBe(false);
  });
});

describe("DetectorRegistry", () => {
  let registry: DetectorRegistry;
  let tempDir: string;

  beforeEach(async () => {
    registry = new DetectorRegistry();
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("detects multiple project types", async () => {
    // Create a project that is both TypeScript and NestJS
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { "@nestjs/core": "^10.0.0" },
    });
    await fs.writeJson(path.join(tempDir, TSCONFIG_JSON), {});

    const types = await registry.detectAll(tempDir);

    expect(types).toContain(TYPESCRIPT_TYPE);
    expect(types).toContain(NESTJS_TYPE);
  });

  it("expands child types to include parents", () => {
    const expanded = registry.expandAndOrderTypes([EXPO_DEP]);

    expect(expanded).toEqual([TYPESCRIPT_TYPE, EXPO_DEP]);
  });

  it("orders types correctly (typescript first)", () => {
    const expanded = registry.expandAndOrderTypes([
      CDK_TYPE,
      EXPO_DEP,
      NESTJS_TYPE,
    ]);

    expect(expanded[0]).toBe(TYPESCRIPT_TYPE);
    expect(expanded).toContain(EXPO_DEP);
    expect(expanded).toContain(NESTJS_TYPE);
    expect(expanded).toContain(CDK_TYPE);
  });

  it("deduplicates types", () => {
    const expanded = registry.expandAndOrderTypes([TYPESCRIPT_TYPE, EXPO_DEP]);

    // typescript should appear only once
    expect(expanded.filter(t => t === TYPESCRIPT_TYPE).length).toBe(1);
  });

  it("returns empty array for empty input", () => {
    const expanded = registry.expandAndOrderTypes([]);

    expect(expanded).toEqual([]);
  });
});
