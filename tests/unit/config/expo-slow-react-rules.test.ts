/**
 * Expo's lint:slow runs the two React rules it was created for
 * (CodySwannGT/lisa#4507).
 *
 * 0b58fe96a4 moved `react-compiler/react-compiler` and
 * `react-hooks/static-components` out of the main Expo lint, where they are
 * "off" for speed, into lint:slow as "error". 74981f5be1 later rewrote the slow
 * config into the shared `getSlowConfig` with only its import rules, and both
 * React rules stopped running anywhere. These cases run the real ESLint from
 * the lockfile, through the Expo slow factory, over a type-aware fixture with
 * one violation of each rule, and pin both rules so they cannot quietly fall
 * out again.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { ESLint, type Linter } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getExpoSlowConfig } from "../../../src/configs/eslint/slow-expo.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";

// Type-aware parsing of a fresh program: measured at about 3s on a quiet box.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const RULES = [
  "react-compiler/react-compiler",
  "react-hooks/static-components",
] as const;

/** One component per rule, each breaking only that rule. */
const FIXTURES: Readonly<Record<(typeof RULES)[number], string>> = {
  "react-compiler/react-compiler": [
    "export function Tally(props: { count: number }) {",
    "  props.count = 1;",
    "  return <p>{props.count}</p>;",
    "}",
    "",
  ].join("\n"),
  "react-hooks/static-components": [
    "export function Parent() {",
    "  function Child() {",
    "    return <p>child</p>;",
    "  }",
    "  return <Child />;",
    "}",
    "",
  ].join("\n"),
};

const CLEAN = [
  "function Child() {",
  "  return <p>child</p>;",
  "}",
  "export function Parent(props: { items: readonly string[] }) {",
  "  return (",
  "    <div>",
  "      <Child />",
  "      {props.items.length}",
  "    </div>",
  "  );",
  "}",
  "",
].join("\n");

let root = "";

beforeAll(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "lisa-expo-slow-"));
  fs.writeFileSync(
    path.join(root, "tsconfig.eslint.json"),
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        strict: true,
        module: "esnext",
        moduleResolution: "bundler",
        target: "es2022",
        skipLibCheck: true,
        noEmit: true,
      },
      include: ["src/**/*.tsx"],
    })
  );
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "src", "compiler.tsx"),
    FIXTURES["react-compiler/react-compiler"]
  );
  fs.writeFileSync(
    path.join(root, "src", "static.tsx"),
    FIXTURES["react-hooks/static-components"]
  );
  fs.writeFileSync(path.join(root, "src", "clean.tsx"), CLEAN);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Lint one fixture file with the Expo slow config, as lint:slow does.
 * @param file - File name under src/
 * @returns The rule ids ESLint reported, at error severity
 */
async function slowErrors(file: string): Promise<string[]> {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    // lint:slow runs from the project root, which is where the parser looks
    // for tsconfig.eslint.json; this process runs from Lisa's root instead.
    overrideConfig: [
      ...getExpoSlowConfig(),
      { languageOptions: { parserOptions: { tsconfigRootDir: root } } },
    ],
  });
  const [result] = await eslint.lintFiles([path.join(root, "src", file)]);
  if (result === undefined) throw new Error("ESLint returned no result");
  return result.messages
    .filter(message => message.severity === 2)
    .map(message => message.ruleId ?? `fatal: ${message.message}`);
}

describe("Expo lint:slow React rules, through the real ESLint", () => {
  it.each([
    ["react-compiler/react-compiler", "compiler.tsx"],
    ["react-hooks/static-components", "static.tsx"],
  ] as const)("flags a %s violation", async (rule, file) => {
    expect(await slowErrors(file)).toContain(rule);
  });

  it("passes a component that breaks neither rule", async () => {
    expect(await slowErrors("clean.tsx")).toEqual([]);
  });
});

describe("the Expo slow config keeps both rules", () => {
  it.each(RULES)("sets %s to error for TSX", rule => {
    const entry = getExpoSlowConfig().find(
      (config: Linter.Config) => config.rules?.[rule] !== undefined
    );
    expect(entry?.rules?.[rule]).toBe("error");
    expect(entry?.files).toEqual(expect.arrayContaining(["**/*.tsx"]));
  });

  it("is what the managed Expo eslint.slow.config.ts builds", () => {
    const template = fs.readFileSync(
      path.join(REPO_ROOT, "expo/copy-overwrite/eslint.slow.config.ts"),
      "utf8"
    );
    expect(template).toContain(
      'import { getExpoSlowConfig } from "@codyswann/lisa/eslint/slow-expo";'
    );
    expect(template).toMatch(/getExpoSlowConfig\(\{/);
  });
});
