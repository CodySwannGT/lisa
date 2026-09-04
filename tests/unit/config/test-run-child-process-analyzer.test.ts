/** Synthetic fail-closed controls for process-launch provenance. */
import { describe, expect, it } from "vitest";

import {
  analyzeTestRunChildLaunches,
  analyzeVitestSpawns,
} from "../../helpers/test-run-supervision-analyzer.js";

describe("test-run child process analyzer", () => {
  it("resolves supported imports, aliases, containers, and returned aliases", () => {
    const analysis = analyzeTestRunChildLaunches(`
      import childDefault from "node:child_process";
      import childEquals = require("node:child_process");
      import { default as childAlias } from "node:child_process";
      import { exec, execFile, execFileSync, execSync, fork, spawn, spawnSync as sync } from "node:child_process";
      import * as child from "node:child_process";
      const required = require("node:child_process");
      const dynamic = await import("node:child_process");
      const alias = sync;
      const transitive = alias;
      const { spawn: destructured } = required;
      const computed = childDefault["spawnSync"];
      let assigned;
      assigned = child.exec;
      const container = { launch: child.execFileSync };
      const { launch: contained } = container;
      const tuple = [child.fork];
      const [tupled] = tuple;
      function returnedFactory() { return child.execFile; }
      const returned = returnedFactory();
      exec("a"); execFile("b"); execFileSync("c"); execSync("d");
      fork("e"); spawn("f"); transitive("g"); child.spawnSync("h");
      required.fork("i"); dynamic.exec("j"); destructured("k");
      (await import("node:child_process")).execSync("l");
      computed("m"); childAlias["execFile"]("n"); childEquals.spawn("o");
      assigned("p"); contained("q"); tupled("r"); returned("s");
    `);
    expect(analysis.findings).toEqual([]);
    expect(new Set(analysis.launches.map(launch => launch.callee))).toEqual(
      new Set([
        "exec",
        "execFile",
        "execFileSync",
        "execSync",
        "fork",
        "spawn",
        "spawnSync",
      ])
    );
  });

  it("keeps shadowed and same-name local calls inert", () => {
    expect(
      analyzeTestRunChildLaunches(`
      function spawn() {}
      const exec = () => {};
      function inert(spawnSync: () => void) { const fork = spawnSync; fork(); }
      function inertReflect(Reflect: { apply: () => void }) { Reflect.apply(); }
      function inertRequire(require: (value: string) => unknown) { require(name); }
      { const execFile = () => {}; execFile(); }
      spawn(); exec();
    `)
    ).toEqual({ launches: [], findings: [] });
    expect(
      analyzeVitestSpawns(`
      function spawnSync(command: string) { return command; }
      spawnSync("vitest");
    `).bypasses
    ).toEqual([]);
  });

  it("refuses ambiguous expressions, escapes, unsupported access, and parse gaps", () => {
    const rejected = analyzeTestRunChildLaunches(`
      import * as child from "node:child_process";
      const local = () => {};
      const bound = child.spawn.bind(null);
      const dynamic = child[name];
      const unsupported = child.disconnect;
      const conditional = flag ? child.exec : local;
      const logical = flag && child.execFile;
      const sequence = (child.fork, local);
      const unmodeled = !child.spawnSync;
      const reflectAlias = Reflect["apply"];
      const boundReflect = Reflect.apply.bind(null);
      const consume = (value) => value;
      consume(child.disconnect);
      consume({ launch: child.exec });
      holder.launch = child.execFileSync;
      export const exported = child.spawn;
      export function exportedFactory() { return child.execSync; }
      export default child.fork;
      var duplicate = child.spawn;
      var duplicate = () => {};
      require(moduleName);
      import(moduleName);
      bound("a"); dynamic("b"); unsupported(); conditional("c");
      logical("d"); sequence("e"); unmodeled("f");
      Reflect.apply(child.exec, null, ["g"]);
      Reflect.construct(child.execFile, ["h"]);
      reflectAlias(child.spawnSync, null, ["i"]);
      boundReflect(child.spawn, null, ["j"]);
      duplicate("k");
      const broken = ;
    `);
    expect(rejected.launches).toEqual([]);
    for (const fragment of [
      "ambiguous child_process conditional",
      "ambiguous child_process logical expression",
      "argument escape",
      "assignment escape",
      "bound child_process.spawn",
      "bound Reflect.apply",
      "child_process sequence escape",
      "duplicate variable binding",
      "exported declaration",
      "exported return",
      "nonliteral module acquisition",
      "source parse diagnostic",
      "unmodeled child_process",
      "unsupported child_process property disconnect",
    ])
      expect(rejected.findings.some(value => value.includes(fragment))).toBe(
        true
      );
    expect(
      rejected.findings.filter(value =>
        value.includes("child_process Reflect.")
      )
    ).toHaveLength(3);
  });

  it("uses resolved child provenance for imported Vitest aliases", () => {
    const analysis = analyzeVitestSpawns(`
      import { spawnSync as launch } from "node:child_process";
      const RUNNER = "lisa-test-run.ts";
      const ARGS = [RUNNER, "--profile", "lisa", "--adapter", "vitest", "--", "vitest"];
      launch("node", ARGS);
      launch("vitest", ["run"]);
    `);
    expect(analysis.findings).toEqual([]);
    expect(analysis.bypasses).toEqual(['launch("vitest", ["run"])']);
  });

  it("retains malformed and nonliteral acquisition findings without Vitest text", () => {
    const analysis = analyzeVitestSpawns(`
      import(moduleName);
      require(moduleName);
      const broken = ;
    `);
    expect(
      analysis.findings.some(value =>
        value.includes("nonliteral module acquisition")
      )
    ).toBe(true);
    expect(
      analysis.findings.some(value => value.includes("source parse diagnostic"))
    ).toBe(true);
  });
});
