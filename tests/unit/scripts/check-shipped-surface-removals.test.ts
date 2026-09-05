/**
 * Unit tests for scripts/check-shipped-surface-removals.mjs (issue #3849).
 *
 * In this repository removal is structurally harder than addition, and that
 * asymmetry is the whole defect. The copy lanes overwrite and never delete, and
 * `deepMergeWithArrayUnion` unions - so a template edit can ADD to a host's
 * tree and can never remove from it. A removal made upstream with neither a
 * deletions entry nor a migration does nothing downstream, silently, while
 * looking complete in the diff.
 *
 * Four tests carry more weight than the rest:
 *
 *   - `the live repository is governed` IS the gate. It is what turns this file
 *     from documentation into enforcement.
 *   - `names those same removals when no manifest propagates them` is the bite
 *     arm. A check that passes today proves nothing about whether it would fail
 *     tomorrow.
 *   - `says nothing about removals the live deletions manifests propagate` and
 *     `does not flag an import of a name that exists` are the rejection
 *     controls. A check that flagged every deletion would be disabled inside a
 *     week, and this repository has a live precedent for exactly that failure
 *     of proportion.
 *
 * The first three run against this repository's own history rather than a
 * fixture, driving the SAME three real removals with the manifests swapped
 * underneath, so no assertion there can be satisfied by editing a fixture.
 *
 * `classifyRemovedPath` is tested directly rather than end to end for the
 * consumer-bindable arms: the live window happens to contain only workflow
 * removals, so there is no real bindable removal to drive them with. Saying so
 * is better than a fixture that pretends otherwise.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED rather than
 * computed by calling the functions under test.
 *
 * @module tests/unit/scripts/check-shipped-surface-removals
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { indexRemovals } from "../../../scripts/lib/shipped-surface.mjs";
import {
  buildReport,
  classifyRemovedPath,
  countImporters,
  deliveryView,
  findContradictedLedger,
  findGoverningDeletion,
  findRemovedPaths,
  findUnresolvedImports,
  humanReport,
  loadLedger,
  main,
  parseArgs,
  readDeletionManifests,
  shippedFilesAt,
  shippedParts,
  viewExports,
} from "../../../scripts/check-shipped-surface-removals.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Lexicographic comparator: a bare `Array#sort` is a lint failure here. */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

/** A shipped source path and the destination it governs, reused throughout. */
const SHIPPED_SOURCE = "typescript/copy-overwrite/scripts/x.mjs";
const SHIPPED_DESTINATION = "scripts/x.mjs";

/** The importer basename the injected readers branch on. */
const IMPORTER_BASENAME = "importer.mjs";

/** A removed destination no host could have bound to. */
const PLAIN_DESTINATION = "docs/thing.md";

/** A removed destination a host may have wired into its own package.json. */
const BINDABLE_DESTINATION = "scripts/check-thing.mjs";

/** The path used by the deletion-ancestry fixtures. */
const FORCED_DESTINATION = "scripts/forced.mjs";

/** The importer/exporter pair used by the import-resolution fixtures. */
const IMPORTER = "all/copy-overwrite/scripts/importer.mjs";
const EXPORTER = "all/copy-overwrite/scripts/exporter.mjs";
const EXPORTER_SOURCE = "export const present = 1;\n";

/** The still-shipped module used by the contradicted-ledger fixtures. */
const LIVE_MODULE = "all/copy-overwrite/scripts/live.mjs";

/** Collects what the gate writes, so exit codes can be read with the text. */
function run(argv: readonly string[]): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = main(argv, {
    stderr: {
      write: (text: string) => {
        stderr.push(text);
      },
    },
    stdout: {
      write: (text: string) => {
        stdout.push(text);
      },
    },
  });
  return { code, stderr: stderr.join(""), stdout: stdout.join("") };
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop() as string, {
      force: true,
      recursive: true,
    });
  }
});

