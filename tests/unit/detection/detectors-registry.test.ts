/** The detector registry and the published project type templates. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { PROJECT_TYPE_ORDER } from "../../../src/core/config.js";
import { DetectorRegistry } from "../../../src/detection/index.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";
import {
  PACKAGE_JSON,
  TSCONFIG_JSON,
  TYPESCRIPT_TYPE,
  EXPO_DEP,
  NESTJS_TYPE,
  CDK_TYPE,
  HARPER_FABRIC_TYPE,
  PHASER_TYPE,
  RAILS_TYPE,
  BIN_RAILS,
} from "./detectors-fixtures.js";

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

  it("expands Harper/Fabric to include TypeScript parent", () => {
    const expanded = registry.expandAndOrderTypes([HARPER_FABRIC_TYPE]);

    expect(expanded).toEqual([TYPESCRIPT_TYPE, HARPER_FABRIC_TYPE]);
  });

  it("expands Phaser to include TypeScript parent", () => {
    const expanded = registry.expandAndOrderTypes([PHASER_TYPE]);

    expect(expanded).toEqual([TYPESCRIPT_TYPE, PHASER_TYPE]);
  });

  it("detects Phaser project", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { phaser: "^4.1.0" },
    });

    const types = await registry.detectAll(tempDir);

    expect(types).toContain(PHASER_TYPE);
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

  it("expands rails without parent", () => {
    const expanded = registry.expandAndOrderTypes([RAILS_TYPE]);

    expect(expanded).toEqual([RAILS_TYPE]);
  });

  it("detects Rails project", async () => {
    await fs.ensureDir(path.join(tempDir, "bin"));
    await fs.writeFile(path.join(tempDir, BIN_RAILS), "#!/usr/bin/env ruby");

    const types = await registry.detectAll(tempDir);

    expect(types).toContain(RAILS_TYPE);
  });
});

describe("published project type templates", () => {
  it("includes every supported project type template directory in package files", async () => {
    const packageJson = await fs.readJson(
      path.join(process.cwd(), PACKAGE_JSON)
    );
    const packageFiles = new Set(packageJson.files);

    for (const projectType of PROJECT_TYPE_ORDER) {
      expect(await fs.pathExists(path.join(process.cwd(), projectType))).toBe(
        true
      );
      expect(packageFiles.has(projectType)).toBe(true);
    }
  });
});
