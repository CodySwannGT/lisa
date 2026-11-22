/**
 * Lisa's `@codyswann/lisa/knip` resolution makes knip 6 resolve an Expo host
 * the way TypeScript does, and the `knip-platform-files` skill's worked
 * example is that fix, working (CodySwannGT/lisa#4932).
 *
 * Knip 6 resolves through oxc-resolver, which ignores `moduleSuffixes` and
 * resolves bare specifiers against `baseUrl` only in included files. The control run
 * below shows the same host reported unresolved without the resolution; the
 * fixed run, with the skill's own example, reports nothing.
 * @module tests/unit/config/knip-expo-resolution
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  expoKnipResolution,
  platformSuffixCompilers,
  tsconfigPathAliases,
} from "../../../src/configs/knip/index.js";
import {
  againstSource,
  workedExample,
  writeExpoKnipHost,
} from "../../helpers/expo-knip-fixture.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// One knip run over the fixture took 0.7s, measured with 5 vitest processes
// running (`ps aux | grep -c '[v]itest'`). 20s leaves the child 3x inside the
// default 60s case budget.
useIoLatencyBudget();

/** Quiet-box budget for one knip run over the fixture. */
const KNIP_BASE_MS = 20_000;

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const KNIP = path.join(REPO_ROOT, "node_modules", "knip", "bin", "knip.js");

/** What knip reports for the fixture without Lisa's resolution. */
const WITHOUT_RESOLUTION = {
  unresolved: ["../Picker", "@/Swatch"],
  unlisted: ["tailwind.config"],
};

/** What knip reports for the fixture with the skill's worked example. */
const WITH_RESOLUTION = { unresolved: [], unlisted: [] };

const byName = (a: string, b: string): number => a.localeCompare(b);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A fresh fixture host.
 * @returns Its directory
 */
function host(): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-knip-expo-"))
  );
  tempDirs.push(dir);
  writeExpoKnipHost(dir);
  return dir;
}

/** The two finding kinds the fixture exercises. */
interface Findings {
  unresolved: string[];
  unlisted: string[];
}

/** The part of knip's JSON report the fixture reads. */
interface KnipReport {
  issues: { unresolved?: { name: string }[]; unlisted?: { name: string }[] }[];
}

/**
 * Sorted names from one finding kind across every file.
 * @param issues - Per-file findings
 * @returns Names, sorted
 */
function names(issues: readonly { name: string }[][]): string[] {
  return issues
    .flat()
    .map(({ name }) => name)
    .sort(byName);
}

/**
 * Knip's JSON report for a host.
 * @param dir - Host directory
 * @returns The parsed report
 */
function knipReport(dir: string): KnipReport {
  return JSON.parse(
    String(
      boundedSpawnSync({
        label: "knip on the Expo resolution fixture",
        command: process.execPath,
        args: [KNIP, "--no-progress", "--reporter", "json"],
        cwd: dir,
        baseMs: KNIP_BASE_MS,
      }).stdout
    )
  ) as KnipReport;
}

/**
 * Summarise a knip report.
 * @param report - Knip's JSON report
 * @returns Every unresolved import and unlisted dependency
 */
function summarise(report: KnipReport): Findings {
  return {
    unresolved: names(report.issues.map(issue => issue.unresolved ?? [])),
    unlisted: names(report.issues.map(issue => issue.unlisted ?? [])),
  };
}

/**
 * Run knip in a host with the given `knip.ts`.
 * @param dir - Host directory
 * @param config - `knip.ts` contents
 * @returns Every unresolved import and unlisted dependency knip reported
 */
function findings(dir: string, config: string): Findings {
  fs.writeFileSync(path.join(dir, "knip.ts"), config);
  return summarise(knipReport(dir));
}

describe("knip resolution for Expo hosts", () => {
  it("pins the platform suffixes to the host's tsconfig, including Lisa's Expo list", () => {
    const expoSuffixes = (
      JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "tsconfig", "expo.json"), "utf8")
      ) as { compilerOptions: { moduleSuffixes: string[] } }
    ).compilerOptions.moduleSuffixes;
    const dir = host();
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { moduleSuffixes: expoSuffixes } })
    );
    expect(
      Object.keys(platformSuffixCompilers({ cwd: dir })).sort(byName)
    ).toEqual(
      expoSuffixes
        .filter(suffix => suffix !== "")
        .flatMap(suffix =>
          ["js", "jsx", "ts", "tsx"].map(ext => `${suffix.slice(1)}.${ext}`)
        )
        .sort(byName)
    );
    expect(platformSuffixCompilers({ cwd: dir })["native.tsx"]?.("x")).toBe(
      "x"
    );
  });

  it("follows extends and hands knip the aliases and baseUrl relative to the host", () => {
    const dir = host();
    fs.mkdirSync(path.join(dir, "config"));
    fs.writeFileSync(
      path.join(dir, "config", "base.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: "..",
          moduleSuffixes: [".native", ""],
          paths: { "@/*": ["./src/*"] },
        },
      })
    );
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ extends: "./config/base.json" })
    );
    expect(Object.keys(platformSuffixCompilers({ cwd: dir }))).toContain(
      "native.tsx"
    );
    expect(tsconfigPathAliases({ cwd: dir })).toEqual({
      "@/*": ["./src/*"],
      "*": ["./*"],
    });
  });

  it("reports the fixture's platform and baseUrl imports without it", () => {
    const dir = host();
    expect(findings(dir, 'export default { entry: ["index.tsx"] };\n')).toEqual(
      WITHOUT_RESOLUTION
    );
  });

  it("resolves them with the skill's worked example", () => {
    const dir = host();
    expect(findings(dir, againstSource(workedExample()))).toEqual(
      WITH_RESOLUTION
    );
    expect(Object.keys(expoKnipResolution({ cwd: dir }))).toEqual([
      "compilers",
      "paths",
    ]);
  });
});
