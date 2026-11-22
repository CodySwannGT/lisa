/** Detectors for the Harper Fabric, Phaser and Rails stacks. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { HarperFabricDetector } from "../../../src/detection/detectors/harper-fabric.js";
import { PhaserDetector } from "../../../src/detection/detectors/phaser.js";
import { RailsDetector } from "../../../src/detection/detectors/rails.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";
import {
  PACKAGE_JSON,
  TSCONFIG_JSON,
  HARPER_FABRIC_TYPE,
  PHASER_TYPE,
  RAILS_TYPE,
  BIN_RAILS,
  CONFIG_APPLICATION_RB,
  HARPER_APP_DIR,
  HARPER_APP_CONFIG,
  HARPER_APP_SCHEMA,
  HARPER_SCHEMA_BODY,
  HAS_CORRECT_TYPE,
} from "./detectors-fixtures.js";

describe("HarperFabricDetector", () => {
  let detector: HarperFabricDetector;
  let tempDir: string;

  beforeEach(async () => {
    detector = new HarperFabricDetector();
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it(HAS_CORRECT_TYPE, () => {
    expect(detector.type).toBe(HARPER_FABRIC_TYPE);
  });

  it("detects by Harper assets and component config", async () => {
    await fs.ensureDir(path.join(tempDir, HARPER_APP_DIR));
    await fs.writeFile(
      path.join(tempDir, HARPER_APP_CONFIG),
      "graphqlSchema:\njsResource:\nstatic:\n"
    );
    await fs.writeFile(
      path.join(tempDir, HARPER_APP_SCHEMA),
      HARPER_SCHEMA_BODY
    );

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by Harper assets and harperdb dependency", async () => {
    await fs.ensureDir(path.join(tempDir, HARPER_APP_DIR));
    await fs.writeFile(path.join(tempDir, HARPER_APP_CONFIG), "rest: true\n");
    await fs.writeFile(
      path.join(tempDir, HARPER_APP_SCHEMA),
      HARPER_SCHEMA_BODY
    );
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { harperdb: "^4.7.29" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false without schema.graphql", async () => {
    await fs.ensureDir(path.join(tempDir, HARPER_APP_DIR));
    await fs.writeFile(
      path.join(tempDir, HARPER_APP_CONFIG),
      "graphqlSchema:\njsResource:\nstatic:\n"
    );

    expect(await detector.detect(tempDir)).toBe(false);
  });

  it("returns false for generic Harper-shaped files without signals", async () => {
    await fs.ensureDir(path.join(tempDir, HARPER_APP_DIR));
    await fs.writeFile(path.join(tempDir, HARPER_APP_CONFIG), "name: test\n");
    await fs.writeFile(
      path.join(tempDir, HARPER_APP_SCHEMA),
      HARPER_SCHEMA_BODY
    );
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {});

    expect(await detector.detect(tempDir)).toBe(false);
  });
});

describe("PhaserDetector", () => {
  let detector: PhaserDetector;
  let tempDir: string;

  beforeEach(async () => {
    detector = new PhaserDetector();
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it(HAS_CORRECT_TYPE, () => {
    expect(detector.type).toBe(PHASER_TYPE);
  });

  it("detects by phaser dependency", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { phaser: "^4.1.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by phaser devDependency", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      devDependencies: { phaser: "^4.1.0" },
    });

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not a Phaser project", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      dependencies: { typescript: "^5.0.0" },
    });

    expect(await detector.detect(tempDir)).toBe(false);
  });

  it("returns false when no package.json", async () => {
    expect(await detector.detect(tempDir)).toBe(false);
  });
});

describe("RailsDetector", () => {
  let detector: RailsDetector;
  let tempDir: string;

  beforeEach(async () => {
    detector = new RailsDetector();
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it(HAS_CORRECT_TYPE, () => {
    expect(detector.type).toBe(RAILS_TYPE);
  });

  it("detects by bin/rails presence", async () => {
    await fs.ensureDir(path.join(tempDir, "bin"));
    await fs.writeFile(path.join(tempDir, BIN_RAILS), "#!/usr/bin/env ruby");

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("detects by config/application.rb presence", async () => {
    await fs.ensureDir(path.join(tempDir, "config"));
    await fs.writeFile(
      path.join(tempDir, CONFIG_APPLICATION_RB),
      "require_relative 'boot'"
    );

    expect(await detector.detect(tempDir)).toBe(true);
  });

  it("returns false when not a Rails project", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {});

    expect(await detector.detect(tempDir)).toBe(false);
  });

  it("returns false for TypeScript-only project", async () => {
    await fs.writeJson(path.join(tempDir, TSCONFIG_JSON), {});

    expect(await detector.detect(tempDir)).toBe(false);
  });
});
