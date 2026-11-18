/**
 * The repository's own hook files in the digest evidence is bound to, read
 * from real repositories wired by the real installer.
 *
 * Where Husky, a hook manager or a hooks folder the repository commits owns
 * the hooks, `lisa controls install-carriers` adds its marked call to a file
 * of the repository's own. That file is then part of what runs the checks:
 * take the call out of it, or put an `exit 0` above it, and nothing Lisa
 * placed has changed while the checks no longer run. So the files the
 * read-only carrier check names as holding the call are covered by the
 * digest. Each case here lets the installer wire one kind of owner and
 * holds the list, and the digest, to what it wrote.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCarrierGit } from "../../src/controls/carrier-git.js";
import { installCarriers as planCarriers } from "../../src/controls/carriers.js";
import {
  bindChecks,
  bindingDifferences,
  hostHookFiles,
} from "../../src/controls/checks-binding.js";
import {
  hostHookScript,
  installHusky,
  installManagerStandIn,
  type OwnedRepository,
  ownedRepository,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import {
  installCarriers,
  operatorEnv,
  operatorGit,
} from "../support/carrier-install.js";

const COMMIT_HOOK = "pre-commit";
const PUSH_HOOK = "pre-push";
const LEFTHOOK = "lefthook";
const HOOKS_FOLDER = ".githooks";

/** One owner of a repository's hooks, and the files its call lands in. */
interface OwnerCase {
  /** Who owns the hooks. */
  readonly owner: string;
  /** The repository's own files that hold the call once it is wired. */
  readonly files: readonly string[];
  /** Set the owner up in a repository. */
  readonly prepare: (owned: OwnedRepository) => void;
}

const OWNERS: readonly OwnerCase[] = [
  {
    owner: "a hooks folder the repository commits",
    files: [`${HOOKS_FOLDER}/${COMMIT_HOOK}`, `${HOOKS_FOLDER}/${PUSH_HOOK}`],
    prepare: owned => {
      writeExecutable(
        path.join(owned.root, HOOKS_FOLDER, COMMIT_HOOK),
        hostHookScript(owned)
      );
      operatorGit(owned.root, ["config", "core.hooksPath", HOOKS_FOLDER]);
    },
  },
  {
    owner: "Husky",
    files: [`.husky/${COMMIT_HOOK}`, `.husky/${PUSH_HOOK}`],
    prepare: owned => {
      installHusky(owned.root);
      writeExecutable(
        path.join(owned.root, ".husky", COMMIT_HOOK),
        hostHookScript(owned, ['. "$(dirname -- "$0")/_/husky.sh"'])
      );
    },
  },
  {
    owner: "Lefthook",
    files: ["lefthook.yml"],
    prepare: owned => {
      writeFileSync(
        path.join(owned.root, "lefthook.yml"),
        `${COMMIT_HOOK}:\n  commands:\n    host-check:\n      run: ${owned.hostCommand}\n`
      );
      installManagerStandIn(owned.root, LEFTHOOK);
    },
  },
  {
    owner: "a hook written by hand in git's own folder",
    // No clone has that folder, so nothing in it is covered.
    files: [],
    prepare: owned =>
      writeExecutable(
        path.join(owned.root, ".git", "hooks", COMMIT_HOOK),
        hostHookScript(owned)
      ),
  },
  {
    owner: "nothing: Lisa's own hooks folder becomes git's",
    // The call is a setting of the checkout, not a file.
    files: [],
    prepare: () => undefined,
  },
];

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => {
    cleanup();
  });
});

/**
 * Build a repository whose hooks one owner holds. It is removed when the
 * case ends.
 * @param owner - Who owns the hooks
 * @returns The repository's root
 */
function owned(owner: OwnerCase): string {
  const repository = ownedRepository();
  cleanups.push(repository.repository.cleanup);
  owner.prepare(repository);
  return repository.root;
}

/**
 * Build a repository whose hooks one owner holds, and let the installer
 * wire it.
 * @param owner - Who owns the hooks
 * @returns The repository's root
 */
async function wired(owner: OwnerCase): Promise<string> {
  const root = owned(owner);
  const run = await installCarriers(root);
  if (run.code !== 0) throw new Error(run.said.join("\n"));
  return root;
}

/**
 * Name the repository's own hook files that hold the call, asking the
 * read-only carrier check with the operator's git.
 * @param root - The repository
 * @returns The files, from the repository root
 */
function hookFilesOf(root: string): Promise<readonly string[]> {
  return hostHookFiles(root, (folder, options) =>
    planCarriers(folder, options, { git: createCarrierGit(operatorEnv()) })
  );
}

describe.each(OWNERS)("where the hooks are owned by $owner", owner => {
  it("names exactly the repository's own files that hold the call, and the digest covers them", async () => {
    const root = await wired(owner);

    const files = await hookFilesOf(root);
    const { covered } = await bindChecks({
      repository: root,
      hostHooks: hookFilesOf,
    });

    expect(files).toEqual(owner.files);
    expect(covered.map(file => file.path)).toEqual(
      expect.arrayContaining([...owner.files])
    );
    expect(covered.filter(file => file.path.startsWith(".git/")).length).toBe(
      0
    );
  });
});

describe.each(OWNERS.filter(owner => owner.files.length > 0))(
  "a change to the file that holds the call, where the hooks are owned by $owner",
  owner => {
    it("shows as a change when the checks are compared later, with no hook file looked for again", async () => {
      const root = await wired(owner);
      const recorded = await bindChecks({
        repository: root,
        hostHooks: hookFilesOf,
      });
      const also = recorded.covered.map(file => file.path);
      const [file = ""] = owner.files;
      const absolute = path.join(root, file);

      expect(
        bindingDifferences(
          recorded,
          await bindChecks({ repository: root, also })
        )
      ).toEqual({ added: [], changed: [], gone: [] });
      // Someone stops the hook before it reaches the call.
      writeFileSync(
        absolute,
        readFileSync(absolute, "utf8").replace("\n", "\n# exit 0\n")
      );

      expect(
        bindingDifferences(
          recorded,
          await bindChecks({ repository: root, also })
        ).changed
      ).toEqual([file]);
    });
  }
);
