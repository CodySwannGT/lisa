/**
 * Pins the npm floor the CDK template forces (CodySwannGT/lisa#4793).
 *
 * npm below 11.6.0 crashes installing Lisa 4.102 with an arborist error that
 * never mentions npm's version. `devEngines.packageManager` makes every npm
 * command name the minimum first. It stays `warn` until CDK hosts move to
 * Node 24: `error` would also fail plain `npm ci`, which npm 10.9.4 runs fine.
 * @module tests/unit/config/cdk-npm-floor
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../cdk/package-lisa/package.lisa.json"
);

/** The minimum npm, the first release that installs Lisa 4.102 cleanly. */
const NPM_FLOOR = "11.6.0";

/**
 * Read the CDK package template.
 * @returns Parsed template
 */
function template(): {
  readonly force: { readonly devEngines?: unknown };
  readonly defaults: { readonly engines: { readonly npm: string } };
} {
  return JSON.parse(readFileSync(TEMPLATE, "utf8"));
}

describe("CDK template npm floor", () => {
  it("forces a warn-mode devEngines floor at the first working npm", () => {
    expect(template().force.devEngines).toEqual({
      packageManager: {
        name: "npm",
        version: `>=${NPM_FLOOR}`,
        onFail: "warn",
      },
    });
  });

  it("defaults new projects' engines.npm to the same floor", () => {
    expect(template().defaults.engines.npm).toBe(`>= ${NPM_FLOOR}`);
  });
});
