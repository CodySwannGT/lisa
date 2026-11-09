/**
 * `dependencies.humanSignOff` is an optional closed-vocabulary setting whose
 * absence keeps today's behavior and whose invalid values degrade to it.
 *
 * The degrade-not-throw contract is deliberate: the setting only changes what
 * the governed prose asks an agent to do, so a typo must never stop `lisa
 * apply` — but it must be reported, because a project that meant `"none"` and
 * silently got `"default"` would keep stopping for sign-off with no symptom.
 * @module tests/unit/core/project-config-dependencies
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_CONFIG_FILENAME,
  readProjectConfig,
} from "../../../src/core/project-config.js";
import {
  DEFAULT_DEPENDENCY_HUMAN_SIGN_OFF,
  DEPENDENCY_HUMAN_SIGN_OFF_VALUES,
  dependencySettingsWarning,
  resolveDependencySettings,
  validateDependenciesConfig,
} from "../../../src/core/project-config-dependencies.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const SOURCE = ".lisa.config.json";

describe("dependencies.humanSignOff vocabulary", () => {
  it("is the closed pair default | none, defaulting to default", () => {
    expect(DEPENDENCY_HUMAN_SIGN_OFF_VALUES).toEqual(["default", "none"]);
    expect(DEFAULT_DEPENDENCY_HUMAN_SIGN_OFF).toBe("default");
  });
});

describe("resolveDependencySettings", () => {
  it("resolves an absent block to the default, undeclared and valid", () => {
    expect(resolveDependencySettings({})).toEqual({
      humanSignOff: "default",
      declared: false,
    });
  });

  it("resolves an absent key inside a present block to the default", () => {
    expect(resolveDependencySettings({ dependencies: {} })).toEqual({
      humanSignOff: "default",
      declared: false,
    });
  });

  it.each(["default", "none"] as const)(
    "honours a declared %s",
    humanSignOff => {
      expect(
        resolveDependencySettings({ dependencies: { humanSignOff } })
      ).toEqual({ humanSignOff, declared: true });
    }
  );

  it.each([["sometimes"], ["NONE"], [""], [false], [0], [null], [["none"]]])(
    "treats the invalid value %j as default and reports what it rejected",
    value => {
      expect(
        resolveDependencySettings({ dependencies: { humanSignOff: value } })
      ).toEqual({
        humanSignOff: "default",
        declared: true,
        rejected: JSON.stringify(value),
      });
    }
  );
});

describe("dependencySettingsWarning", () => {
  it("is silent for absent and valid values", () => {
    expect(dependencySettingsWarning({})).toBeUndefined();
    expect(
      dependencySettingsWarning({ dependencies: { humanSignOff: "none" } })
    ).toBeUndefined();
  });

  it("names the rejected value, the accepted vocabulary, and the fallback", () => {
    const warning = dependencySettingsWarning({
      dependencies: { humanSignOff: "sometimes" },
    });

    expect(warning).toContain("dependencies.humanSignOff");
    expect(warning).toContain('"sometimes"');
    expect(warning).toContain('"default" | "none"');
    expect(warning).toContain('treated as "default"');
  });
});

describe("validateDependenciesConfig", () => {
  it("preserves absence", () => {
    expect(validateDependenciesConfig(undefined, SOURCE)).toBeUndefined();
  });

  it("keeps an invalid humanSignOff value instead of throwing", () => {
    expect(
      validateDependenciesConfig({ humanSignOff: "sometimes" }, SOURCE)
    ).toEqual({ humanSignOff: "sometimes" });
  });

  it("rejects a block that is not an object, like every other config block", () => {
    expect(() => validateDependenciesConfig("none", SOURCE)).toThrow(
      /Invalid dependencies in \.lisa\.config\.json: expected an object/u
    );
  });
});

describe("readProjectConfig carries the dependencies block", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("reads a declared none and an invalid value without failing", async () => {
    await fs.writeJson(path.join(tempDir, PROJECT_CONFIG_FILENAME), {
      dependencies: { humanSignOff: "none" },
    });
    expect(
      resolveDependencySettings(await readProjectConfig(tempDir)).humanSignOff
    ).toBe("none");

    await fs.writeJson(path.join(tempDir, PROJECT_CONFIG_FILENAME), {
      dependencies: { humanSignOff: "sometimes" },
    });
    const config = await readProjectConfig(tempDir);
    expect(resolveDependencySettings(config)).toEqual({
      humanSignOff: "default",
      declared: true,
      rejected: '"sometimes"',
    });
  });
});
