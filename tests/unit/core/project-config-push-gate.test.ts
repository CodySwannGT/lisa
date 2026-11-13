/**
 * `pushGate.buildOnce` in `.lisa.config.json` (CodySwannGT/lisa#4595): off by
 * default, a boolean when present, and refused — never defaulted — otherwise.
 */
import { describe, expect, it } from "vitest";

import {
  validateProjectConfig,
  type ProjectConfig,
} from "../../../src/core/project-config.js";

const CONFIG_PATH = "fixture.json";

describe("ProjectConfig pushGate", () => {
  it("is absent when not configured", () => {
    expect(validateProjectConfig({}, CONFIG_PATH).pushGate).toBeUndefined();
  });

  it("keeps an explicit buildOnce boolean", () => {
    const on: ProjectConfig = { pushGate: { buildOnce: true } };
    expect(validateProjectConfig(on, CONFIG_PATH).pushGate).toEqual({
      buildOnce: true,
    });
    expect(
      validateProjectConfig({ pushGate: { buildOnce: false } }, CONFIG_PATH)
        .pushGate
    ).toEqual({ buildOnce: false });
  });

  it("treats an empty block as off", () => {
    expect(
      validateProjectConfig({ pushGate: {} }, CONFIG_PATH).pushGate
    ).toEqual({});
  });

  it("refuses a non-object block and a non-boolean buildOnce", () => {
    expect(() =>
      validateProjectConfig({ pushGate: true }, CONFIG_PATH)
    ).toThrow(/Invalid pushGate in fixture\.json/u);
    expect(() =>
      validateProjectConfig({ pushGate: { buildOnce: "yes" } }, CONFIG_PATH)
    ).toThrow(/Invalid pushGate\.buildOnce in fixture\.json/u);
  });
});
