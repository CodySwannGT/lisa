/**
 * `lisa controls install-carriers` where hooks are already spoken for in a
 * way it must not disturb (CodySwannGT/lisa#4989).
 *
 * - A repository on a Lisa project type already has hooks that call the gate
 *   runner. A second call would run every gate twice, so nothing is added
 *   and the points are reported as already wired.
 * - A hook manager that is set up in the repository but not switched on in
 *   this checkout runs nothing here. The carrier is still declared where the
 *   manager will find it, and the point is reported as blocked, with the
 *   command that switches the manager on.
 * - Hooks that live outside the repository, and a manager file Lisa itself
 *   replaces on every update, are left exactly as they are.
 * @module tests/integration/controls-install-carriers-existing-wiring
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { carrierCall } from "../../src/controls/carrier-script.js";
import { CARRIERS_BLOCKED_EXIT_CODE } from "../../src/controls/commands/install-carriers.js";
import { buildFPaved } from "../helpers/control-audit-fixtures.js";
import {
  gitHooksFolder,
  hostHookScript,
  installHusky,
  installManagerStandIn,
  type OwnedRepository,
  ownedRepository,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import {
  commitInstalled,
  commitLine,
  dirt,
  installCarriers,
  operatorGit,
  runs,
} from "../support/carrier-install.js";

const REPO_ROOT = path.resolve(__dirname, "../..");
const STACK_HOOKS = path.join(REPO_ROOT, "typescript/copy-contents/.husky");
const SHIPPED_LEFTHOOK = path.join(
  REPO_ROOT,
  "rails/copy-overwrite/lefthook.yml"
);
const COMMIT_HOOK = "pre-commit";
const HOOKS = [COMMIT_HOOK, "pre-push"] as const;
const LEFTHOOK_CONFIG = "lefthook.yml";
const BLOCKED = ["blocked", "blocked"];
const ALREADY_WIRED = "already-wired";
const LEFTHOOK = "lefthook";
const HUSKY_HOOK = ".husky/pre-commit";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with a declared check, removed when the case ends.
 * @returns The repository
 */
function owned(): OwnedRepository {
  const built = ownedRepository();
  cleanups.push(built.repository.cleanup);
  return built;
}

/**
 * Build F-paved holding the hooks Lisa's TypeScript project type ships.
 * @returns The repository's root
 */
function pavedRoad(): string {
  const fixture = buildFPaved();
  cleanups.push(fixture.cleanup);
  for (const hook of HOOKS) {
    writeExecutable(
      path.join(fixture.repoPath, ".husky", hook),
      readFileSync(path.join(STACK_HOOKS, hook), "utf8")
    );
  }
  return fixture.repoPath;
}

describe("install-carriers where a Lisa project type already calls the runner", () => {
  it("adds no second call and reports both points as already wired", async () => {
    const root = pavedRoad();
    installHusky(root);
    const before = dirt(root);

    const run = await installCarriers(root);

    expect(run.code).toBe(0);
    expect(run.result?.outcome).toBe(ALREADY_WIRED);
    expect(
      run.result?.enforcement_points.map(point => [
        point.outcome,
        point.wired_through,
        point.path,
      ])
    ).toEqual(
      HOOKS.map(hook => [ALREADY_WIRED, "lisa-stack-hook", `.husky/${hook}`])
    );
    expect(run.result?.runner).toMatchObject({
      files: [],
      outcome: "not-needed",
    });
    expect(run.result?.changes).toEqual([]);
    expect(dirt(root)).toBe(before);
    expect(existsSync(path.join(root, ".lisa"))).toBe(false);
  });

  it("says so when Husky is not switched on in this checkout", async () => {
    const root = pavedRoad();

    const run = await installCarriers(root);

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(run.result?.enforcement_points[0]?.reason).toMatch(
      /Husky is not switched on in this checkout \(core\.hooksPath is not set\)/u
    );
    expect(run.result?.changes).toEqual([]);
  });
});

