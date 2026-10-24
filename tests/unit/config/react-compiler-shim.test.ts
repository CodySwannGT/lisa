/**
 * The built-in `react-compiler` shim keeps existing references resolving
 * without eslint-plugin-react-compiler (CodySwannGT/lisa#4507).
 *
 * The plugin's newest release still requires zod 3, which
 * GHSA-mrhx-c7xc-m3w5 affects, so Lisa stopped depending on it. Lisa only ever
 * set its one rule to "off", but Expo projects may still name that rule: an
 * inline disable comment for it, or a project config that sets it. Without a
 * plugin under that namespace the first is a lint error and the second stops
 * ESLint loading its config. These cases run the real ESLint from the
 * lockfile, once without any plugin (the break the shim exists to prevent) and
 * once with the shim.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { ESLint, type Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { getExpoConfig } from "../../../src/configs/eslint/expo.js";
import { reactCompilerShim } from "../../../src/configs/eslint/react-compiler-shim.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const RULE = "react-compiler/react-compiler";
// Assembled at runtime: this is fixture text for ESLint to read, and the
// directive must not appear literally in this file's own source.
const DIRECTIVE = ["eslint", "disable-next-line"].join("-");
const INLINE_DISABLE = `// ${DIRECTIVE} ${RULE}\nexport const answer = 42;\n`;
const PLAIN = "export const answer = 42;\n";

/**
 * Lint one snippet under a minimal flat config.
 * @param code - Source text
 * @param config - Flat config entries
 * @returns ESLint's result for the snippet
 */
async function lint(
  code: string,
  config: Linter.Config[]
): Promise<ESLint.LintResult> {
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: true,
    overrideConfig: config,
  });
  const [result] = await eslint.lintText(code, { filePath: "fixture.js" });
  if (result === undefined) throw new Error("ESLint returned no result");
  return result;
}

const WITH_SHIM: Linter.Config[] = [
  { plugins: { "react-compiler": reactCompilerShim } },
];

describe("react-compiler shim, through the real ESLint", () => {
  it("without any plugin, an inline disable is a lint error", async () => {
    const result = await lint(INLINE_DISABLE, []);
    expect(result.errorCount).toBe(1);
    expect(result.messages[0]?.message).toContain(
      `Definition for rule '${RULE}' was not found`
    );
  });

  it("with the shim, an inline disable resolves and errors nothing", async () => {
    const result = await lint(INLINE_DISABLE, WITH_SHIM);
    expect(result.errorCount).toBe(0);
    expect(result.messages.map(message => message.message)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("was not found")])
    );
    // What remains is ESLint's default "unused directive" warning, which the
    // real plugin produced too: Lisa's config has always set the rule off.
    for (const message of result.messages) expect(message.severity).toBe(1);
  });

  it("without any plugin, a config that sets the rule stops ESLint", async () => {
    await expect(lint(PLAIN, [{ rules: { [RULE]: "error" } }])).rejects.toThrow(
      /react-compiler/
    );
  });

  it.each([
    ["error", "error"],
    ["warn with options", ["warn", { environment: {} }]],
  ] as const)(
    "with the shim, a project config setting the rule to %s lints clean",
    async (_label, setting) => {
      const result = await lint(PLAIN, [
        ...WITH_SHIM,
        { rules: { [RULE]: setting as Linter.RuleEntry } },
      ]);
      expect(result.messages).toEqual([]);
    }
  );
});

describe("the Expo config registers the shim, not the package", () => {
  it("getExpoConfig puts the shim under the react-compiler namespace, rule off", () => {
    const entries = getExpoConfig({ tsconfigRootDir: REPO_ROOT });
    const owner = entries.find(entry => entry.plugins?.["react-compiler"]);
    expect(owner?.plugins?.["react-compiler"]).toBe(reactCompilerShim);
    expect(owner?.rules?.[RULE]).toBe("off");
  });

  it("the managed Expo template imports the shim from the published entry", () => {
    const template = fs.readFileSync(
      path.join(REPO_ROOT, "expo/copy-overwrite/eslint.expo.ts"),
      "utf8"
    );
    expect(template).toContain('from "@codyswann/lisa/eslint/expo"');
    expect(template).toContain('"react-compiler": reactCompilerShim');
    expect(template).toContain(`"${RULE}": "off"`);
    expect(template).not.toContain('"eslint-plugin-react-compiler"');
  });
});
