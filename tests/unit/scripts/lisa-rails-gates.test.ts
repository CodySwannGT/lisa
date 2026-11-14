/**
 * The Rails pre-push gate script's decisions (CodySwannGT/lisa#4613): which
 * projects get the pass cache and admission by default, when a full RSpec run
 * goes parallel, and how many workers it asks for. The script imports
 * `./lib/…` as it does in a host, so it is loaded from a copy laid out the way
 * `lisa apply` delivers it. End-to-end behaviour lives in
 * `tests/integration/rails-push-gate-cache.test.ts`.
 */
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SCRIPT_NAME = "lisa-rails-gates.mjs";
const SPEC = "spec/a_spec.rb";
const installed = mkdtempSync(path.join(tmpdir(), "lisa-rails-gates-unit-"));
const roots: string[] = [installed];

mkdirSync(path.join(installed, "lib"));
copyFileSync(
  path.join(REPO_ROOT, `rails/copy-overwrite/scripts/${SCRIPT_NAME}`),
  path.join(installed, SCRIPT_NAME)
);
// The script imports into lib/, so the fixture copies lib/ whole rather than
// keeping a second list of its dependencies.
cpSync(
  path.join(REPO_ROOT, "all/copy-overwrite/scripts/lib"),
  path.join(installed, "lib"),
  { recursive: true }
);

const gates = (await import(
  pathToFileURL(path.join(installed, SCRIPT_NAME)).href
)) as {
  CHECK_GATES: readonly string[];
  isRailsProject: (root: string) => boolean;
  railsEffectiveConfig: (
    config: unknown,
    root: string
  ) => {
    pushGate?: unknown;
  };
  parallelDatabaseReady: (root: string) => boolean;
  mutationEnabled: (root: string) => boolean;
  grantedWorkers: (env: Record<string, string>) => number;
  declaredWorkers: (env: Record<string, string>) => number;
  rspecCommand: (options: {
    root: string;
    plan: { kind: string; specs: string[] };
    workers: number;
  }) => { argv: string[]; parallel: boolean; hint: string | null };
};

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A project directory holding the given files.
 * @param files - Relative path to contents
 * @returns Project root
 */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-rails-gates-host-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  return root;
}

const PARALLEL_LOCK = "GEM\n  specs:\n    parallel_tests (5.9.0)\n";
const NUMBERED_DB =
  "default: &default\n  adapter: postgresql\ntest:\n  <<: *default\n  database: app_test<%= ENV['TEST_ENV_NUMBER'] %>\n";

describe("Rails defaults", () => {
  it.each([
    ["bin/rails", true],
    ["config/application.rb", true],
    ["Gemfile", false],
  ])("detects a Rails project by %s: %s", (marker, rails) => {
    expect(gates.isRailsProject(project({ [marker]: "" }))).toBe(rails);
  });

  it("turns the shared Rails defaults on for a Rails project", () => {
    // One table, in lib/push-gate-defaults.mjs, for every stack.
    const root = project({ "bin/rails": "" });
    expect(gates.railsEffectiveConfig({}, root).pushGate).toEqual({
      cache: true,
      admission: true,
      affectedTests: true,
      affectedCoverage: "changed-files",
    });
  });

  it("lets an explicit false win", () => {
    const root = project({ "bin/rails": "" });
    expect(
      gates.railsEffectiveConfig(
        { pushGate: { cache: false, admission: false } },
        root
      ).pushGate
    ).toMatchObject({ cache: false, admission: false });
  });

  it("leaves a non-Rails project and a malformed block untouched", () => {
    expect(gates.railsEffectiveConfig({}, project({})).pushGate).toBe(
      undefined
    );
    const root = project({ "bin/rails": "" });
    expect(gates.railsEffectiveConfig({ pushGate: true }, root).pushGate).toBe(
      true
    );
  });

  it("checks every cacheable gate and never the mutation gate", () => {
    expect(gates.CHECK_GATES).toEqual([
      "rspec",
      "brakeman",
      "reek",
      "flog",
      "flay",
    ]);
  });
});

describe("mutation gate switch", () => {
  it.each([
    ["enabled: true\n", true],
    ["mode: x\n  enabled:   true # on\n", true],
    ["enabled:\ttrue\r\n", true],
    ["enabled: false\n", false],
    ["enabled: trueish\n", false],
    ["# enabled: true\n", false],
  ])("reads %j as %s", (text, enabled) => {
    expect(gates.mutationEnabled(project({ "mutation.gate.yml": text }))).toBe(
      enabled
    );
  });

  it("is off with no mutation.gate.yml", () => {
    expect(gates.mutationEnabled(project({}))).toBe(false);
  });
});

