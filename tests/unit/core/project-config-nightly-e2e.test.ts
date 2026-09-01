/**
 * RED public-schema contract for configurable nightly-E2E tracking.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_CONFIG_FILENAME,
  readProjectConfig,
  validateProjectConfig,
  writeProjectConfig,
  type ProjectConfig,
} from "../../../src/core/project-config.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const DESTINATIONS = ["github", "sentry", "jira", "linear", "none"] as const;
const CONFIG_PATH = "fixture.json";

/** Compile-time proof that the requested field is part of ProjectConfig. */
const TYPED_CONFIG: ProjectConfig = {
  nightlyE2E: { tracking: { destination: "linear" } },
};

/**
 * Build the public configuration fragment for one destination.
 * @param destination - Selected tracking destination
 * @returns Public project-config fragment
 */
function tracking(destination: (typeof DESTINATIONS)[number]): ProjectConfig {
  return { nightlyE2E: { tracking: { destination } } };
}

describe("ProjectConfig nightlyE2E tracking surface", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(projectDir);
  });

  it("exposes the public destination on the typed schema", () => {
    expect(TYPED_CONFIG).toEqual(tracking("linear"));
  });

  it.each(DESTINATIONS)("validates and reads exact %s", async destination => {
    const raw = tracking(destination);
    expect(validateProjectConfig(raw, CONFIG_PATH)).toEqual(raw);
    await fs.writeJson(path.join(projectDir, PROJECT_CONFIG_FILENAME), raw);
    await expect(readProjectConfig(projectDir)).resolves.toEqual(raw);
  });

  it.each(["GitHub", "gitlab", " linear ", "", 17, null])(
    "rejects an invalid explicit destination %j at the core schema",
    destination => {
      const raw = { nightlyE2E: { tracking: { destination } } };
      expect(() => validateProjectConfig(raw, CONFIG_PATH)).toThrow(
        /nightlyE2E\.tracking\.destination.*github.*sentry.*jira.*linear.*none/i
      );
    }
  );

  it.each([null, [], "linear", { tracking: null }, { tracking: [] }])(
    "rejects a malformed nightlyE2E block %j",
    nightlyE2E => {
      expect(() => validateProjectConfig({ nightlyE2E }, CONFIG_PATH)).toThrow(
        /nightlyE2E.*object|tracking.*object/i
      );
    }
  );

  it("survives the validated read-write seam used by full apply", async () => {
    const config = {
      harness: "codex",
      nightlyE2E: { tracking: { destination: "jira" } },
      futureField: { preserve: true },
    };
    await fs.writeJson(path.join(projectDir, PROJECT_CONFIG_FILENAME), config);
    const validated = await readProjectConfig(projectDir);
    await writeProjectConfig(projectDir, validated);

    const written = await fs.readJson(
      path.join(projectDir, PROJECT_CONFIG_FILENAME)
    );
    expect(written).toEqual(config);
  });
});
