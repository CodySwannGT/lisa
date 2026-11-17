/**
 * `lisa controls install-carriers` in a repository that already has a commit
 * hook (CodySwannGT/lisa#4989).
 *
 * The hook that was there must keep running, and must keep deciding: when it
 * fails, the commit fails. That is held once per owner the command supports,
 * with real git making real commits:
 *
 * - git's own hooks folder, a folder named by `core.hooksPath`, and Husky
 *   (switched on with Husky's own installer): the call is added to the
 *   owner's hook file.
 * - Lefthook and the pre-commit framework: the carrier is declared in the
 *   manager's configuration. Neither program is available where the suite
 *   runs, so a stand-in runs what the configuration declares for the hook;
 *   see `support/hook-manager-stand-in.mjs` for what that does and does not
 *   prove.
 * @module tests/integration/controls-install-carriers-owners
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { HookOwner } from "../../src/controls/carrier-types.js";
import {
  failHostHook,
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
  head,
  installCarriers,
  LINT_SHAPE,
  operatorGit,
  PLANTED,
  runs,
} from "../support/carrier-install.js";

const CLEAN_LINE = "# a harmless comment";
const HOOK = "pre-commit";
const LEFTHOOK = "lefthook";

/** One owner of an existing commit hook. */
interface OwnerCase {
  /** Who owns the hook. */
  readonly owner: HookOwner;
  /** The file the call is added to, as the result names it. */
  readonly wiredIn: string;
  /** Whether the carrier is skipped once the existing hook has failed. */
  readonly stopsBeforeCarrier: boolean;
  /** Set the existing hook up in a repository. */
  readonly prepare: (owned: OwnedRepository) => void;
}

const OWNERS: readonly OwnerCase[] = [
  {
    owner: "git-hooks",
    prepare: owned =>
      writeExecutable(
        path.join(gitHooksFolder(owned.root), HOOK),
        hostHookScript(owned)
      ),
    stopsBeforeCarrier: true,
    wiredIn: `.git/hooks/${HOOK}`,
  },
  {
    owner: "hooks-path",
    prepare: owned => {
      writeExecutable(
        path.join(owned.root, ".githooks", HOOK),
        hostHookScript(owned)
      );
      operatorGit(owned.root, ["config", "core.hooksPath", ".githooks"]);
    },
    stopsBeforeCarrier: true,
    wiredIn: `.githooks/${HOOK}`,
  },
  {
    owner: "husky",
    prepare: owned => {
      installHusky(owned.root);
      writeExecutable(
        path.join(owned.root, ".husky", HOOK),
        hostHookScript(owned, ['. "$(dirname -- "$0")/_/husky.sh"'])
      );
    },
    stopsBeforeCarrier: true,
    wiredIn: `.husky/${HOOK}`,
  },
  {
    owner: LEFTHOOK,
    prepare: owned => {
      writeFileSync(
        path.join(owned.root, "lefthook.yml"),
        `${HOOK}:\n  commands:\n    host-check:\n      run: ${owned.hostCommand}\n`
      );
      installManagerStandIn(owned.root, LEFTHOOK);
    },
    stopsBeforeCarrier: false,
    wiredIn: "lefthook.yml",
  },
  {
    owner: HOOK,
    prepare: owned => {
      writeFileSync(
        path.join(owned.root, ".pre-commit-config.yaml"),
        [
          "repos:",
          "  - repo: local",
          "    hooks:",
          "      - id: host-check",
          "        name: host check",
          `        entry: sh -c '${owned.hostCommand}'`,
          "        language: system",
          "        pass_filenames: false",
          "        always_run: true",
          "",
        ].join("\n")
      );
      installManagerStandIn(owned.root, HOOK);
    },
    stopsBeforeCarrier: false,
    wiredIn: ".pre-commit-config.yaml",
  },
];

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with an existing commit hook, removed when the case ends.
 * @param owner - Who owns the hook
 * @returns The repository
 */
function withExistingHook(owner: OwnerCase): OwnedRepository {
  const owned = ownedRepository();
  cleanups.push(owned.repository.cleanup);
  owner.prepare(owned);
  return owned;
}

describe.each(OWNERS)("an existing commit hook owned by $owner", owner => {
  it("keeps running, and the declared check now runs after it", async () => {
    const owned = withExistingHook(owner);

    const run = await installCarriers(owned.root);
    commitInstalled(owned.root);
    const hostBefore = runs(owned.hostRan);
    const checkBefore = runs(owned.commitRan);
    const clean = commitLine(owned.root, CLEAN_LINE);
    const planted = commitLine(owned.root, `# ${PLANTED}`);

    expect(run.code).toBe(0);
    expect(run.result?.hook_owner).toBe(owner.owner);
    expect(
      run.result?.enforcement_points.map(point => [
        point.outcome,
        point.wired_through,
      ])
    ).toEqual([
      ["installed", owner.owner],
      ["installed", owner.owner],
    ]);
    expect(run.result?.enforcement_points[0]?.path).toBe(owner.wiredIn);
    expect(clean.status).toBe(0);
    expect(planted.status).not.toBe(0);
    expect(`${planted.stdout}${planted.stderr}`).toContain(LINT_SHAPE);
    expect(runs(owned.hostRan)).toBe(hostBefore + 2);
    expect(runs(owned.commitRan)).toBe(checkBefore + 2);
  });

  it("still fails the commit when it fails, and a second run changes nothing", async () => {
    const owned = withExistingHook(owner);
    await installCarriers(owned.root);
    commitInstalled(owned.root);
    const wiredIn =
      owner.owner === "git-hooks"
        ? path.join(gitHooksFolder(owned.root), HOOK)
        : path.join(owned.root, owner.wiredIn);
    const written = readFileSync(wiredIn, "utf8");

    const again = await installCarriers(owned.root);
    failHostHook(owned);
    const before = head(owned.root);
    const checkBefore = runs(owned.commitRan);
    const commit = commitLine(owned.root, CLEAN_LINE);

    expect(again.code).toBe(0);
    expect(again.result?.outcome).toBe("already-wired");
    expect(again.result?.changes).toEqual([]);
    expect(readFileSync(wiredIn, "utf8")).toBe(written);
    expect(written).toContain("host");
    expect(commit.status).not.toBe(0);
    expect(head(owned.root)).toBe(before);
    expect(runs(owned.commitRan) - checkBefore).toBe(
      owner.stopsBeforeCarrier ? 0 : 1
    );
  });
});
