/** The Rails hook and hosted scan obtain the scanner from the same pin. */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { useOwnedTempDirs } from "../../helpers/owned-temp-dirs.js";

useIoLatencyBudget();

const owned = useOwnedTempDirs();
const root = path.resolve(import.meta.dirname, "../../..");
const template = path.join(root, "rails/copy-overwrite");
const script = "scripts/lisa-rails-ast-grep.mjs";

describe("Rails structural rules on push", () => {
  it("connects the Rails hook to the shared structural scan", () => {
    const hooks = parse(
      readFileSync(path.join(template, "lefthook.yml"), "utf8")
    );
    expect(hooks["pre-push"].commands["ast-grep"].run).toContain(
      "node scripts/lisa-rails-gates.mjs ast-grep"
    );
  });

  it("uses the published wrapper's exact pin when CI installs the tool", () => {
    const cwd = owned("lisa-rails-ast-grep-ci-");
    mkdirSync(path.join(cwd, "scripts"));
    copyFileSync(path.join(template, script), path.join(cwd, script));
    writeFileSync(path.join(cwd, "npm"), "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", {
      mode: 0o700,
    });
    const workflow = parse(
      readFileSync(
        path.join(root, ".github/workflows/quality-rails.yml"),
        "utf8"
      )
    );
    const installStep = workflow.jobs.sg_scan.steps.find(
      (step: { readonly name: string }) =>
        step.name.includes("Install ast-grep")
    );
    const env = {
      ...process.env,
      PATH: [cwd, path.dirname(process.execPath), process.env.PATH].join(
        path.delimiter
      ),
    };
    const expected = boundedSpawnSync({
      label: "Rails structural package pin",
      command: process.execPath,
      args: [script, "--package"],
      cwd,
      env,
    });
    const pipeline = boundedSpawnSync({
      label: "Rails structural CI package selection",
      command: "/bin/bash",
      args: ["-e", "-c", installStep.run],
      cwd,
      env,
    });

    expect(expected.status, expected.stderr).toBe(0);
    expect(expected.stdout).toMatch(/^@ast-grep\/cli@\d+\.\d+\.\d+\n$/u);
    expect(pipeline.status, pipeline.stderr).toBe(0);
    expect(pipeline.stdout).toBe(`install\n-g\n${expected.stdout}`);
  });

  it("refuses and names the installation command when npm is unavailable", () => {
    const cwd = owned("lisa-rails-ast-grep-missing-");
    const run = boundedSpawnSync({
      label: "missing Rails structural scanner",
      command: process.execPath,
      args: [path.join(template, script)],
      cwd,
      env: { ...process.env, PATH: cwd },
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Install Node.js with npm");
    expect(run.stderr).toMatch(
      /npm exec --yes --package=@ast-grep\/cli@\d+\.\d+\.\d+ -- ast-grep --version/u
    );
  });
});
