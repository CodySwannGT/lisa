/**
 * `dependencies.humanSignOff` is an optional closed-vocabulary setting whose
 * absence and invalid values resolve to the `humanGate.mode` default:
 * `"none"` under the default `"access-only"` mode (CodySwannGT/lisa#4687),
 * `"default"` under `"strict"`.
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
  validateProjectConfig,
  type ProjectConfig,
} from "../../../src/core/project-config.js";
import {
  DEFAULT_DEPENDENCY_HUMAN_SIGN_OFF,
  DEPENDENCY_HUMAN_SIGN_OFF_VALUES,
  STRICT_DEPENDENCY_HUMAN_SIGN_OFF,
  defaultDependencyHumanSignOff,
  dependencySettingsWarning,
  resolveDependencySettings,
  validateDependenciesConfig,
} from "../../../src/core/project-config-dependencies.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const SOURCE = ".lisa.config.json";
const TREATED_AS_DEFAULT = 'treated as "default"';

describe("dependencies.humanSignOff vocabulary", () => {
  it("is the closed pair default | none, defaulting by humanGate.mode", () => {
    expect(DEPENDENCY_HUMAN_SIGN_OFF_VALUES).toEqual(["default", "none"]);
    expect(DEFAULT_DEPENDENCY_HUMAN_SIGN_OFF).toBe("none");
    expect(STRICT_DEPENDENCY_HUMAN_SIGN_OFF).toBe("default");
    expect(defaultDependencyHumanSignOff("access-only")).toBe("none");
    expect(defaultDependencyHumanSignOff("strict")).toBe("default");
  });
});

describe("resolveDependencySettings", () => {
  it("resolves an absent block to the access-only default, undeclared and valid", () => {
    expect(resolveDependencySettings({})).toEqual({
      humanSignOff: "none",
      declared: false,
    });
  });

  it("resolves an absent key inside a present block to the default", () => {
    expect(resolveDependencySettings({ dependencies: {} })).toEqual({
      humanSignOff: "none",
      declared: false,
    });
  });

  it("resolves an absent key to default under humanGate.mode strict", () => {
    expect(
      resolveDependencySettings(configOf({ humanGate: { mode: "strict" } }))
    ).toEqual({ humanSignOff: "default", declared: false });
  });

  it.each(["default", "none"] as const)(
    "honours a declared %s",
    humanSignOff => {
      expect(
        resolveDependencySettings({ dependencies: { humanSignOff } })
      ).toEqual({ humanSignOff, declared: true });
    }
  );

  it.each([
    ["Default", "default"],
    [" NONE ", "none"],
    ["none\n", "none"],
  ] as const)(
    "reads the declared %j case- and whitespace-insensitively as %s",
    (humanSignOff, expected) => {
      expect(
        resolveDependencySettings({ dependencies: { humanSignOff } })
      ).toEqual({ humanSignOff: expected, declared: true });
      expect(
        dependencySettingsWarning({ dependencies: { humanSignOff } })
      ).toBeUndefined();
    }
  );

  it.each([["sometimes"], ["no ne"], [""], [false], [0], [null], [["none"]]])(
    "fails the invalid value %j safe, to default, and reports what it rejected",
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
    expect(warning).toContain(TREATED_AS_DEFAULT);
  });

  it("still warns about a rejected value under the default access-only mode", () => {
    const config = configOf({ dependencies: { humanSignOff: "Nope" } });
    expect(resolveDependencySettings(config).humanSignOff).toBe("default");
    const warning = dependencySettingsWarning(config);
    expect(warning).toContain('"Nope"');
    expect(warning).toContain(TREATED_AS_DEFAULT);
  });

  it("names the strict fallback under humanGate.mode strict", () => {
    const warning = dependencySettingsWarning(
      configOf({
        humanGate: { mode: "strict" },
        dependencies: { humanSignOff: "sometimes" },
      })
    );

    expect(warning).toContain('treated as "default"');
    expect(warning).toContain("sign-off stays required");
  });

  it("names a dependencies block that is not an object, and the fallback", () => {
    const warning = dependencySettingsWarning(
      configOf({ dependencies: "none" })
    );

    expect(warning).toContain("Invalid dependencies in .lisa.config.json");
    expect(warning).toContain('"none" is not an object');
    expect(warning).toContain(TREATED_AS_DEFAULT);
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

  it.each([["none"], [null], [["none"]], [false], [7]])(
    "degrades a non-object block %j instead of throwing",
    value => {
      expect(validateDependenciesConfig(value, SOURCE)).toEqual({
        rejectedBlock: value,
      });
    }
  );
});

describe("resolveDependencySettings with a non-object block", () => {
  it("fails safe to default and records the block as what was rejected", () => {
    expect(
      resolveDependencySettings(configOf({ dependencies: "none" }))
    ).toEqual({
      humanSignOff: "default",
      declared: true,
      rejected: '"none"',
      rejectedAt: "dependencies",
    });
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

  it("reads a non-object dependencies block without failing", async () => {
    await fs.writeJson(path.join(tempDir, PROJECT_CONFIG_FILENAME), {
      dependencies: ["none"],
    });

    const config = await readProjectConfig(tempDir);

    expect(resolveDependencySettings(config).humanSignOff).toBe("default");
    expect(dependencySettingsWarning(config)).toContain("is not an object");
  });
});

/**
 * Run a raw config shape through the real validator, as `readProjectConfig`
 * does, so a test can hand the resolver a block of any shape.
 * @param raw - Untrusted parsed JSON
 * @returns The validated project config
 */
function configOf(raw: Record<string, unknown>): ProjectConfig {
  return validateProjectConfig(raw, SOURCE);
}
