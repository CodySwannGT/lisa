import * as path from "node:path";
import { satisfies } from "semver";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";

const lisaDir = path.resolve(import.meta.dirname, "../../..");

describe("npm maintenance governance", () => {
  it("emits a patched ESLint default without changing its supported API major", async () => {
    const planned = await new PackageLisaStrategy().planPackageJson(
      { name: "anonymous-tooling-consumer", private: true },
      ["typescript"],
      lisaDir
    );
    const dependencies = planned.devDependencies as Record<string, string>;
    expect(satisfies("9.39.2", dependencies.eslint!)).toBe(false);
    expect(satisfies("9.39.5", dependencies.eslint!)).toBe(true);
    expect(satisfies("10.0.0", dependencies.eslint!)).toBe(false);
    const overrides = planned.overrides as Record<string, unknown>;
    for (const library of ["ajv", "minimatch", "picomatch", "yaml"]) {
      expect(overrides).not.toHaveProperty(library);
    }
    const qs = overrides.qs as string;
    expect(satisfies("6.15.1", qs)).toBe(false);
    expect(satisfies("6.16.0", qs)).toBe(true);
    expect(satisfies("7.0.0", qs)).toBe(false);
  });

  it.each(["typescript", "cdk"] as const)(
    "%s emits the existing repaired deepmerge policy into the consumer root",
    async stack => {
      const planned = await new PackageLisaStrategy().planPackageJson(
        {
          name: "anonymous-functional-consumer",
          private: true,
          overrides: { "deepmerge-ts": "^7.1.5" },
          resolutions: { "deepmerge-ts": "^7.1.5" },
        },
        [stack],
        lisaDir
      );
      for (const field of ["overrides", "resolutions"] as const) {
        const policy = (planned[field] as Record<string, string>)[
          "deepmerge-ts"
        ]!;
        expect(satisfies("7.1.6", policy)).toBe(false);
        expect(satisfies("8.0.1", policy)).toBe(true);
        expect(satisfies("9.0.0", policy)).toBe(false);
      }
    }
  );

  it("keeps pure Rails independent of TypeScript tool defaults", async () => {
    const planned = await new PackageLisaStrategy().planPackageJson(
      { name: "anonymous-rails-consumer", private: true },
      ["rails"],
      lisaDir
    );
    expect(planned.devDependencies ?? {}).not.toHaveProperty("eslint");
    expect(planned.overrides ?? {}).not.toHaveProperty("minimatch");
    expect(planned.overrides ?? {}).not.toHaveProperty("deepmerge-ts");
  });

  it("emits the vendor refresh with its normal CDK self-reference", async () => {
    const planned = await new PackageLisaStrategy().planPackageJson(
      { name: "anonymous-cdk-consumer", private: true },
      ["cdk"],
      lisaDir
    );
    const dependencies = planned.dependencies as Record<string, string>;
    expect(satisfies("2.260.0", dependencies["aws-cdk-lib"]!)).toBe(false);
    expect(satisfies("2.272.0", dependencies["aws-cdk-lib"]!)).toBe(true);
    expect(satisfies("3.0.0", dependencies["aws-cdk-lib"]!)).toBe(false);
    expect(planned.overrides).toHaveProperty("aws-cdk-lib", "$aws-cdk-lib");
  });
});
