/**
 * Regression tests for CodySwannGT/lisa#2467.
 *
 * A host project pinned js-yaml 5, whose ESM build has no default export. Every
 * Lisa module did `import yaml from "js-yaml"`, so the entire CLI died at link
 * time with a SyntaxError — and the postinstall bootstrap threw that stack
 * trace away, so the repo silently stopped receiving template updates.
 */
import { describe, expect, it } from "vitest";
import {
  IncompatibleYamlError,
  loadYaml,
  probeYamlRuntime,
  resolveYamlApi,
} from "../../../src/utils/yaml.js";

/** The js-yaml 5.x ESM shape: named exports only, no `default`. */
const V5_NAMESPACE = {
  load: (source: string): unknown => ({ v5: source }),
  dump: (): string => "",
  loadAll: (): unknown[] => [],
};

/** The js-yaml 4.x shape as Node presents it: named exports plus interop default. */
const V4_NAMESPACE = {
  load: (source: string): unknown => ({ v4: source }),
  safeLoad: (): unknown => undefined,
  default: { load: (source: string): unknown => ({ v4default: source }) },
};

/** A CJS-only build where everything hangs off the interop default. */
const CJS_INTEROP_NAMESPACE = {
  default: { load: (source: string): unknown => ({ cjs: source }) },
};

describe("resolveYamlApi", () => {
  it("drives the js-yaml 5.x named-export shape", () => {
    expect(resolveYamlApi(V5_NAMESPACE).load("a")).toEqual({ v5: "a" });
  });

  it("prefers the named export over the interop default on js-yaml 4.x", () => {
    expect(resolveYamlApi(V4_NAMESPACE).load("a")).toEqual({ v4: "a" });
  });

  it("falls back to the interop default for a CJS-only build", () => {
    expect(resolveYamlApi(CJS_INTEROP_NAMESPACE).load("a")).toEqual({
      cjs: "a",
    });
  });

  it("rejects a module exposing no callable load", () => {
    expect(() => resolveYamlApi({ dump: (): string => "" })).toThrow(
      IncompatibleYamlError
    );
  });

  it("names the problem in plain language instead of a stack trace", () => {
    let message = "";
    try {
      resolveYamlApi({ parse: (): unknown => undefined });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    // An operator with no other context must learn: what broke, that it is a
    // pin, and what to do next.
    expect(message).toContain("js-yaml");
    expect(message).toContain("load()");
    expect(message).toContain("package.json");
    expect(message).toContain("lisa doctor");
    expect(message).toContain("parse");
  });

  it("reports a non-object resolution rather than throwing a TypeError", () => {
    expect(() => resolveYamlApi(undefined)).toThrow(IncompatibleYamlError);
    expect(() => resolveYamlApi("js-yaml")).toThrow(IncompatibleYamlError);
  });
});

describe("loadYaml", () => {
  it("parses YAML through whichever js-yaml the install resolved", () => {
    expect(loadYaml("name: lisa\ncount: 2\n")).toEqual({
      name: "lisa",
      count: 2,
    });
  });
});

describe("probeYamlRuntime", () => {
  it("returns null when the resolved js-yaml is usable", () => {
    expect(probeYamlRuntime()).toBeNull();
  });
});
