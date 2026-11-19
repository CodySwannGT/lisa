/**
 * `lisa controls install-carriers` in a repository Lisa was never applied to
 * (CodySwannGT/lisa#4989).
 *
 * F-none is a small Python package: no `package.json`, no hook, nothing from
 * Lisa. A check is declared in it, the command is run, and then real git is
 * used the way an operator uses it. Three things are held:
 *
 * - A commit holding a planted violation is rejected, and a clean one passes
 *   having run the declared check.
 * - With Node taken off `PATH`, and nothing else, a commit fails and the
 *   message names Node. It never passes having checked nothing.
 * - A second run changes nothing and says so; `--check` writes nothing and
 *   says what a run would write.
 * @module tests/integration/controls-install-carriers
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compareCodeUnits } from "../../src/controls/canonical-json.js";
import {
  CARRIER_HOOKS_FOLDER,
  CARRIER_RECORD_PATH,
  CARRIER_RUNNER_PATH,
} from "../../src/controls/carrier-types.js";
import {
  CHECK_WOULD_CHANGE_EXIT_CODE,
  type InstallCarriersOptions,
} from "../../src/controls/commands/install-carriers.js";
import {
  type CarrierCommandRun,
  type CarrierRepository,
  carrierRepository,
  commitInstalled,
  commitLine,
  dirt,
  head,
  installCarriers,
  LINT_SHAPE,
  operatorEnv,
  operatorGit,
  PLANTED,
  runs,
  withoutNode,
} from "../support/carrier-install.js";

const HOOKS_PATH = "core.hooksPath";
const ALREADY_WIRED = "already-wired";
const CLEAN_LINE = "# a harmless comment";
const PLANTED_LINE = `# ${PLANTED}`;

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with a declared check, removed when the case ends.
 * @returns The repository
 */
function declared(): CarrierRepository {
  const built = carrierRepository();
  cleanups.push(built.repository.cleanup);
  return built;
}

/**
 * Build F-none, install the carriers and commit what was written.
 * @param options - The command's options
 * @returns The repository and the run
 */
async function installed(
  options: InstallCarriersOptions = {}
): Promise<{ built: CarrierRepository; run: CarrierCommandRun }> {
  const built = declared();
  const run = await installCarriers(built.root, options);
  commitInstalled(built.root);
  return { built, run };
}

/**
 * Read the value git has for a setting in a repository.
 * @param root - The repository
 * @param name - The setting
 * @returns The value, or an empty string when it is not set
 */
function setting(root: string, name: string): string {
  return operatorGit(root, ["config", "--get", name]).stdout.trim();
}

describe("install-carriers on a repository with no project type", () => {
  it("rejects a commit that holds a planted violation", async () => {
    const { built, run } = await installed();
    const before = head(built.root);
    const ranBefore = runs(built.commitRan);

    const commit = commitLine(built.root, PLANTED_LINE);

    expect(run.code).toBe(0);
    expect(commit.status).not.toBe(0);
    expect(`${commit.stdout}${commit.stderr}`).toContain(LINT_SHAPE);
    expect(runs(built.commitRan)).toBe(ranBefore + 1);
    expect(head(built.root)).toBe(before);
  });

  it("lets a clean commit through, having run the declared check", async () => {
    const { built } = await installed();
    const before = head(built.root);
    const ranBefore = runs(built.commitRan);

    const commit = commitLine(built.root, CLEAN_LINE);

    expect(commit.status).toBe(0);
    expect(runs(built.commitRan)).toBe(ranBefore + 1);
    expect(head(built.root)).not.toBe(before);
  });

  it("stops a commit and names Node when only Node is off PATH", async () => {
    const { built } = await installed();
    const before = head(built.root);
    const ranBefore = runs(built.commitRan);
    const nodeFree = withoutNode(operatorEnv());
    cleanups.push(nodeFree.cleanup);

    const commit = commitLine(built.root, CLEAN_LINE, nodeFree.env);

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toMatch(/^Commit stopped: Node\.js is missing/mu);
    expect(commit.stderr).not.toContain("command not found");
    expect(runs(built.commitRan)).toBe(ranBefore);
    expect(head(built.root)).toBe(before);
  });

  it("reports each enforcement point as installed, keyed by moment", async () => {
    const { built, run } = await installed();

    expect(run.result?.outcome).toBe("installed");
    expect(run.result?.hook_owner).toBe("none");
    expect(run.result?.enforcement_points).toEqual(
      ["commit", "push"].map(moment => ({
        hook: moment === "commit" ? "pre-commit" : "pre-push",
        kind: "git-hook",
        location: "local-checkout",
        moment,
        outcome: "installed",
        path: HOOKS_PATH,
        reason: null,
        wired_through: "none",
      }))
    );
    expect(setting(built.root, HOOKS_PATH)).toBe(CARRIER_HOOKS_FOLDER);
  });

  it("places the runner under scripts/ and records what it wrote", async () => {
    const { built, run } = await installed();
    const record = JSON.parse(
      readFileSync(path.join(built.root, CARRIER_RECORD_PATH), "utf8")
    ) as { files: string[] };
    const hook = path.join(built.root, CARRIER_HOOKS_FOLDER, "pre-commit");

    expect(run.result?.runner.outcome).toBe("installed");
    expect(run.result?.runner.files).toContain(CARRIER_RUNNER_PATH);
    expect(run.result?.runner.files).toContain("scripts/lisa-gates.mjs");
    expect(record.files).toEqual(
      [
        ...(run.result?.runner.files ?? []),
        `${CARRIER_HOOKS_FOLDER}/pre-commit`,
        `${CARRIER_HOOKS_FOLDER}/pre-push`,
      ].sort(compareCodeUnits)
    );
    expect(
      record.files.filter(file => !existsSync(path.join(built.root, file)))
    ).toEqual([]);
    expect(statSync(hook).mode & 0o111).not.toBe(0);
  });

  it("changes nothing on a second run and says so", async () => {
    const { built } = await installed();
    const before = dirt(built.root);

    const again = await installCarriers(built.root);

    expect(again.code).toBe(0);
    expect(again.result?.outcome).toBe(ALREADY_WIRED);
    expect(again.result?.changes).toEqual([]);
    expect(
      again.result?.enforcement_points.map(point => point.outcome)
    ).toEqual([ALREADY_WIRED, ALREADY_WIRED]);
    expect(again.said.join("\n")).toMatch(/Nothing changed/u);
    expect(dirt(built.root)).toBe(before);
  });

  it("writes nothing under --check and says what a run would write", async () => {
    const built = declared();

    const check = await installCarriers(built.root, { check: true });

    expect(check.code).toBe(CHECK_WOULD_CHANGE_EXIT_CODE);
    expect(check.result?.mode).toBe("check");
    expect(check.result?.changes).toContainEqual({
      action: "set",
      path: HOOKS_PATH,
    });
    expect(check.result?.changes).toContainEqual({
      action: "create",
      path: CARRIER_RUNNER_PATH,
    });
    expect(dirt(built.root)).toBe("");
    expect(setting(built.root, HOOKS_PATH)).toBe("");
  });

  it("passes --check once the carriers are installed", async () => {
    const { built } = await installed();

    const check = await installCarriers(built.root, { check: true });

    expect(check.code).toBe(0);
    expect(check.result?.changes).toEqual([]);
  });
});
