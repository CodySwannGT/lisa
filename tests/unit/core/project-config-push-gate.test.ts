/**
 * `pushGate.buildOnce` (CodySwannGT/lisa#4595) and `pushGate.cache`
 * (CodySwannGT/lisa#4594, read by `lisa check` in #4601) in `.lisa.config.json`:
 * off by default, a boolean when present, and refused — never defaulted —
 * otherwise.
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

  it("keeps an explicit cache boolean beside buildOnce", () => {
    expect(
      validateProjectConfig(
        { pushGate: { buildOnce: true, cache: true } },
        CONFIG_PATH
      ).pushGate
    ).toEqual({ buildOnce: true, cache: true });
    expect(
      validateProjectConfig({ pushGate: { cache: false } }, CONFIG_PATH)
        .pushGate
    ).toEqual({ cache: false });
  });

  it("refuses a non-boolean cache", () => {
    expect(() =>
      validateProjectConfig({ pushGate: { cache: "on" } }, CONFIG_PATH)
    ).toThrow(/Invalid pushGate\.cache in fixture\.json/u);
  });

  it("refuses a non-object block and a non-boolean buildOnce", () => {
    expect(() =>
      validateProjectConfig({ pushGate: true }, CONFIG_PATH)
    ).toThrow(/Invalid pushGate in fixture\.json/u);
    expect(() =>
      validateProjectConfig({ pushGate: { buildOnce: "yes" } }, CONFIG_PATH)
    ).toThrow(/Invalid pushGate\.buildOnce in fixture\.json/u);
  });

  it("keeps an explicit admission boolean beside buildOnce", () => {
    expect(
      validateProjectConfig(
        { pushGate: { buildOnce: true, admission: true } },
        CONFIG_PATH
      ).pushGate
    ).toEqual({ buildOnce: true, admission: true });
    expect(
      validateProjectConfig({ pushGate: { admission: false } }, CONFIG_PATH)
        .pushGate
    ).toEqual({ admission: false });
  });

  it("refuses a non-boolean admission (CodySwannGT/lisa#4596)", () => {
    expect(() =>
      validateProjectConfig({ pushGate: { admission: "on" } }, CONFIG_PATH)
    ).toThrow(/Invalid pushGate\.admission in fixture\.json/u);
  });
});