describe("shippedParts", () => {
  it("splits a path inside a delivery lane", () => {
    expect(shippedParts(SHIPPED_SOURCE)).toEqual({
      lane: "copy-overwrite",
      relative: SHIPPED_DESTINATION,
      stack: "typescript",
    });
  });

  it("returns null for a path outside every lane", () => {
    expect(shippedParts("src/core/lisa.ts")).toBeNull();
  });

  it("returns null for a lane directory with no file under it", () => {
    expect(shippedParts("typescript/copy-overwrite")).toBeNull();
  });

  it("returns null for a manifest beside the lanes", () => {
    expect(shippedParts("typescript/deletions.json")).toBeNull();
  });
});

describe("classifyRemovedPath", () => {
  it("passes a path a deletions manifest propagates", () => {
    expect(
      classifyRemovedPath(
        ".github/workflows/x.yml",
        { by: "all", forced: false },
        false
      )
    ).toBeNull();
  });

  it("passes an unpropagated path the ledger records", () => {
    expect(
      classifyRemovedPath(".github/workflows/x.yml", null, true)
    ).toBeNull();
  });

  it("fails an unpropagated, unrecorded path and names the destination", () => {
    const verdict = classifyRemovedPath(PLAIN_DESTINATION, null, false);
    expect(verdict?.kind).toBe("unrecorded");
    expect(verdict?.reason).toContain(PLAIN_DESTINATION);
  });

  it("says what happens to a host, not that governance failed", () => {
    const verdict = classifyRemovedPath(PLAIN_DESTINATION, null, false);
    expect(verdict?.reason).toContain("no later upgrade removes it");
  });

  it("fails a consumer-bindable executable propagated without a force reason", () => {
    const verdict = classifyRemovedPath(
      BINDABLE_DESTINATION,
      { by: "typescript", forced: false },
      false
    );
    expect(verdict?.kind).toBe("propagated-bindable");
  });

  it("passes a consumer-bindable executable propagated WITH a force reason", () => {
    expect(
      classifyRemovedPath(
        BINDABLE_DESTINATION,
        { by: "typescript", forced: true },
        false
      )
    ).toBeNull();
  });

  it("fails an unrecorded bindable executable with the retain-and-notify remedy", () => {
    const verdict = classifyRemovedPath(BINDABLE_DESTINATION, null, false);
    expect(verdict?.kind).toBe("unrecorded-bindable");
    expect(verdict?.reason).toContain("must NOT be propagated");
  });

  it("passes a recorded bindable executable", () => {
    expect(classifyRemovedPath(BINDABLE_DESTINATION, null, true)).toBeNull();
  });
});

describe("findGoverningDeletion", () => {
  const manifests = new Map([
    ["all", { deleted: new Set(["docs/root.md"]), force: new Map() }],
    [
      "typescript",
      {
        deleted: new Set([FORCED_DESTINATION]),
        force: new Map([[FORCED_DESTINATION, "because"]]),
      },
    ],
    ["cdk", { deleted: new Set(["docs/child.md"]), force: new Map() }],
  ]);

  it("finds a deletion declared by the stack's own manifest", () => {
    expect(
      findGoverningDeletion("typescript", FORCED_DESTINATION, manifests)
    ).toEqual({ by: "typescript", forced: true });
  });

  it("finds a deletion declared by an ancestor, which is active too", () => {
    expect(findGoverningDeletion("cdk", "docs/root.md", manifests)).toEqual({
      by: "all",
      forced: false,
    });
  });

  it("does NOT count a descendant's deletion, which misses plain consumers", () => {
    expect(
      findGoverningDeletion("typescript", "docs/child.md", manifests)
    ).toBeNull();
  });

  it("returns null when nothing active deletes the path", () => {
    expect(
      findGoverningDeletion("cdk", "docs/absent.md", manifests)
    ).toBeNull();
  });
});

