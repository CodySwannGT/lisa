/** Controlled loader setup; exact npm-ci installation is proved separately. */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ACTION = ".github/actions/dependency-audit";
const REQUIRE = createRequire(import.meta.url);
const DEPS = [
  "esbuild",
  "semver",
  "jsonc-parser",
  "js-yaml",
  "@yarnpkg/lockfile",
];

/**
 * Copy the actual runner and canonical sources to a checkout with isolated dependencies.
 * @param root - Owned fixture root, removed by the caller
 * @returns The copied action directory, whose run.mjs is the real consumer
 */
export function createAuditActionCheckout(root: string): string {
  const checkout = path.join(root, "action-checkout");
  const action = path.join(checkout, ACTION);
  fs.mkdirSync(path.join(checkout, "src/core"), { recursive: true });
  fs.cpSync(ACTION, action, {
    recursive: true,
    filter: source => !source.split(path.sep).includes("node_modules"),
  });
  for (const source of fs
    .readdirSync("src/core")
    .filter(file => /^audit.*\.ts$/u.test(file))) {
    fs.copyFileSync(
      path.join("src/core", source),
      path.join(checkout, "src/core", source)
    );
  }
  for (const dependency of DEPS) {
    const installed = path.dirname(
      REQUIRE.resolve(`${dependency}/package.json`)
    );
    const destination = path.join(action, "node_modules", dependency);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(installed, destination, "dir");
  }
  return action;
}