describe("install-carriers where a hook manager is not switched on", () => {
  it("declares the carrier, reports blocked, and passes once it is on", async () => {
    const built = owned();
    const config = path.join(built.root, LEFTHOOK_CONFIG);
    writeFileSync(
      config,
      `pre-commit:\n  commands:\n    host-check:\n      run: ${built.hostCommand}\n`
    );

    const off = await installCarriers(built.root);
    installManagerStandIn(built.root, LEFTHOOK);
    const on = await installCarriers(built.root);
    commitInstalled(built.root);
    const before = runs(built.commitRan);
    const commit = commitLine(built.root, "# a harmless comment");

    expect(off.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(off.result?.enforcement_points.map(point => point.outcome)).toEqual(
      BLOCKED
    );
    expect(off.result?.enforcement_points[1]?.reason).toMatch(
      /Lefthook is not switched on for the pre-push hook in this checkout.*Run "lefthook install"/u
    );
    expect(readFileSync(config, "utf8")).toContain("lisa-gates:");
    expect(on.code).toBe(0);
    expect(on.result?.outcome).toBe(ALREADY_WIRED);
    expect(commit.status).toBe(0);
    expect(runs(built.commitRan)).toBe(before + 1);
  });

  it.each([
    {
      config: ".pre-commit-config.yaml",
      content:
        "repos:\n  - repo: local\n    hooks:\n      - id: host-check\n        name: host check\n        entry: 'true'\n        language: system\n",
      manager: "the pre-commit framework",
      says: /The pre-commit framework is not switched on for the pre-commit hook in this checkout/u,
    },
    {
      config: LEFTHOOK_CONFIG,
      content: "pre-commit:\n  commands:\n    host-check:\n      run: 'true'\n",
      manager: "Lefthook",
      says: /Lefthook is not switched on for the pre-commit hook in this checkout/u,
    },
  ])(
    "does not take a hook written by hand that only names $manager for the manager's own",
    async ({ config, content, says }) => {
      const built = owned();
      writeFileSync(path.join(built.root, config), content);
      // A hook someone wrote, which runs nothing of the manager's.
      writeExecutable(
        path.join(gitHooksFolder(built.root), COMMIT_HOOK),
        "#!/bin/sh\n# our own pre-commit hook, kept from before lefthook\ntrue\n"
      );

      const run = await installCarriers(built.root);
      commitInstalled(built.root);
      const before = runs(built.commitRan);
      const commit = commitLine(built.root, "# a harmless comment");

      expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
      expect(run.result?.enforcement_points[0]?.outcome).toBe("blocked");
      expect(run.result?.enforcement_points[0]?.reason).toMatch(says);
      // Nothing of the manager's runs at a commit here, so neither does the check.
      expect(commit.status).toBe(0);
      expect(runs(built.commitRan)).toBe(before);
    }
  );

  it("writes the call for Husky and says Husky is not switched on", async () => {
    const built = owned();
    const hook = path.join(built.root, HUSKY_HOOK);
    writeExecutable(hook, hostHookScript(built));

    const run = await installCarriers(built.root);

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(run.result?.hook_owner).toBe("husky");
    expect(run.result?.enforcement_points[0]?.reason).toMatch(
      /Husky is not switched on in this checkout/u
    );
    expect(readFileSync(hook, "utf8")).toContain(
      `# >>> lisa-carrier commit\n${carrierCall("commit").join("\n")}\n# <<< lisa-carrier commit\n`
    );
  });
});

describe("install-carriers and a hook Husky starts with sh itself", () => {
  it("adds the call to a hook with no first line naming a shell", async () => {
    const built = owned();
    const hook = path.join(built.root, HUSKY_HOOK);
    const content = `${built.hostCommand}\n`;
    mkdirSync(path.dirname(hook), { recursive: true });
    writeFileSync(hook, content);

    const earlier = await installCarriers(built.root);
    const untouched = readFileSync(hook, "utf8");
    // Husky 9 starts every hook through this file, with `sh`.
    mkdirSync(path.join(built.root, ".husky/_"));
    writeFileSync(path.join(built.root, ".husky/_/h"), "#!/usr/bin/env sh\n");
    const run = await installCarriers(built.root);

    expect(earlier.result?.enforcement_points[0]?.reason).toMatch(
      /\.husky\/pre-commit is not a shell script/u
    );
    expect(untouched).toBe(content);
    expect(run.result?.changes).toContainEqual({
      action: "update",
      path: HUSKY_HOOK,
    });
    expect(readFileSync(hook, "utf8")).toBe(
      `${content}\n# >>> lisa-carrier commit\n${carrierCall("commit").join("\n")}\n# <<< lisa-carrier commit\n`
    );
    expect(statSync(hook).mode & 0o111).toBe(0);
  });
});

describe("install-carriers and hooks it may not write to", () => {
  it("leaves hooks outside the repository alone and says what to add", async () => {
    const built = owned();
    const elsewhere = mkdtempSync(path.join(tmpdir(), "lisa-carrier-hooks-"));
    cleanups.push(() => rmSync(elsewhere, { force: true, recursive: true }));
    const hook = path.join(elsewhere, COMMIT_HOOK);
    writeExecutable(hook, hostHookScript(built));
    operatorGit(built.root, ["config", "core.hooksPath", elsewhere]);

    const run = await installCarriers(built.root);

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(run.result?.hook_owner).toBe("hooks-path");
    expect(run.result?.enforcement_points.map(point => point.outcome)).toEqual(
      BLOCKED
    );
    expect(run.result?.enforcement_points[0]?.reason).toMatch(
      /from a folder outside this checkout \(the one core\.hooksPath names;.*by hand/su
    );
    expect(run.result?.enforcement_points[0]?.reason).not.toContain(elsewhere);
    expect(readFileSync(hook, "utf8")).toBe(hostHookScript(built));
    expect(run.result?.changes).toEqual([]);
    expect(dirt(built.root)).toBe("");
  });

  it("adds nothing to a manager file Lisa replaces on every update", async () => {
    const built = owned();
    const config = path.join(built.root, LEFTHOOK_CONFIG);
    const shipped = readFileSync(SHIPPED_LEFTHOOK, "utf8");
    writeFileSync(config, shipped);
    installManagerStandIn(built.root, LEFTHOOK);

    const run = await installCarriers(built.root);

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(run.result?.enforcement_points[0]?.reason).toMatch(
      /Nothing was added to lefthook\.yml for the pre-commit hook: it is replaced by Lisa on every update/u
    );
    expect(readFileSync(config, "utf8")).toBe(shipped);
    expect(run.result?.changes).toEqual([]);
  });
});
