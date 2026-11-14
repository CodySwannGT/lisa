/**
 * The two Ruby halves of the Rails push-time spec selection
 * (CodySwannGT/lisa#4612), run by a real Ruby with the real gems
 * (gitlab-crystalball, rspec-core, simplecov) against a two-class project:
 *
 * - `lisa_crystalball_recorder.rb`, required into a full RSpec run, writes
 *   the map the pre-push selects from: each spec file to the application
 *   files it executed (coverage strategy) or that define the class it
 *   describes (described-class strategy), plus the specs tagged to always
 *   run. Unset, it does nothing.
 * - `lisa_rspec_partial_coverage.rb`, required into a partial run, keeps the
 *   project's SimpleCov minimums off the slice and writes the resultset to the
 *   directory the selector names — against a control run without it, which
 *   SimpleCov fails on the same minimums.
 *
 * The gems are installed for Lisa's own integration job; elsewhere the suite
 * is deferred to CI with the install command named.
 * @module tests/integration/rails-crystalball-ruby
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { changedRubyCoverage } from "../../all/copy-overwrite/scripts/lib/rspec-selection.mjs";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { probeSucceeds, suiteDeferral } from "../support/ci-runtime.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS = path.join(REPO_ROOT, "rails/copy-overwrite/scripts");

/** The map recorder. */
const RECORDER = "lisa_crystalball_recorder.rb";

/** The partial-run coverage hand-off. */
const PARTIAL = path.join(SCRIPTS, "lisa_rspec_partial_coverage.rb");

/** The spec a partial run selects. */
const ALPHA_SPEC = "spec/alpha_spec.rb";

/** The class that spec covers. */
const ALPHA = "lib/alpha.rb";

/** The hand-off's status file. */
const STATUS = "status.json";

/** Runs RSpec in-process so no gem binstub is needed. */
const RSPEC = "require 'rspec/core'; exit RSpec::Core::Runner.run(ARGV)";

const deferred = suiteDeferral(
  () =>
    probeSucceeds("ruby", [
      "-e",
      "require 'crystalball'; require 'rspec/core'; require 'simplecov'",
    ]),
  "Ruby with gitlab-crystalball, rspec-core and simplecov",
  "Run: gem install gitlab-crystalball:1.1.3 rspec-core:3.13.6 simplecov:1.3.2 --no-document"
);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A scratch directory removed after the test.
 * @returns Its real path
 */
function scratch(): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(tmpdir(), "lisa-crystalball-ruby-"))
  );
  roots.push(root);
  return root;
}

/**
 * Write files under a root.
 * @param root - Directory
 * @param files - Relative path to content
 */
function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body);
  }
}

/**
 * A project whose SimpleCov floor (100%) no single spec reaches, with one
 * class covered by line execution and one only by its described class.
 * @param simplecov - Whether spec_helper starts SimpleCov
 * @returns Project root
 */
function project(simplecov = true): string {
  const root = scratch();
  write(root, {
    [ALPHA]:
      "class Alpha\n  def value(flag)\n    if flag\n      1\n    else\n      2\n    end\n  end\nend\n",
    // An endless method: calling it moves no line count.
    "lib/beta.rb": "class Beta\n  def value = 3\nend\n",
    "spec/spec_helper.rb": `${
      simplecov
        ? "require 'simplecov'\nSimpleCov.start do\n  enable_coverage :branch\n  minimum_coverage line: 100, branch: 100\nend\n"
        : ""
    }require_relative '../lib/alpha'\nrequire_relative '../lib/beta'\n`,
    [ALPHA_SPEC]:
      "require 'spec_helper'\nRSpec.describe Alpha do\n  it { expect(Alpha.new.value(true)).to eq 1 }\nend\n",
    "spec/beta_spec.rb":
      "require 'spec_helper'\nRSpec.describe Beta do\n  it('works', :js) { expect(Beta.new.value).to eq 3 }\nend\n",
  });
  return root;
}

/**
 * Copy a managed Ruby file outside the project, as the workflow does.
 * @param name - File under rails/copy-overwrite/scripts
 * @returns The copy's path
 */
function outside(name: string): string {
  const copy = path.join(scratch(), name);
  fs.copyFileSync(path.join(SCRIPTS, name), copy);
  return copy;
}

/**
 * Run RSpec in a project.
 * @param root - Project root
 * @param args - RSpec arguments
 * @param env - Extra environment
 * @returns The outcome
 */
