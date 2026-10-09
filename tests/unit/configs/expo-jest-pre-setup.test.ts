import { readFileSync } from "node:fs";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const MANAGED_SETUP = readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../../expo/copy-overwrite/jest.setup.pre.js"
  ),
  "utf8"
);

/** Native module constants contract used by actual React Native initialization. */
interface NativeModuleMock {
  readonly getConstants: () => Record<string, unknown>;
}

/**
 * Execute only Lisa's managed setup, isolating globals and project imports.
 * @param registry - The project-owned mock registry, never executed as code
 * @returns Actual TurboModule resolver installed by the managed setup
 */
function loadSetup(registry: Readonly<Record<string, unknown>>) {
  const globals: Record<string, unknown> = {
    process: { env: {}, on: vi.fn() },
    jest: { fn: vi.fn },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    require: (specifier: string) => {
      if (specifier === "./jest.config.react-native-mock") return registry;
      if (specifier === "./jest.setup.pre.local") return {};
      throw new Error(`Unexpected managed setup dependency: ${specifier}`);
    },
  };
  globals["global"] = globals;
  // eslint-disable-next-line sonarjs/code-eval -- Execute repository-owned setup only in an isolated VM; project imports are inert fixtures.
  runInNewContext(MANAGED_SETUP, globals, { timeout: 1000 });
  expect(globals["__turboModuleProxy"]).toBeTypeOf("function");
  return globals["__turboModuleProxy"] as (name: string) => unknown;
}

describe("Expo managed Jest native module fallbacks", () => {
  it("supplies the standard SourceCode and empty native UIManager unit seams", () => {
    const resolve = loadSetup(Object.freeze({}));
    const sourceCode = resolve("SourceCode") as NativeModuleMock;
    const uiManager = resolve("UIManager") as NativeModuleMock;
    expect(sourceCode.getConstants()).toEqual({ scriptURL: null });
    expect(uiManager.getConstants()).toEqual({});
    expect(resolve("ProjectCamera")).toBeNull();
  });

  it("keeps frozen project modules and every property descriptor unchanged", () => {
    const sourceCode = {
      getConstants: () => ({ scriptURL: "custom://bundle" }),
    };
    const uiManager = { getConstants: () => ({ nativeView: "project-view" }) };
    const camera = { cameraId: "preserve-me" };
    const registry = Object.freeze({
      SourceCode: sourceCode,
      UIManager: uiManager,
      ProjectCamera: camera,
    });
    const descriptors = Object.getOwnPropertyDescriptors(registry);
    const resolve = loadSetup(registry);
    expect(resolve("SourceCode")).toBe(sourceCode);
    expect(resolve("UIManager")).toBe(uiManager);
    expect(resolve("ProjectCamera")).toBe(camera);
    expect(Object.getOwnPropertyDescriptors(registry)).toEqual(descriptors);
  });

  it.each([null, undefined])(
    "uses defaults when an older registry has an absent %s module value",
    value => {
      const registry = Object.freeze({ SourceCode: value, UIManager: value });
      const resolve = loadSetup(registry);
      expect(
        (resolve("SourceCode") as NativeModuleMock).getConstants()
      ).toEqual({
        scriptURL: null,
      });
      expect((resolve("UIManager") as NativeModuleMock).getConstants()).toEqual(
        {}
      );
      expect(registry.SourceCode).toBe(value);
      expect(registry.UIManager).toBe(value);
    }
  );

  it("does not invent native modules from fallback object prototype properties", () => {
    const resolve = loadSetup(Object.freeze(Object.create(null)));
    expect(resolve("constructor")).toBeNull();
    expect(resolve("toString")).toBeNull();
    expect(resolve("missing")).toBeNull();
  });
});
