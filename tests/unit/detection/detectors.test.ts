import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import { TypeScriptDetector } from "../../../src/detection/detectors/typescript.js";
import { ExpoDetector } from "../../../src/detection/detectors/expo.js";
import { NestJSDetector } from "../../../src/detection/detectors/nestjs.js";
import { CDKDetector } from "../../../src/detection/detectors/cdk.js";
import { DetectorRegistry } from "../../../src/detection/index.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

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

  it("has correct type", () => {
    expect(detector.type).toBe("typescript");
  });

  it("detects by tsconfig.json presence", async () => {
    await fs.writeJson(path.join(tempDir, "tsconfig.json"), {});

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by typescript dependency", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {
      dependencies: { typescript: "^5.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by typescript devDependency", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {
      devDependencies: { typescript: "^5.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not a TypeScript project", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {});

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

  it("has correct type", () => {
    expect(detector.type).toBe("expo");
  });

  it("detects by app.json presence", async () => {
    await fs.writeJson(path.join(tempDir, "app.json"), { expo: {} });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by eas.json presence", async () => {
    await fs.writeJson(path.join(tempDir, "eas.json"), {});

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by expo dependency", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {
      dependencies: { expo: "^50.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not an Expo project", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {});

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

  it("has correct type", () => {
    expect(detector.type).toBe("nestjs");
  });

  it("detects by nest-cli.json presence", async () => {
    await fs.writeJson(path.join(tempDir, "nest-cli.json"), {});

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by @nestjs/core dependency", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {
      dependencies: { "@nestjs/core": "^10.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by @nestjs/* devDependency", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {
      devDependencies: { "@nestjs/testing": "^10.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not a NestJS project", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {});

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

  it("has correct type", () => {
    expect(detector.type).toBe("cdk");
  });

  it("detects by cdk.json presence", async () => {
    await fs.writeJson(path.join(tempDir, "cdk.json"), {});

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by aws-cdk-lib dependency", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {
      dependencies: { "aws-cdk-lib": "^2.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by aws-cdk devDependency", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {
      devDependencies: { "aws-cdk": "^2.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not a CDK project", async () => {
    await fs.writeJson(path.join(tempDir, "package.json"), {});

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
    await fs.writeJson(path.join(tempDir, "package.json"), {
      dependencies: { "@nestjs/core": "^10.0.0" },
    });
    await fs.writeJson(path.join(tempDir, "tsconfig.json"), {});

    const types = await registry.detectAll(tempDir);

    expect(types).toContain("typescript");
    expect(types).toContain("nestjs");
  });

  it("expands child types to include parents", () => {
    const expanded = registry.expandAndOrderTypes(["expo"]);

    expect(expanded).toEqual(["typescript", "expo"]);
  });

  it("orders types correctly (typescript first)", () => {
    const expanded = registry.expandAndOrderTypes(["cdk", "expo", "nestjs"]);

    expect(expanded[0]).toBe("typescript");
    expect(expanded).toContain("expo");
    expect(expanded).toContain("nestjs");
    expect(expanded).toContain("cdk");
  });

  it("deduplicates types", () => {
    const expanded = registry.expandAndOrderTypes(["typescript", "expo"]);

    // typescript should appear only once
    expect(expanded.filter(t => t === "typescript").length).toBe(1);
  });

  it("returns empty array for empty input", () => {
    const expanded = registry.expandAndOrderTypes([]);

    expect(expanded).toEqual([]);
  });
});
