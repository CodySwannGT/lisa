/**
 * Pins the npm floor the CDK template forces (CodySwannGT/lisa#4793).
 *
 * npm below 11.6.0 crashes with an arborist error (`Cannot read properties of
 * null (reading 'edgesOut')`) that never mentions npm's version. The real
 * trigger is any Vitest 4 dependency: vite's optional devtools peer chain
 * reaches Vitest 5 inside npm 10's peer scratch tree, a Vitest 4 package then
 * orphans that node, and arborist dereferences its null parent
 * (CodySwannGT/lisa#4871). Lisa and its templates now ship Vitest ^5.1.0, and
 * a host on Vitest 5 installs fine under npm 10.
 *
 * The warning stays: a host still pinned to Vitest 4 keeps crashing under npm
 * 10, and `devEngines.packageManager` makes every npm command name the minimum
 * first. It stays `warn`, not `error`: `error` would also fail plain `npm ci`,
 * which npm 10 runs fine, and a host on Vitest 5 has no reason to upgrade npm.
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

/**
 * The minimum npm, the first release that installs a Vitest 4 host cleanly.
 * A Vitest 5 host also installs under npm 10 (CodySwannGT/lisa#4871).
 */
const NPM_FLOOR = "11.6.0";

/**
 * Read the CDK package template.
 * @returns Parsed template
 */
function template(): {
  readonly force: {
    readonly devEngines?: unknown;
    readonly devDependencies: Readonly<Record<string, string>>;
  };
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

  it("forces Vitest 5, the line npm 10 installs without the crash", () => {
    const { devDependencies } = template().force;
    expect(devDependencies.vitest).toBe("^5.1.0");
    expect(devDependencies["@vitest/coverage-v8"]).toBe("^5.1.0");
  });

  it("defaults new projects' engines.npm to the same floor", () => {
    expect(template().defaults.engines.npm).toBe(`>= ${NPM_FLOOR}`);
  });
});