describe("parallel full RSpec run", () => {
  it("reads TEST_ENV_NUMBER only inside the test: block", () => {
    expect(
      gates.parallelDatabaseReady(
        project({ "config/database.yml": NUMBERED_DB })
      )
    ).toBe(true);
    expect(
      gates.parallelDatabaseReady(
        project({
          "config/database.yml":
            "development:\n  database: dev<%= ENV['TEST_ENV_NUMBER'] %>\ntest:\n  database: app_test\n",
        })
      )
    ).toBe(false);
    expect(gates.parallelDatabaseReady(project({}))).toBe(false);
  });

  it("runs parallel_rspec with exactly the admitted workers", () => {
    const root = project({
      "config/database.yml": NUMBERED_DB,
      "Gemfile.lock": PARALLEL_LOCK,
    });
    expect(
      gates.rspecCommand({
        root,
        plan: { kind: "full", specs: [] },
        workers: 3,
      })
    ).toEqual({
      argv: ["bundle", "exec", "parallel_rspec", "-n", "3"],
      parallel: true,
      hint: null,
    });
  });

  it("stays serial with a hint when the database name lacks TEST_ENV_NUMBER", () => {
    const root = project({
      "config/database.yml": "test:\n  database: app_test\n",
      "Gemfile.lock": PARALLEL_LOCK,
    });
    const command = gates.rspecCommand({
      root,
      plan: { kind: "full", specs: [] },
      workers: 3,
    });
    expect(command.argv).toEqual(["bundle", "exec", "rspec"]);
    expect(command.hint).toMatch(/TEST_ENV_NUMBER.*config\/database\.yml/u);
    expect(command.hint?.split("\n")).toHaveLength(1);
  });

  it("reads parallel_tests only as an indented Gemfile.lock spec line", () => {
    const command = (lock: string) =>
      gates.rspecCommand({
        root: project({
          "config/database.yml": NUMBERED_DB,
          "Gemfile.lock": lock,
        }),
        plan: { kind: "full", specs: [] },
        workers: 3,
      }).parallel;
    expect(command(PARALLEL_LOCK)).toBe(true);
    expect(command("GEM\r\n  specs:\r\n    parallel_tests (5.9.0)\r\n")).toBe(
      true
    );
    expect(command("parallel_tests (5.9.0)\n")).toBe(false);
    expect(command("GEM\n  specs:\n    parallel_tests_extra (1.0)\n")).toBe(
      false
    );
  });

  it("stays serial with a hint when parallel_tests is not bundled", () => {
    const root = project({ "config/database.yml": NUMBERED_DB });
    const command = gates.rspecCommand({
      root,
      plan: { kind: "full", specs: [] },
      workers: 3,
    });
    expect(command.parallel).toBe(false);
    expect(command.hint).toMatch(/parallel_tests/u);
  });

  it("stays serial, silently, for one worker or a selection", () => {
    const root = project({
      "config/database.yml": NUMBERED_DB,
      "Gemfile.lock": PARALLEL_LOCK,
    });
    expect(
      gates.rspecCommand({
        root,
        plan: { kind: "full", specs: [] },
        workers: 1,
      })
    ).toEqual({
      argv: ["bundle", "exec", "rspec"],
      parallel: false,
      hint: null,
    });
    expect(
      gates.rspecCommand({
        root,
        plan: { kind: "partial", specs: [SPEC] },
        workers: 4,
      }).argv
    ).toEqual(["bundle", "exec", "rspec", SPEC]);
  });

  it("reads the grant and the declared demand", () => {
    expect(gates.grantedWorkers({ LISA_ADMITTED_WORKERS: "3" })).toBe(3);
    expect(gates.grantedWorkers({})).toBe(1);
    expect(gates.grantedWorkers({ LISA_ADMITTED_WORKERS: "zero" })).toBe(1);
    expect(gates.declaredWorkers({ LISA_ADMISSION_RSPEC_WORKERS: "5" })).toBe(
      5
    );
    expect(gates.declaredWorkers({})).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Install the script beside a stand-in affected-spec selector
 * (CodySwannGT/lisa#4612) and load it.
 * @param selector - Source of `lisa-rspec-select.mjs`
 * @returns The loaded script's `runPayload`
 */
async function withSelector(
  selector: string
): Promise<
  (
    id: string,
    root: string,
    env: Record<string, string>,
    out: (line: string) => void
  ) => Promise<number>
> {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-rails-gates-select-"));
  roots.push(dir);
  mkdirSync(path.join(dir, "lib"));
  copyFileSync(path.join(installed, SCRIPT_NAME), path.join(dir, SCRIPT_NAME));
  cpSync(path.join(installed, "lib"), path.join(dir, "lib"), {
    recursive: true,
  });
  writeFileSync(path.join(dir, "lisa-rspec-select.mjs"), selector);
  const loaded = (await import(
    pathToFileURL(path.join(dir, SCRIPT_NAME)).href
  )) as { runPayload: Awaited<ReturnType<typeof withSelector>> };
  return loaded.runPayload;
}

const PARTIAL_PLAN = `export const planRspecRun = () => ({ kind: "partial", specs: [${JSON.stringify(SPEC)}], lines: ["selected 1 spec"] });`;

describe("partial RSpec plans (CodySwannGT/lisa#4612)", () => {
  it("hands a partial plan to the selector's runRspecPlan, so its coverage check runs", async () => {
    const runPayload = await withSelector(
      `${PARTIAL_PLAN}\nexport const runRspecPlan = ({ plan, cwd }) => { globalThis.ran = { specs: plan.specs, cwd }; return 7; };`
    );
    const root = project({});
    const lines: string[] = [];
    expect(await runPayload("rspec", root, {}, line => lines.push(line))).toBe(
      7
    );
    expect((globalThis as { ran?: unknown }).ran).toEqual({
      specs: [SPEC],
      cwd: root,
    });
    expect(lines).toContain("selected 1 spec");
  });

  it("runs the full suite rather than a bare partial rspec when the selector cannot run the plan", async () => {
    const runPayload = await withSelector(PARTIAL_PLAN);
    const root = project({});
    const lines: string[] = [];
    // No `bundle` on PATH here, so the run exits 127; the line says what ran.
    await runPayload("rspec", root, { PATH: "/nonexistent" }, line =>
      lines.push(line)
    );
    expect(lines).toContain("▶️  rspec: bundle exec rspec");
    expect(lines.join("\n")).toMatch(/running the full suite/u);
  });
});