function rspec(root: string, args: string[], env: Record<string, string> = {}) {
  const { RUBYOPT: _opt, ...inherited } = process.env;
  return boundedSpawnSync({
    label: "rspec (crystalball ruby)",
    command: "ruby",
    args: ["-e", RSPEC, "--", ...args],
    cwd: root,
    env: { ...inherited, ...env },
  });
}

describe.skipIf(deferred)("lisa_crystalball_recorder.rb", () => {
  it("records each spec file's application files and the always-run specs", () => {
    const root = project();
    const out = path.join(scratch(), "map", "map.json");
    const outcome = rspec(root, ["--require", outside(RECORDER), "spec"], {
      LISA_CRYSTALBALL_MAP_OUT: out,
      LISA_CRYSTALBALL_BASE_SHA: "a".repeat(40),
      LISA_CRYSTALBALL_JOB: "unsharded",
      GITHUB_RUN_ID: "77",
    });
    // Every spec ran: the recorder never narrows the run it rides along on.
    expect(outcome.stdout).toContain("2 examples, 0 failures");
    const document = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(document.meta).toMatchObject({
      version: 1,
      tool: "gitlab-crystalball",
      toolVersion: "1.1.3",
      baseSha: "a".repeat(40),
      runId: "77",
      job: "unsharded",
    });
    expect(Date.parse(document.meta.createdAt)).not.toBeNaN();
    expect(document.map[ALPHA_SPEC]).toContain(ALPHA);
    // Line coverage alone cannot see an endless method run; the
    // described-class strategy links the spec to its class's file anyway.
    expect(document.map["spec/beta_spec.rb"]).toContain("lib/beta.rb");
    expect(document.map[ALPHA_SPEC]).not.toContain("lib/beta.rb");
    expect(document.alwaysRun).toEqual(["spec/beta_spec.rb"]);
  });

  it("records nothing and says why when SimpleCov is not measuring", () => {
    const root = project(false);
    const out = path.join(scratch(), "map.json");
    const outcome = rspec(root, ["--require", outside(RECORDER), "spec"], {
      LISA_CRYSTALBALL_MAP_OUT: out,
    });
    expect(outcome.status).toBe(0);
    expect(outcome.stderr).toContain(
      "no map recorded: nothing measures coverage"
    );
    expect(fs.existsSync(out)).toBe(false);
  });

  it("does nothing when LISA_CRYSTALBALL_MAP_OUT is unset", () => {
    const root = project(false);
    const outcome = rspec(root, ["--require", outside(RECORDER), "spec"]);
    expect(outcome.status).toBe(0);
    expect(outcome.stderr).not.toContain("lisa-crystalball-recorder");
  });
});

describe.skipIf(deferred)("lisa_rspec_partial_coverage.rb", () => {
  it("keeps the project's minimums off a partial run and hands its resultset to the selector", () => {
    const control = rspec(project(), [ALPHA_SPEC]);
    expect(
      control.status,
      "SimpleCov fails the slice without the hand-off"
    ).not.toBe(0);

    const root = project();
    const dir = path.join(scratch(), "partial");
    const outcome = rspec(root, ["--require", PARTIAL, ALPHA_SPEC], {
      LISA_RSPEC_PARTIAL_COVERAGE_DIR: dir,
    });
    expect(outcome.status, `${outcome.stdout}${outcome.stderr}`).toBe(0);
    expect(outcome.stdout).toContain("1 example, 0 failures");
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, STATUS), "utf8"))
    ).toMatchObject({
      measuring: true,
    });
    const resultset = JSON.parse(
      fs.readFileSync(path.join(dir, ".resultset.json"), "utf8")
    );
    expect(
      changedRubyCoverage({
        resultset,
        root,
        files: [ALPHA],
        thresholds: { line: 80, branch: 70 },
        read: file => fs.readFileSync(path.join(root, file), "utf8"),
      })
    ).toEqual({
      shortfalls: ["lib/alpha.rb: branch coverage 50.00% is below 70%"],
      measured: [ALPHA],
      unmeasured: [],
    });
    expect(fs.existsSync(path.join(root, "coverage", ".resultset.json"))).toBe(
      false
    );
  });

  it("reports a project that measures nothing as not measuring", () => {
    const root = project(false);
    const dir = path.join(scratch(), "partial");
    const outcome = rspec(root, ["--require", PARTIAL, ALPHA_SPEC], {
      LISA_RSPEC_PARTIAL_COVERAGE_DIR: dir,
    });
    expect(outcome.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, STATUS), "utf8"))).toEqual(
      {
        measuring: false,
      }
    );
  });
});
