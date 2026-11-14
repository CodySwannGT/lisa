/**
 * The pure decisions behind the Rails pre-push spec selection
 * (CodySwannGT/lisa#4612): settings and their Rails defaults, the full-suite
 * triggers, the map-driven selection with its always-run groups, the map
 * merge and artifact choice, and the changed-file coverage check.
 * @module tests/unit/scripts/rspec-selection
 */
import { describe, expect, it } from "vitest";

import {
  alwaysRunSpecs,
  associatedSpec,
  changedRubyCoverage,
  chooseMapRun,
  filePercentages,
  isRailsProject,
  mergeMapDocuments,
  nocovLines,
  parseMapArtifacts,
  railsTrigger,
  rspecSelectionSettings,
  selectRailsSpecs,
  taggedAlwaysRun,
} from "../../../all/copy-overwrite/scripts/lib/rspec-selection.mjs";

const USER_SPEC = "spec/models/user_spec.rb";
const REQUEST_SPEC = "spec/requests/users_spec.rb";
const POST_SPEC = "spec/models/post_spec.rb";
const SYSTEM_SPEC = "spec/system/login_spec.rb";
const USER = "app/models/user.rb";
const POST = "app/models/post.rb";

const MAP = {
  [USER_SPEC]: [USER, "app/models/concerns/named.rb"],
  [REQUEST_SPEC]: [USER, "app/controllers/users_controller.rb"],
  [POST_SPEC]: [POST],
};

const SPECS = new Set([USER_SPEC, REQUEST_SPEC, POST_SPEC, SYSTEM_SPEC]);

const exists = (file: string) => SPECS.has(file) || !file.startsWith("spec/");

/**
 * Select for a list of modified paths.
 * @param paths - Changed paths
 * @param alwaysRun - Always-run specs
 * @returns The selection
 */
function select(paths: string[], alwaysRun: string[] = []) {
  return selectRailsSpecs({
    changed: paths.map(path => ({ path, status: "modified" as const })),
    map: MAP,
    alwaysRun,
    exists,
  });
}

describe("rspecSelectionSettings", () => {
  it("is on with changed-files coverage for a Rails project that names nothing", () => {
    expect(rspecSelectionSettings({}, true)).toEqual({
      enabled: true,
      coverage: "changed-files",
    });
  });

  it("is off for a project that is not Rails and names nothing", () => {
    expect(rspecSelectionSettings({}, false).enabled).toBe(false);
  });

  it("honours an explicit false and an explicit coverage mode", () => {
    expect(
      rspecSelectionSettings(
        { pushGate: { affectedTests: false, affectedCoverage: "skip" } },
        true
      )
    ).toEqual({ enabled: false, coverage: "skip" });
  });

  it("refuses a wrong type instead of defaulting it", () => {
    expect(() =>
      rspecSelectionSettings({ pushGate: { affectedTests: "yes" } }, true)
    ).toThrow(/expected true or false/);
    expect(() =>
      rspecSelectionSettings({ pushGate: { affectedCoverage: "most" } }, true)
    ).toThrow(/affectedCoverage/);
  });
});

describe("isRailsProject", () => {
  it("detects bin/rails or config/application.rb", () => {
    expect(isRailsProject(file => file === "bin/rails")).toBe(true);
    expect(isRailsProject(file => file === "config/application.rb")).toBe(true);
    expect(isRailsProject(() => false)).toBe(false);
  });
});

describe("railsTrigger", () => {
  it.each([
    ["Gemfile.lock", "lockfile"],
    ["Gemfile", "Gemfile"],
    ["db/schema.rb", "schema"],
    ["db/structure.sql", "schema"],
    ["config/routes.rb", "config/"],
    ["spec/support/auth.rb", "support"],
    ["spec/rails_helper.rb", "helper"],
    [".rspec", "RSpec"],
    ["scripts/lisa-rspec-select.mjs", "machinery"],
    ["scripts/lisa_crystalball_recorder.rb", "machinery"],
  ])("fires for %s", (file, word) => {
    expect(railsTrigger([file])?.reason).toContain(word);
  });

  it("does not fire for application code or a nested helper", () => {
    expect(railsTrigger([USER, "spec/models/helper_spec.rb"])).toBeNull();
  });
});