describe("deliveryView", () => {
  const shipped = new Map([
    [
      "all/copy-overwrite/scripts/x.mjs",
      { destination: SHIPPED_DESTINATION, stack: "all" },
    ],
    [SHIPPED_SOURCE, { destination: SHIPPED_DESTINATION, stack: "typescript" }],
    [
      "typescript/copy-overwrite/scripts/y.mjs",
      { destination: "scripts/y.mjs", stack: "typescript" },
    ],
    [
      "cdk/copy-overwrite/scripts/z.mjs",
      { destination: "scripts/z.mjs", stack: "cdk" },
    ],
  ]);

  it("lets the more specific stack win over its ancestor", () => {
    expect(deliveryView("typescript", shipped).get(SHIPPED_DESTINATION)).toBe(
      SHIPPED_SOURCE
    );
  });

  it("inherits an ancestor's file when the stack ships none", () => {
    expect(deliveryView("cdk", shipped).get("scripts/y.mjs")).toBe(
      "typescript/copy-overwrite/scripts/y.mjs"
    );
  });

  it("does not give a stack its descendant's files", () => {
    expect(deliveryView("typescript", shipped).has("scripts/z.mjs")).toBe(
      false
    );
  });
});

describe("viewExports", () => {
  const view = new Map([
    ["scripts/a.mjs", "s/a"],
    ["scripts/lib/b.mjs", "s/b"],
    ["scripts/cycle.mjs", "s/cycle"],
  ]);
  const sources: Record<string, string> = {
    "s/a": 'export const A = 1;\nexport * from "./lib/b.mjs";\n',
    "s/b": "export function B() {}\n",
    "s/cycle": 'export * from "./cycle.mjs";\nexport const C = 1;\n',
  };
  const read = (file: string): string => sources[file] ?? "";

  it("includes names inherited through a star re-export", () => {
    expect(
      [...(viewExports("scripts/a.mjs", view, read) ?? [])].sort(byName)
    ).toEqual(["A", "B"]);
  });

  it("returns null when nothing is shipped at the destination", () => {
    expect(viewExports("scripts/missing.mjs", view, read)).toBeNull();
  });

  it("terminates on a self-referential re-export", () => {
    expect([...(viewExports("scripts/cycle.mjs", view, read) ?? [])]).toEqual([
      "C",
    ]);
  });
});

describe("findUnresolvedImports", () => {
  const shipped = new Map([
    [IMPORTER, { destination: "scripts/importer.mjs", stack: "all" }],
    [EXPORTER, { destination: "scripts/exporter.mjs", stack: "all" }],
  ]);

  it("does not flag an import of a name that exists", () => {
    const read = (file: string): string =>
      file.endsWith(IMPORTER_BASENAME)
        ? 'import { present } from "./exporter.mjs";\n'
        : EXPORTER_SOURCE;
    expect(findUnresolvedImports({ read, shipped })).toEqual([]);
  });

  it("flags an import of a name the shipped target does not export", () => {
    const read = (file: string): string =>
      file.endsWith(IMPORTER_BASENAME)
        ? 'import { absent } from "./exporter.mjs";\n'
        : EXPORTER_SOURCE;
    const rows = findUnresolvedImports({ read, shipped });
    expect(rows).toEqual([
      {
        export: "absent",
        path: IMPORTER,
        stack: "all",
        target: EXPORTER,
      },
    ]);
  });

  it("does not flag a specifier that resolves to nothing shipped", () => {
    const read = (file: string): string =>
      file.endsWith(IMPORTER_BASENAME)
        ? 'import { anything } from "./host-owned.mjs";\n'
        : EXPORTER_SOURCE;
    expect(findUnresolvedImports({ read, shipped })).toEqual([]);
  });
});

