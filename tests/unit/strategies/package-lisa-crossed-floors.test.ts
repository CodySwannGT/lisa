/** Higher host floors can coexist with Lisa's upper bounds. */
import { satisfies } from "semver";
import { describe, expect, it } from "vitest";

import { preserveHigherHostPins } from "../../../src/strategies/package-lisa-host-pins.js";

const dependency = "eslint-plugin-oxlint";

describe("crossing forced package ranges", () => {
  it.each([
    {
      host: "^1.73.0",
      forced: ">=1.62.0 <1.86.0",
      include: ["1.73.0", "1.85.9"],
      exclude: ["1.72.9", "1.86.0-rc.1", "1.86.0", "2.0.0"],
    },
    {
      host: ">=1.8.0 <2.2.0 || >=3.1.0 <4.0.0",
      forced: ">=1.2.0 <2.0.0 || >=3.0.0 <3.5.0",
      include: ["1.8.0", "1.9.9", "3.1.0", "3.4.9"],
      exclude: ["1.7.9", "2.0.0", "3.0.0", "3.5.0"],
    },
    {
      host: ">=1.3.0-beta <2.0.0",
      forced: ">=1.0.0 <1.8.0",
      include: ["1.3.0", "1.7.9"],
      exclude: ["1.3.0-beta.2", "1.8.0", "2.0.0"],
    },
    {
      host: ">=1.3.0-beta.2 <2.1.0",
      forced: ">=1.3.0-beta.1 <2.0.0",
      include: ["1.3.0-beta.2", "1.3.0-rc.1", "1.3.0", "1.9.9"],
      exclude: ["1.3.0-beta.1", "1.4.0-beta.1", "2.0.0"],
    },
  ])(
    "writes the common range for $host and $forced",
    ({ host, forced, include, exclude }) => {
      const result = preserveHigherHostPins(
        { devDependencies: { [dependency]: host } },
        { devDependencies: { [dependency]: forced } },
        "package.json"
      );
      const selected =
        (result.packageJson.devDependencies as Record<string, string>)[
          dependency
        ] ?? "";

      expect(include.map(version => satisfies(version, selected))).toEqual(
        include.map(() => true)
      );
      expect(exclude.map(version => satisfies(version, selected))).toEqual(
        exclude.map(() => false)
      );
      expect(result.notes.join(" ")).toContain(host);
      expect(result.notes.join(" ")).toContain(forced);
      const reapplied = preserveHigherHostPins(
        result.packageJson,
        { devDependencies: { [dependency]: forced } },
        "package.json"
      );
      expect(reapplied.packageJson).toEqual(result.packageJson);
    }
  );
});