describe("selectRailsSpecs", () => {
  it("runs the specs the map links to a changed model, its conventional spec, and the always-run groups", () => {
    const selection = select([POST], [SYSTEM_SPEC]);
    expect(selection).toEqual({
      kind: "partial",
      reason: null,
      specs: [
        { file: POST_SPEC, reason: `map: ${POST}` },
        { file: SYSTEM_SPEC, reason: "always run" },
      ],
      ignored: [],
    });
  });

  it("runs every reader of a shared file", () => {
    const files = select([USER]).specs.map(spec => spec.file);
    expect(files).toEqual([USER_SPEC, REQUEST_SPEC]);
  });

  it("runs a changed spec and drops a deleted one", () => {
    const selection = selectRailsSpecs({
      changed: [
        { path: POST_SPEC, status: "modified" },
        { path: "spec/models/gone_spec.rb", status: "deleted" },
      ],
      map: MAP,
      alwaysRun: [],
      exists,
    });
    expect(selection.specs).toEqual([
      { file: POST_SPEC, reason: "changed spec" },
    ]);
  });

  it("runs the full suite for a trigger file, naming it", () => {
    expect(select([POST, "Gemfile.lock"])).toMatchObject({
      kind: "full",
      reason: expect.stringContaining("(Gemfile.lock)"),
    });
  });

  it("runs the full suite for a file the map has never seen", () => {
    expect(select(["app/views/users/show.html.erb"])).toMatchObject({
      kind: "full",
      reason: expect.stringContaining(
        "unmapped file: app/views/users/show.html.erb"
      ),
    });
  });

  it("ignores files RSpec never loads", () => {
    const selection = select(["README.md", ".github/workflows/ci.yml", POST]);
    expect(selection.kind).toBe("partial");
    expect(selection.ignored).toEqual([
      "README.md",
      ".github/workflows/ci.yml",
    ]);
  });

  it("skips a deleted application file that nothing read", () => {
    const selection = selectRailsSpecs({
      changed: [{ path: "app/models/old.rb", status: "deleted" }],
      map: MAP,
      alwaysRun: [],
      exists,
    });
    expect(selection).toMatchObject({ kind: "partial", specs: [] });
  });
});

describe("associatedSpec", () => {
  it("pairs app/ and lib/ files with their conventional spec", () => {
    expect(associatedSpec(USER)).toBe(USER_SPEC);
    expect(associatedSpec("lib/tasks/sync.rb")).toBe(
      "spec/lib/tasks/sync_spec.rb"
    );
    expect(associatedSpec("config/routes.rb")).toBeNull();
  });
});

describe("always-run specs", () => {
  it.each([
    ["it 'renders', :js do", true],
    ["describe 'x', js: true do", true],
    ["it 'calls out', lisa_always_run: true do", true],
    ["describe 'x', :lisa_always_run do", true],
    ["it 'is plain' do", false],
    ["# json: true", false],
  ])("%s -> %s", (source, expected) => {
    expect(taggedAlwaysRun(source)).toBe(expected);
  });

  it("collects the always-run folders, tagged specs and recorded specs that still exist", () => {
    const sources: Record<string, string> = {
      [SYSTEM_SPEC]: "",
      "spec/features/signup_spec.rb": "",
      "spec/requests/js_spec.rb": "it 'x', :js do",
      [USER_SPEC]: "",
      [POST_SPEC]: "",
    };
    expect(
      alwaysRunSpecs({
        specFiles: Object.keys(sources),
        recorded: [POST_SPEC, "spec/models/removed_spec.rb"],
        read: file => sources[file] ?? "",
      })
    ).toEqual([
      "spec/features/signup_spec.rb",
      POST_SPEC,
      "spec/requests/js_spec.rb",
      SYSTEM_SPEC,
    ]);
  });
});

