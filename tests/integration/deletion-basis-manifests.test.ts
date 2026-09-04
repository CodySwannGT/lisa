/**
 * Every shipped `deletions.json` says why each path may be removed, and the
 * authoring gate actually refuses one that does not.
 *
 * The second half is the point. A check that only asserts "the current
 * manifests pass" would pass equally well if the check were `exit 0` — it would
 * not be a control at all, merely a description. So these cases run the real
 * script against a fixture tree in all four states and assert it DISCRIMINATES:
 * refuses an unclassified path, refuses a `legacy:` with no prose, and accepts
 * a real basis.
 * @module tests/integration/deletion-basis-manifests
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../helpers/io-latency-budget.js";
import type { DeletionsConfig } from "../../src/core/config.js";
import { unclassifiedDeletionPaths } from "../../src/core/deletion-basis.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS = "scripts";
const CHECK_SCRIPT = "check-deletion-basis.mjs";
const DELETIONS_JSON = "deletions.json";
const NEEDS_REVIEW = "needs-review";
const FIXTURE_PATH = "a.ts";
const CHECK = path.join(REPO_ROOT, SCRIPTS, CHECK_SCRIPT);

const STACKS = [
  "all",
  "typescript",
  "expo",
  "rails",
  "nestjs",
  "cdk",
  "phaser",
  "harper-fabric",
] as const;

/** Exit status and combined output of one check run. */
interface CheckRun {
  status: number;
  output: string;
}

describe("shipped deletion manifests", () => {
  it.each(STACKS)("%s declares a basis for every path", stack => {
    const file = path.join(REPO_ROOT, stack, DELETIONS_JSON);
    if (!fs.existsSync(file)) return;
    const manifest = fs.readJsonSync(file) as DeletionsConfig;
    expect(unclassifiedDeletionPaths(manifest)).toEqual([]);
  });

  it("keeps the five force reasons that must reach an edited copy", () => {
    // The rejection control for this whole change. A gate that narrows what is
    // deleted must still delete the removals that are owner rulings — a
    // manifest that deletes nothing satisfies "stop over-deleting" completely.
    const manifest = fs.readJsonSync(
      path.join(REPO_ROOT, "typescript", DELETIONS_JSON)
    ) as DeletionsConfig;
    const forced = Object.entries(manifest.force ?? {});
    expect(forced.length).toBe(5);
    for (const [, reason] of forced)
      expect(reason.trim().length).toBeGreaterThan(0);
  });
});

describe("the authoring gate discriminates", () => {
  let root: string;

  /**
   * Run the real check against the fixture tree.
   * @returns Exit status and output.
   */
  const run = (): CheckRun => {
    try {
      const stdout = boundedExecFileSync({
        label: "check-deletion-basis",
        command: process.execPath,
        args: [path.join(root, SCRIPTS, CHECK_SCRIPT)],
        env: process.env as Record<string, string>,
      });
      return { status: 0, output: stdout };
    } catch (error) {
      const failure = error as {
        status?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        status: failure.status ?? 1,
        output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      };
    }
  };

  /**
   * Write the fixture manifest.
   * @param manifest - Contents for phaser/deletions.json.
   */
  const write = (manifest: DeletionsConfig): void => {
    fs.writeJsonSync(path.join(root, "phaser", DELETIONS_JSON), manifest, {
      spaces: 2,
    });
  };

  beforeAll(() => {
    // The script resolves the repo root from its own location, so the fixture
    // is a tree with the same shape rather than an env override — that keeps
    // the script's real path resolution under test instead of stubbing it out.
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-basis-gate-"));
    fs.ensureDirSync(path.join(root, SCRIPTS));
    fs.ensureDirSync(path.join(root, "phaser"));
    fs.copyFileSync(CHECK, path.join(root, SCRIPTS, CHECK_SCRIPT));
  });

  afterAll(() => {
    if (root) fs.removeSync(root);
  });

  it("accepts a fully classified manifest", () => {
    write({ paths: [FIXTURE_PATH], basis: { [FIXTURE_PATH]: NEEDS_REVIEW } });
    expect(run().status).toBe(0);
  });

  it("REFUSES a declared path with no basis, and names it", () => {
    write({
      paths: [FIXTURE_PATH, "orphan.ts"],
      basis: { [FIXTURE_PATH]: NEEDS_REVIEW },
    });
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("orphan.ts");
  });

  it("REFUSES a legacy basis carrying no reason", () => {
    write({ paths: [FIXTURE_PATH], basis: { [FIXTURE_PATH]: "legacy:" } });
    expect(run().status).not.toBe(0);
  });

  it("accepts a legacy basis carrying a reason", () => {
    write({
      paths: [FIXTURE_PATH],
      basis: { [FIXTURE_PATH]: "legacy: renamed in 4.20.0" },
    });
    expect(run().status).toBe(0);
  });

  it("accepts a force entry as a basis in its own right", () => {
    write({
      paths: [FIXTURE_PATH],
      force: { [FIXTURE_PATH]: "Removed fleet-wide (#3590)" },
    });
    expect(run().status).toBe(0);
  });

  it("does not demand a basis for a path the manifest keeps", () => {
    write({ paths: [FIXTURE_PATH], keep: [FIXTURE_PATH] });
    expect(run().status).toBe(0);
  });

  it("reports the outstanding needs-review debt on success", () => {
    // The number this change deliberately took on. It belongs in the check's
    // own output so it is visible on every run rather than discovered later.
    write({ paths: [FIXTURE_PATH], basis: { [FIXTURE_PATH]: NEEDS_REVIEW } });
    expect(run().output).toContain(NEEDS_REVIEW);
  });
});