describe("countImporters", () => {
  it("counts distinct importer files, not resolutions per stack view", () => {
    const shipped = new Map([
      [
        "all/copy-overwrite/scripts/lib.mjs",
        { destination: "scripts/lib.mjs", stack: "all" },
      ],
      [
        "all/copy-overwrite/scripts/one.mjs",
        { destination: "scripts/one.mjs", stack: "all" },
      ],
      [
        "cdk/copy-overwrite/scripts/two.mjs",
        { destination: "scripts/two.mjs", stack: "cdk" },
      ],
    ]);
    const read = (file: string): string =>
      file.endsWith("lib.mjs")
        ? "export const shared = 1;\n"
        : 'import { shared } from "./lib.mjs";\n';
    expect(
      countImporters(shipped, read).get("all/copy-overwrite/scripts/lib.mjs")
    ).toBe(2);
  });
});

describe("findContradictedLedger", () => {
  const shipped = new Map([
    [LIVE_MODULE, { destination: "scripts/live.mjs", stack: "all" }],
  ]);
  const read = (): string => "export const STILL_HERE = 1;\n";

  it("flags a whole-file entry for a path still shipped", () => {
    const rows = findContradictedLedger({
      read,
      removals: [{ note: "n", path: LIVE_MODULE }],
      shipped,
    });
    expect(rows).toEqual([{ kind: "still-shipped", path: LIVE_MODULE }]);
  });

  it("flags an export entry for a symbol still exported", () => {
    const rows = findContradictedLedger({
      read,
      removals: [
        {
          export: "STILL_HERE",
          note: "n",
          path: LIVE_MODULE,
        },
      ],
      shipped,
    });
    expect(rows).toEqual([
      {
        export: "STILL_HERE",
        kind: "still-exported",
        path: LIVE_MODULE,
      },
    ]);
  });

  it("accepts an entry for a symbol genuinely gone", () => {
    expect(
      findContradictedLedger({
        read,
        removals: [
          {
            export: "GONE",
            note: "n",
            path: LIVE_MODULE,
          },
        ],
        shipped,
      })
    ).toEqual([]);
  });

  it("leaves an entry older than the window alone, as the historical record", () => {
    expect(
      findContradictedLedger({
        read,
        removals: [
          { note: "n", path: "all/copy-overwrite/scripts/ancient.mjs" },
        ],
        shipped,
      })
    ).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("defaults to the repository root with no baseline override", () => {
    expect(parseArgs([])).toEqual({
      json: false,
      root: REPO_ROOT,
      since: null,
    });
  });

  it("accepts --since", () => {
    expect(parseArgs(["--since", "v4.0.0"]).since).toBe("v4.0.0");
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseArgs(["--nope"])).toThrow("unknown argument: --nope");
  });

  it("rejects a flag whose value is another flag", () => {
    expect(() => parseArgs(["--since", "--json"])).toThrow(
      "--since requires a value"
    );
  });
});

describe("loadLedger", () => {
  it("reads the live ledger", () => {
    expect(typeof loadLedger(REPO_ROOT).baseline).toBe("string");
  });

  it("refuses a directory with no ledger rather than scanning nothing", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "lisa-removals-"));
    temporaryDirectories.push(directory);
    expect(() => loadLedger(directory)).toThrow("could not read");
  });
});

describe("report rendering", () => {
  it("summarises a clean scan without listing anything", () => {
    const report = buildReport(
      { exports: [], imports: [], ledger: [], paths: [] },
      { baseline: "v4.0.0", recorded: 4, root: "/repo", shipped: 320 }
    );
    expect(report.summary.violations).toBe(0);
    expect(humanReport(report)).toContain(
      "every removal from a shipped surface is governed"
    );
  });

  it("names the file, the release, and the host consequence for an export removal", () => {
    const report = buildReport(
      {
        exports: [
          {
            export: "SNAPSHOT_MAX_AGE_DAYS",
            importers: 0,
            kind: "unrecorded-export",
            path: "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs",
            release: "v4.31.0",
          },
        ],
        imports: [],
        ledger: [],
        paths: [],
      },
      { baseline: "v4.0.0", recorded: 0, root: "/repo", shipped: 320 }
    );
    const rendered = humanReport(report);
    expect(report.summary.violations).toBe(1);
    expect(rendered).toContain("SNAPSHOT_MAX_AGE_DAYS");
    expect(rendered).toContain("v4.31.0");
    expect(rendered).toContain("does not provide an export named");
  });
});