describe("map documents and artifacts", () => {
  it("merges legs into the union of their entries", () => {
    const merged = mergeMapDocuments([
      {
        meta: { job: "shard-1" },
        map: { "spec/a_spec.rb": ["app/a.rb"] },
        alwaysRun: ["spec/a_spec.rb"],
      },
      {
        meta: { job: "shard-2" },
        map: { "spec/a_spec.rb": ["app/b.rb"], "spec/c_spec.rb": [] },
      },
      { not: "a map" },
    ]);
    expect(merged.map).toEqual({
      "spec/a_spec.rb": ["app/a.rb", "app/b.rb"],
      "spec/c_spec.rb": [],
    });
    expect(merged.alwaysRun).toEqual(["spec/a_spec.rb"]);
    expect(merged.metas).toHaveLength(2);
  });

  const base = "a".repeat(40);
  const older = "b".repeat(40);
  const listing = [
    {
      name: `crystalball-map-${base}-20-shard-1`,
      runId: 20,
      createdAt: "2026-11-02T00:00:00Z",
    },
    {
      name: `crystalball-map-${base}-20`,
      runId: 20,
      createdAt: "2026-11-02T00:01:00Z",
    },
    {
      name: `crystalball-map-${base}-10`,
      runId: 10,
      createdAt: "2026-11-01T00:00:00Z",
    },
    {
      name: `crystalball-map-${older}-5`,
      runId: 5,
      createdAt: "2026-10-30T00:00:00Z",
    },
    {
      name: `crystalball-map-${older}-4`,
      runId: 4,
      createdAt: "2026-10-29T00:00:00Z",
      expired: true,
    },
    { name: "test-access-map-x", runId: 1, createdAt: "2026-11-01T00:00:00Z" },
  ]
    .map(entry => JSON.stringify(entry))
    .join("\n");

  it("parses only live crystalball-map artifacts", () => {
    expect(
      parseMapArtifacts(`${listing}\nnot json`).map(entry => entry.runId)
    ).toEqual(["20", "20", "10", "5"]);
  });

  it("picks the newest run at the nearest base and only its merged map", () => {
    const choice = chooseMapRun(parseMapArtifacts(listing), sha =>
      sha === base ? 0 : sha === older ? 3 : undefined
    );
    expect(choice).toEqual({
      runId: "20",
      baseSha: base,
      distance: 0,
      names: [`crystalball-map-${base}-20`],
    });
  });

  it("falls back to an ancestor, and finds nothing when no base is one", () => {
    expect(
      chooseMapRun(parseMapArtifacts(listing), sha =>
        sha === older ? 3 : undefined
      )
    ).toMatchObject({ runId: "5", baseSha: older, distance: 3 });
    expect(
      chooseMapRun(parseMapArtifacts(listing), () => undefined)
    ).toBeUndefined();
  });
});

describe("changed-file coverage", () => {
  it("skips # :nocov: blocks", () => {
    expect([...nocovLines("a\n# :nocov:\nb\n# :nocov:\nc\n")]).toEqual([
      2, 3, 4,
    ]);
  });

  it("computes line and branch percentages from a resultset entry", () => {
    expect(
      filePercentages(
        {
          lines: [1, 1, 0, null, 1],
          branches: {
            "[:if, 0, 3, 4, 7, 7]": {
              "[:then, 1, 4, 6, 4, 7]": 1,
              "[:else, 2, 6, 6, 6, 7]": 0,
            },
          },
        },
        new Set()
      )
    ).toEqual({ line: 75, branch: 50 });
    expect(filePercentages({ lines: [null], branches: {} }, new Set())).toEqual(
      {
        line: null,
        branch: null,
      }
    );
  });

  it("holds each changed file to the floors on its own", () => {
    const resultset = {
      "Lisa partial push run": {
        coverage: {
          "/repo/app/models/user.rb": { lines: [1, 1, 1, 1], branches: {} },
          "/repo/app/models/post.rb": { lines: [1, 0, 0, 0], branches: {} },
        },
      },
    };
    expect(
      changedRubyCoverage({
        resultset,
        root: "/repo",
        files: [USER, POST, "lib/unloaded.rb"],
        thresholds: { line: 80, branch: 70 },
        read: () => "",
      })
    ).toEqual({
      shortfalls: ["app/models/post.rb: line coverage 25.00% is below 80%"],
      measured: [USER, POST],
      unmeasured: ["lib/unloaded.rb"],
    });
  });
});
