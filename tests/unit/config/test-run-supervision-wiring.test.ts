/** Structural guard that managed test entrypoints cannot bypass lisa-test-run. */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  analyzeTestRunChildLaunches,
  analyzeVitestSpawns,
  LISA_TEST_RUNNER_PATH_BIT,
} from "../../helpers/test-run-supervision-analyzer.js";
import {
  executableModuleGraph,
  isExecutableModule,
} from "../../helpers/test-run-module-closure.js";
import { reachableFrom } from "../../helpers/staged-dependency-scan.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SPAWN_SYNC = "spawnSync";
const PROCESS_EXEC_PATH = "process.execPath";
const ROOT_MTS = "src/root.mts";
const SOURCE_DIAGNOSTIC = "source parse diagnostic";

/**
 * Enumerate TypeScript sources without a hard-coded route roster.
 * @param directory - Directory whose executable descendants are required
 * @returns Every executable source below the directory
 */
const executableSources = (directory: string): readonly string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return executableSources(target);
    return entry.isFile() && isExecutableModule(entry.name) ? [target] : [];
  });

describe("managed test supervision wiring", () => {
  it("detects every bare Vitest child, including a second call", () => {
    const source = `
      import { execFileSync, spawnSync } from "node:child_process";
      const RUNNER = "lisa-test-run.ts";
      const PROFILE = ["--profile", "lisa"];
      const ADAPTER = ["--adapter", "vitest"];
      const PAYLOAD = ["--", "vitest"];
      const TEST_RUNNER_ARGS = [...PROFILE, ...ADAPTER, ...PAYLOAD];
      spawnSync("node", [RUNNER, ...TEST_RUNNER_ARGS]);
      spawnSync("vitest", ["run"]);
      execFileSync("node_modules/.bin/vitest", ["run"]);
      const CYCLE_A = [CYCLE_B, "--profile", "lisa"];
      const CYCLE_B = [CYCLE_A, "--adapter", "vitest", "--"];
      spawnSync("vitest", CYCLE_A);
      spawnSync("vitest", UNKNOWN_ARGS);
    `;

    expect(analyzeVitestSpawns(source).bypasses).toHaveLength(4);
    expect(analyzeVitestSpawns(source).findings).toEqual([]);
  });

  it("routes every internal Vitest child launch through source supervision", () => {
    const analyses = executableSources(path.join(REPO_ROOT, "tests")).flatMap(
      file => {
        const source = fs.readFileSync(file, "utf8");
        const analysis = analyzeVitestSpawns(source);
        return analysis.vitestCallCount === 0
          ? []
          : [{ analysis, file: path.relative(REPO_ROOT, file) }];
      }
    );
    for (const { analysis } of analyses) {
      expect(analysis.declarationVisits).toBeLessThanOrEqual(
        analysis.declarationCount
      );
      expect(analysis.dependencyVisits).toBeLessThanOrEqual(
        analysis.dependencyCount
      );
    }
    const bypasses = analyses.flatMap(({ analysis, file }) =>
      analysis.bypasses.map(call => ({ call, file }))
    );
    const findings = analyses.flatMap(({ analysis, file }) =>
      analysis.findings.map(finding => ({ file, finding }))
    );

    expect(findings).toEqual([]);
    expect(bypasses).toEqual([]);
  });

  it("keeps prearmed reaper recovery unable to launch a Lisa successor", () => {
    const sources = new Map(
      [
        ...executableSources(path.join(REPO_ROOT, "src")),
        ...executableSources(path.join(REPO_ROOT, "scripts/lib")),
      ].map(file => [
        path.relative(REPO_ROOT, file),
        fs.readFileSync(file, "utf8"),
      ])
    );
    const closure = executableModuleGraph(sources);
    const reachable = reachableFrom(
      closure.graph,
      new Set(["src/cli/lisa-test-run-reaper.ts"])
    );
    expect(
      closure.unresolved.filter(edge => reachable.has(edge.importer))
    ).toEqual([]);
    expect(
      closure.findings.filter(finding => reachable.has(finding.file))
    ).toEqual([]);
    const analyses = [...reachable].map(file => ({
      file,
      analysis: analyzeTestRunChildLaunches(sources.get(file) ?? ""),
    }));
    expect(
      analyses.flatMap(({ analysis, file }) =>
        analysis.findings.map(finding => `${file}: ${finding}`)
      )
    ).toEqual([]);
    const launches = analyses
      .flatMap(({ analysis, file }) =>
        analysis.launches.map(launch => ({
          ...launch,
          file,
        }))
      )
      .sort((left, right) => left.file.localeCompare(right.file));

    expect(
      launches.filter(launch =>
        Boolean(launch.bits & LISA_TEST_RUNNER_PATH_BIT)
      )
    ).toEqual([]);
    expect(
      launches.map(launch => ({
        file: launch.file,
        callee: launch.callee,
        command: launch.arguments[0],
      }))
    ).toEqual([
      {
        file: "src/configs/vitest/scratch-bound-cleanup.ts",
        callee: SPAWN_SYNC,
        command: PROCESS_EXEC_PATH,
      },
      {
        file: "src/configs/vitest/scratch-bound-root-cleanup.ts",
        callee: SPAWN_SYNC,
        command: PROCESS_EXEC_PATH,
      },
      {
        file: "src/configs/vitest/scratch-owner.ts",
        callee: SPAWN_SYNC,
        command: '"/bin/ps"',
      },
    ]);
    expect(launches.map(launch => launch.arguments)).toEqual([
      [
        PROCESS_EXEC_PATH,
        '[ "--input-type=commonjs", "--eval", ' +
          "BOUND_CHILDREN_CLEANUP_PROGRAM, String(options.parent.dev), " +
          "String(options.parent.ino), ]",
        '{ cwd: options.parent.canonicalPath, encoding: "utf8", input, maxBuffer: 64 * 1024, }',
      ],
      [
        PROCESS_EXEC_PATH,
        '[ "--input-type=commonjs", "--eval", ' +
          "BOUND_DIRECTORY_CLEANUP_PROGRAM, String(expected.dev), " +
          "String(expected.ino), ]",
        '{ cwd: candidate, encoding: "utf8", maxBuffer: 64 * 1024 }',
      ],
      [
        '"/bin/ps"',
        '["-p", pids.join(","), "-o", "pid=", "-o", "lstart="]',
        '{ encoding: "utf8", killSignal: "SIGKILL", ' +
          "maxBuffer: Math.max(4_096, pids.length * 128), " +
          "timeout: PS_TIMEOUT_MS, }",
      ],
    ]);
    expect(
      launches.every(
        launch => !launch.arguments.join(" ").includes("lisa-test-run")
      )
    ).toBe(true);
  });

  it("resolves extensionless and CommonJS edges and refuses missing relatives", () => {
    const complete = executableModuleGraph(
      new Map([
        [
          ROOT_MTS,
          'import "./typed"; require("./legacy.cjs"); import child = require("./equal");',
        ],
        ["src/typed.ts", "export {};"],
        ["src/equal.cts", "export = {};"],
        ["src/legacy.cjs", 'module.exports = require("./nested");'],
        ["src/nested/index.mjs", "export {};"],
      ])
    );
    expect(complete.findings).toEqual([]);
    expect(complete.unresolved).toEqual([]);
    expect(reachableFrom(complete.graph, new Set([ROOT_MTS]))).toEqual(
      new Set([
        ROOT_MTS,
        "src/typed.ts",
        "src/equal.cts",
        "src/legacy.cjs",
        "src/nested/index.mjs",
      ])
    );
    expect(
      executableModuleGraph(new Map([["src/root.cts", 'require("./missing")']]))
        .unresolved
    ).toEqual([{ importer: "src/root.cts", specifier: "./missing" }]);
    const incomplete = executableModuleGraph(
      new Map([
        [
          "src/dynamic.js",
          "import(moduleName); require(moduleName); const broken = ;",
        ],
      ])
    );
    expect(
      incomplete.findings.some(value =>
        value.message.includes("nonliteral module acquisition")
      )
    ).toBe(true);
    expect(
      incomplete.findings.some(value =>
        value.message.includes(SOURCE_DIAGNOSTIC)
      )
    ).toBe(true);
    expect(
      executableModuleGraph(
        new Map([
          [
            "src/inert.cjs",
            "function require(value) { return value; } require(name);",
          ],
        ])
      ).findings
    ).toEqual([]);
  });
});
