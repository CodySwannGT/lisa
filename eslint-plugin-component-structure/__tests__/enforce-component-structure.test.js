/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { RuleTester } = require("eslint");

const rule = require("../rules/enforce-component-structure");

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
});

/**
 * Creates an index file fixture whose component siblings are intentionally missing.
 * @param {string} componentName Component directory name
 * @returns {string} Absolute fixture index path
 */
function createComponentIndexFixture(componentName) {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "lisa-component-structure-")
  );
  const componentDir = path.join(
    rootDir,
    "src",
    "features",
    "demo",
    "components",
    componentName
  );
  const filename = path.join(componentDir, "index.tsx");

  fs.mkdirSync(componentDir, { recursive: true });
  fs.writeFileSync(
    filename,
    `export { default } from "./${componentName}View";\n`
  );
  return filename;
}

ruleTester.run("enforce-component-structure", rule, {
  valid: [],
  invalid: [
    {
      code: `export { default } from "./MissingSiblingsView";`,
      filename: createComponentIndexFixture("MissingSiblings"),
      errors: [{ messageId: "missingContainer" }, { messageId: "missingView" }],
    },
  ],
});
