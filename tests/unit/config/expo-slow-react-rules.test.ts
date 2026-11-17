/**
 * Expo's React Compiler checks keep running (CodySwannGT/lisa#4507, #4931).
 *
 * 0b58fe96a4 moved `react-compiler/react-compiler` and
 * `react-hooks/static-components` out of the main Expo lint, where they are
 * "off" for speed, into lint:slow as "error". 74981f5be1 later rewrote the slow
 * config into the shared `getSlowConfig` with only its import rules, and both
 * React rules stopped running anywhere. #4931 then replaced
 * `react-compiler/react-compiler` (eslint-plugin-react-compiler pins zod 3,
 * which gets no fix for GHSA-mrhx-c7xc-m3w5) with the per-diagnostic React
 * Compiler rules eslint-plugin-react-hooks 7 ships, enforced in the main Expo
 * lint. These cases run the real ESLint from the lockfile over type-aware
 * fixtures and pin every rule so none can quietly fall out again.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { ESLint, type Linter } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getExpoConfig } from "../../../src/configs/eslint/expo.js";
import { getExpoSlowConfig } from "../../../src/configs/eslint/slow-expo.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";

// Type-aware parsing of a fresh program: measured at about 3s on a quiet box.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SLOW_RULE = "react-hooks/static-components";

/**
 * The React Compiler diagnostics the main Expo lint enforces at "error". Together
 * with SLOW_RULE they cover what `react-compiler/react-compiler` reported.
 */
const MAIN_COMPILER_RULES = [
  "react-hooks/rules-of-hooks",
  "react-hooks/set-state-in-effect",
  "react-hooks/preserve-manual-memoization",
  "react-hooks/refs",
  "react-hooks/immutability",
  "react-hooks/use-memo",
  "react-hooks/globals",
  "react-hooks/error-boundaries",
  "react-hooks/purity",
  "react-hooks/set-state-in-render",
  "react-hooks/config",
  "react-hooks/gating",
] as const;

/** One component per lint run, each breaking only the rule it names. */
const FIXTURES = {
  "react-hooks/immutability": [
    "export function Tally(props: { count: number }) {",
    "  props.count = 1;",
    "  return <p>{props.count}</p>;",
    "}",
    "",
  ].join("\n"),
  "react-hooks/purity": [
    "export function Clock() {",
    "  return <p>{Date.now()}</p>;",
    "}",
    "",
  ].join("\n"),
  [SLOW_RULE]: [
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
    path.join(root, "src", "mutation.tsx"),
    FIXTURES["react-hooks/immutability"]
  );
  fs.writeFileSync(
    path.join(root, "src", "impure.tsx"),
    FIXTURES["react-hooks/purity"]
  );
  fs.writeFileSync(path.join(root, "src", "static.tsx"), FIXTURES[SLOW_RULE]);
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
  return errorsWith(getExpoSlowConfig(), file);
}

/**
 * Lint one fixture file with a config, reporting only React rule errors.
 * @param config - Flat config to lint with
 * @param file - File name under src/
 * @returns The rule ids ESLint reported, at error severity
 */
async function errorsWith(
  config: Linter.Config[],
  file: string
): Promise<string[]> {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    // lint:slow runs from the project root, which is where the parser looks
    // for tsconfig.eslint.json; this process runs from Lisa's root instead.
    overrideConfig: [
      ...config,
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
  it(`flags a ${SLOW_RULE} violation`, async () => {
    expect(await slowErrors("static.tsx")).toContain(SLOW_RULE);
  });

  it("passes a component that breaks no rule", async () => {
    expect(await slowErrors("clean.tsx")).toEqual([]);
  });
});

describe("Expo main-lint React Compiler rules, through the real ESLint", () => {
  it.each([
    ["react-hooks/immutability", "mutation.tsx"],
    ["react-hooks/purity", "impure.tsx"],
  ] as const)("flags a %s violation", async (rule, file) => {
    const reported = await errorsWith(
      getExpoConfig({ tsconfigRootDir: root }),
      file
    );
    expect(reported).toContain(rule);
  });
});

describe("the Expo configs keep every React Compiler rule", () => {
  it(`sets ${SLOW_RULE} to error for TSX in lint:slow`, () => {
    const entry = getExpoSlowConfig().find(
      (config: Linter.Config) => config.rules?.[SLOW_RULE] !== undefined
    );
    expect(entry?.rules?.[SLOW_RULE]).toBe("error");
    expect(entry?.files).toEqual(expect.arrayContaining(["**/*.tsx"]));
  });

  it.each(MAIN_COMPILER_RULES)(
    "sets %s to error in the main Expo lint",
    rule => {
      const settings = getExpoConfig({ tsconfigRootDir: root })
        .map((config: Linter.Config) => config.rules?.[rule])
        .filter(setting => setting !== undefined);
      expect(settings.at(-1)).toBe("error");
    }
  );

  it("loads no eslint-plugin-react-compiler, whose zod 3 is unpatched", () => {
    for (const file of [
      "src/configs/eslint/expo.ts",
      "src/configs/eslint/slow-expo.ts",
      "expo/copy-overwrite/eslint.expo.ts",
    ])
      expect(
        fs.readFileSync(path.join(REPO_ROOT, file), "utf8"),
        file
      ).not.toMatch(/from "eslint-plugin-react-compiler"/);
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
