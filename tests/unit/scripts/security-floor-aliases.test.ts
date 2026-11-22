/** Registry aliases must be audited under the package they actually install. */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withinRange } from "../../../scripts/check-security-floors.mjs";
import {
  boundedExecFileSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

useIoLatencyBudget();

const MANIFEST = "package.lisa.json";
const SCRIPT = pathToFileURL(
  path.resolve(__dirname, "../../../scripts/check-security-floors.mjs")
).href;
const PRETTIER_ALIAS = "npm:prettier@3.9.10";
const VULNERABLE_RANGE = ">= 1.15.2, < 1.20.0";
const ALIASES = {
  "formatter-compat": PRETTIER_ALIAS,
  "scoped-compat": "npm:@scope/widget@^2.3.4",
  "vulnerable-http": "npm:axios@1.19.0",
  "patched-http": "npm:axios@1.20.0",
  "floorless-http": "npm:axios@<1.20.0",
  "missing-version": "npm:axios",
  "invalid-target": "npm:../axios@1.20.0",
  "nested-alias": "npm:axios@npm:undici@6.29.1",
  "numeric-tag": "npm:axios@legacy-1",
} as const;

/** One real collected site; the original declaration stays available to reports. */
interface Site {
  readonly file: string;
  readonly path: string;
  readonly spec: string;
  readonly lowest: readonly number[];
  readonly declaredName?: string;
}

/** Actual collector output serialized by the native Node child. */
interface Collection {
  readonly found: readonly (readonly [string, readonly Site[]])[];
  readonly unparseable: readonly {
    readonly name: string;
    readonly reason: string;
  }[];
  readonly unresolved: readonly unknown[];
  readonly unscanned: readonly string[] | null;
}

let directory: string | undefined;
let collection: Collection;

beforeAll(async () => {
  const fixtureDirectory = await createTempDir();
  directory = fixtureDirectory;
  fs.writeFileSync(
    path.join(fixtureDirectory, MANIFEST),
    JSON.stringify({
      defaults: { devDependencies: ALIASES },
      force: { overrides: { "formatter-override": "$formatter-compat" } },
    })
  );
  const run = (command: string, args: readonly string[]): string =>
    boundedExecFileSync({
      label: `alias collector ${command}`,
      command,
      args,
      cwd: fixtureDirectory,
      baseMs: 30_000,
    });
  run("git", ["init", "--quiet"]);
  run("git", ["add", "--", MANIFEST]);
  collection = JSON.parse(
    run(process.execPath, [
      "--input-type=module",
      "-e",
      `import { collectFloors } from ${JSON.stringify(SCRIPT)};
       const result = collectFloors();
       console.log(JSON.stringify({ ...result, found: [...result.found] }));`,
    ])
  ) as Collection;
});

afterAll(async () => {
  if (directory !== undefined) await cleanupTempDir(directory);
});

describe("real manifest registry-alias collection", () => {
  it("reconciles the actual tracked fixture manifest", () => {
    expect(collection.unscanned).toEqual([]);
    expect(collection.unresolved).toEqual([]);
  });

  it.each([
    ["prettier", "formatter-compat", PRETTIER_ALIAS, [3, 9, 10]],
    ["@scope/widget", "scoped-compat", ALIASES["scoped-compat"], [2, 3, 4]],
    ["prettier", "formatter-override", PRETTIER_ALIAS, [3, 9, 10]],
  ] as const)(
    "collects %s under its real name from %s",
    (name, declaredName, spec, lowest) => {
      const found = new Map(collection.found);
      expect(found.has(declaredName)).toBe(false);
      expect(found.get(name)).toBeDefined();
      expect(found.get(name)).toContainEqual({
        file: MANIFEST,
        path:
          declaredName === "formatter-override"
            ? "force.overrides"
            : "defaults.devDependencies",
        spec,
        lowest,
        declaredName,
      });
    }
  );

  it("keeps vulnerable and patched alias versions distinct for the real advisory", () => {
    const sites = new Map(collection.found).get("axios");
    const vulnerable = sites?.find(
      site => site.declaredName === "vulnerable-http"
    );
    const patched = sites?.find(site => site.declaredName === "patched-http");
    expect(vulnerable).toBeDefined();
    expect(patched).toBeDefined();
    expect(withinRange([...vulnerable!.lowest], VULNERABLE_RANGE)).toBe(true);
    expect(withinRange([...patched!.lowest], VULNERABLE_RANGE)).toBe(false);
  });

  it.each([
    "floorless-http",
    "missing-version",
    "invalid-target",
    "nested-alias",
    "numeric-tag",
  ])("continues reporting unreadable alias %s instead of passing it", name => {
    expect(
      collection.unparseable.find(site => site.name === name)?.reason
    ).toBeTruthy();
    expect(
      collection.found
        .flatMap(([, sites]) => sites)
        .some(site => site.declaredName === name)
    ).toBe(false);
  });
});