/**
 * Both arms against the repository's own history, driven by the same real
 * removals with the manifests swapped underneath. Nothing here is a fixture, so
 * neither assertion can be satisfied by editing one.
 *
 * The removals in the window are three workflow files retired fleet-wide, all
 * of them declared in `typescript/deletions.json`. With the live manifests they
 * are governed and the detector must stay silent; with the manifests emptied
 * they are exactly the shape this gate exists to catch, and it must name them.
 *
 * An implementation that reported nothing passes the second and fails the
 * first. One that ignored the manifests passes the first and fails the second.
 * Only a detector that actually consults them passes both.
 */
describe("the removal detector, both arms", () => {
  const BASELINE = "v4.0.0";
  const REMOVED_IN_WINDOW =
    "typescript/create-only/.github/workflows/required-checks-drift.yml";

  const window = (): {
    after: Map<string, object>;
    before: Map<string, object>;
  } => ({
    after: shippedFilesAt(REPO_ROOT, "HEAD"),
    before: shippedFilesAt(REPO_ROOT, BASELINE),
  });

  it("says nothing about removals the live deletions manifests propagate", () => {
    const rows = findRemovedPaths({
      ...window(),
      baseline: BASELINE,
      ledger: new Map(),
      manifests: readDeletionManifests(REPO_ROOT),
      root: REPO_ROOT,
    });
    expect(rows).toEqual([]);
  });

  it("names those same removals when no manifest propagates them", () => {
    const rows = findRemovedPaths({
      ...window(),
      baseline: BASELINE,
      ledger: new Map(),
      manifests: new Map(),
      root: REPO_ROOT,
    });
    expect(rows.map(row => row.path)).toContain(REMOVED_IN_WINDOW);
    expect(rows.every(row => row.kind === "unrecorded")).toBe(true);
  });

  it("accepts a ledger note in place of a manifest entry", () => {
    const rows = findRemovedPaths({
      ...window(),
      baseline: BASELINE,
      ledger: indexRemovals([
        { note: "retained deliberately", path: REMOVED_IN_WINDOW },
      ]),
      manifests: new Map(),
      root: REPO_ROOT,
    });
    expect(rows.map(row => row.path)).not.toContain(REMOVED_IN_WINDOW);
  });
});

describe("the gate", () => {
  it("the live repository is governed", () => {
    const result = run([]);
    expect(result.stdout).toContain(
      "every removal from a shipped surface is governed"
    );
    expect(result.code).toBe(0);
  });

  it("refuses a root that is not a directory rather than passing", () => {
    const result = run(["--root", path.join(REPO_ROOT, "no-such-directory")]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("is not a directory");
  });

  it("refuses a directory that carries no ledger", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "lisa-removals-"));
    temporaryDirectories.push(directory);
    const result = run(["--root", directory]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
  });

  it("exits 1 and names the surface when the window contains ungoverned removals", () => {
    // The previous major line carries removals nobody back-filled - which is
    // what `baseline` is for, and is also the only way to drive `main` to a
    // finding without inventing one. Reaching further back than the supported
    // major must therefore FAIL, and the specific path asserted here was
    // removed in v3.45.7 and cannot change retroactively.
    const result = run(["--since", "v3.0.0"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "harper-fabric/copy-overwrite/.github/dependabot.yml"
    );
    expect(result.stdout).toContain(
      "ungoverned change(s) to a shipped surface"
    );
  });

  it("emits machine-readable output on request", () => {
    const parsed = JSON.parse(run(["--json"]).stdout) as {
      schemaVersion: number;
      summary: { violations: number };
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.summary.violations).toBe(0);
  });
});
