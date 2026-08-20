/**
 * The arming path for `ui-standards/no-unbound-design-value` (#2807).
 *
 * #2802 shipped the rule installed and severity `"off"`, and arming it needed a
 * severity AND a `typedAxes` option hand-written into `eslint.config.local.ts`.
 * No path existed from `.lisa.config.json` to an ESLint rule option, so a
 * project could declare `design.tokens.axes` in full, install the policy, pass
 * every test, and enforce nothing. A control that is installed, adopted, green
 * and inert is the defect class this repository exists to remove.
 *
 * These tests prove the path end to end rather than asserting that a function
 * exists: a declared axis produces an ARMED rule entry, an undeclared one
 * produces `"off"`, and the managed template actually calls the reader — the
 * last of which is the assertion that catches plumbing nobody wired up.
 * @module tests/unit/config/expo-design-value-arming
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  getDesignValueBindingRule,
  getExpoConfig,
  readTypedAxes,
} from "../../../src/configs/eslint/expo.js";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const RULE = "ui-standards/no-unbound-design-value";
const TEMPLATE = path.join(REPO_ROOT, "expo", "copy-overwrite");

/**
 * Write a `.lisa.config.json` into a throwaway directory.
 * @param body - The config object to serialise.
 * @returns The directory holding it.
 */
const projectWith = (body: unknown): string => {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-design-axes-"));
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    JSON.stringify(body),
    "utf8"
  );
  return root;
};

/**
 * The rule entry a produced config carries, found by key rather than by index.
 * @param config - A flat-config array from the factory.
 * @returns The entry, or undefined when no block declares the rule.
 */
const entryIn = (config: readonly { rules?: unknown }[]): unknown => {
  const block = config.find(
    part =>
      part.rules !== undefined &&
      Object.hasOwn(part.rules as Record<string, unknown>, RULE)
  );
  return block === undefined
    ? undefined
    : (block.rules as Record<string, unknown>)[RULE];
};

/**
 * The rule entry the factory emits for a set of declared axes.
 * @param typedAxes - Axes to arm.
 * @returns The entry, or undefined when the factory emits no such rule.
 */
const entryFor = (typedAxes: readonly string[]): unknown =>
  entryIn(getExpoConfig({ tsconfigRootDir: REPO_ROOT, typedAxes }));

describe("design-value binding: declaring an axis is what arms the rule", () => {
  it("emits an ARMED rule entry for a declared typed axis", () => {
    expect(entryFor(["color"])).toEqual(["error", { typedAxes: ["color"] }]);
  });

  it("carries every declared axis through to the rule option", () => {
    expect(entryFor(["color", "radius"])).toEqual([
      "error",
      { typedAxes: ["color", "radius"] },
    ]);
  });

  it("stays OFF when the project declares no typed axes", () => {
    expect(entryFor([])).toBe("off");
  });

  it("stays OFF when the caller passes no axes at all", () => {
    expect(entryIn(getExpoConfig({ tsconfigRootDir: REPO_ROOT }))).toBe("off");
  });

  it("severity is an error, never a warning — a warning gate never bites", () => {
    const entry = getDesignValueBindingRule(["color"]);
    expect(Array.isArray(entry) ? entry[0] : entry).toBe("error");
  });

  it("does not alias the caller's array into the rule option", () => {
    const declared = ["color"];
    const entry = getDesignValueBindingRule(declared) as [
      string,
      { typedAxes: string[] },
    ];
    expect(entry[1].typedAxes).not.toBe(declared);
    expect(entry[1].typedAxes).toEqual(["color"]);
  });
});

describe("design-value binding: reading design.tokens.axes", () => {
  it("reads the axes a project declares", () => {
    const root = projectWith({ design: { tokens: { axes: ["color"] } } });
    expect(readTypedAxes(root)).toEqual(["color"]);
  });

  it("returns no axes when the project has no .lisa.config.json", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-design-none-"));
    expect(readTypedAxes(root)).toEqual([]);
  });

  it("returns no axes when the project declares no design block", () => {
    const root = projectWith({ tracker: "github" });
    expect(readTypedAxes(root)).toEqual([]);
  });

  /**
   * A malformed declaration must be LOUD. Coercing it to `[]` would disarm the
   * rule silently, which is the exact failure #2807 is about, reproduced one
   * layer down.
   */
  it("refuses a malformed axes declaration instead of silently disarming", () => {
    const root = projectWith({ design: { tokens: { axes: "color" } } });
    expect(() => readTypedAxes(root)).toThrow(/design\.tokens\.axes/u);
  });

  it("refuses a non-string axis entry", () => {
    const root = projectWith({ design: { tokens: { axes: [1] } } });
    expect(() => readTypedAxes(root)).toThrow(/design\.tokens\.axes/u);
  });
});

describe("design-value binding: the managed template wires the path", () => {
  /**
   * The plumbing existing is not the plumbing being USED. Without this
   * assertion the reader and the factory option could both ship, both be
   * tested, and no host project would ever arm the rule — which is #2807
   * verbatim.
   */
  it("expo eslint.config.ts reads the axes and passes them to the factory", () => {
    const src = readFileSync(path.join(TEMPLATE, "eslint.config.ts"), "utf8");
    // The CALL, not the word. Both names appear in the pre-fix file's comment
    // explaining the option a reader was expected to hand-write, so asserting
    // the bare token would pass against the very state this proves is gone.
    expect(src).toContain("readTypedAxes(__dirname)");
    expect(src).toContain("typedAxes,");
  });

  it("the copied factory template arms the rule from the option too", () => {
    const src = readFileSync(path.join(TEMPLATE, "eslint.expo.ts"), "utf8");
    expect(src).toContain("getDesignValueBindingRule(typedAxes)");
  });
});

describe("design-value binding: the armed rule actually reports", () => {
  /**
   * The end of the chain. Everything above proves an option reaches a config;
   * this proves the config a declared axis produces makes the rule FIRE on a
   * raw literal, and stay silent without it. If this passes while the rule is
   * inert, nothing else in this file matters.
   */
  /**
   * Lint a snippet through the entry a declared axis set produces.
   * @param typedAxes - Axes the project declares typed.
   * @param code - Source to lint.
   * @returns ESLint's messages for that source.
   */
  const lintWith = (typedAxes: readonly string[], code: string): unknown[] => {
    const { Linter } = require("eslint") as {
      Linter: new () => {
        verify: (code: string, config: unknown, filename?: string) => unknown[];
      };
    };
    const uiStandards = require(
      path.join(REPO_ROOT, "eslint-plugin-ui-standards", "index.js")
    ) as { rules: Record<string, unknown> };
    return new Linter().verify(code, [
      {
        plugins: { "ui-standards": uiStandards },
        rules: { [RULE]: getDesignValueBindingRule(typedAxes) },
      },
    ]);
  };

  const LITERAL = "const s = { backgroundColor: '#3A7BD5' };";

  it("reports a raw literal in a declared typed axis", () => {
    expect(lintWith(["color"], LITERAL)).toHaveLength(1);
  });

  it("reports nothing on the same literal with no axis declared", () => {
    expect(lintWith([], LITERAL)).toHaveLength(0);
  });
});
