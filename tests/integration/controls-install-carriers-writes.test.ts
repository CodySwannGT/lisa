/**
 * `lisa controls install-carriers` and a write it cannot make
 * (CodySwannGT/lisa#4989).
 *
 * A run plans every write before it makes any, so a file it has no
 * permission to change is found while planning and is a blocked point like
 * any other: the result is complete and nothing of that point is written.
 * Should a write still fail halfway (a disk fills, git refuses a setting),
 * the run says which files it had already written. It never says nothing was
 * written when something was.
 * @module tests/integration/controls-install-carriers-writes
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCarrierGit } from "../../src/controls/carrier-git.js";
import { installCarriers as planAndWrite } from "../../src/controls/carriers.js";
import {
  CARRIERS_BLOCKED_EXIT_CODE,
  runInstallCarriers,
} from "../../src/controls/commands/install-carriers.js";
import {
  gitHooksFolder,
  type OwnedRepository,
  ownedRepository,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import {
  commitInstalled,
  commitLine,
  dirt,
  installCarriers,
  operatorEnv,
  PLANTED,
} from "../support/carrier-install.js";

const NOTHING_WRITTEN = /nothing was written/iu;
const READ_ONLY = /cannot be written to/u;

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with a declared check, removed when the case ends.
 * @returns The repository
 */
function repository(): OwnedRepository {
  const owned = ownedRepository();
  cleanups.push(owned.repository.cleanup);
  return owned;
}

describe("install-carriers and a hook file it may not change", () => {
  it("blocks that point while planning, writes the rest, and prints a complete result", async () => {
    const owned = repository();
    const hook = path.join(gitHooksFolder(owned.root), "pre-commit");
    const script = `#!/bin/sh\n${owned.hostCommand}\n`;
    writeExecutable(hook, script);
    chmodSync(hook, 0o555);
    // Ahead of the repository's own removal, which runs in the order given.
    cleanups.unshift(() => chmodSync(hook, 0o755));

    const run = await installCarriers(owned.root);
    const [commit, push] = run.result?.enforcement_points ?? [];

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(commit?.outcome).toBe("blocked");
    expect(commit?.reason).toMatch(READ_ONLY);
    expect(push?.outcome).toBe("installed");
    expect(run.result?.changes.map(change => change.path)).not.toContain(
      ".git/hooks/pre-commit"
    );
    expect(readFileSync(hook, "utf8")).toBe(script);
    expect(run.said.join("\n")).not.toMatch(NOTHING_WRITTEN);
  });

  it("wires the point once the file can be written", async () => {
    const owned = repository();
    const hook = path.join(gitHooksFolder(owned.root), "pre-commit");
    writeExecutable(hook, `#!/bin/sh\n${owned.hostCommand}\n`);
    chmodSync(hook, 0o555);
    await installCarriers(owned.root);
    chmodSync(hook, 0o755);

    const run = await installCarriers(owned.root);
    commitInstalled(owned.root);
    const rejected = commitLine(owned.root, `# ${PLANTED}`);

    expect(run.code).toBe(0);
    expect(run.result?.enforcement_points[0]?.outcome).toBe("installed");
    expect(rejected.status).not.toBe(0);
  });

  it("writes nothing at all when a file every point needs is read-only", async () => {
    const owned = repository();
    const ignore = path.join(owned.root, ".gitignore");
    writeFileSync(ignore, "# the repository's own entries\n");
    chmodSync(ignore, 0o444);
    cleanups.unshift(() => chmodSync(ignore, 0o644));
    const before = dirt(owned.root);

    const run = await installCarriers(owned.root);

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(run.result?.runner.outcome).toBe("blocked");
    expect(run.result?.runner.reason).toMatch(
      /^\.gitignore cannot be written to/u
    );
    expect(run.result?.changes).toEqual([]);
    expect(dirt(owned.root)).toBe(before);
    expect(existsSync(path.join(owned.root, ".lisa/hooks"))).toBe(false);
  });
});

describe("install-carriers when a write fails halfway", () => {
  it("says what it had already written, and never that nothing was", async () => {
    const owned = repository();
    const said: string[] = [];
    const printed: string[] = [];
    const git = createCarrierGit(operatorEnv());

    // Nothing owns hooks here, so the last write is the git setting. It is
    // made to fail after every file has been written.
    const code = await runInstallCarriers(
      owned.root,
      {},
      {
        env: operatorEnv(),
        install: (root, options) =>
          planAndWrite(root, options, {
            git: {
              ...git,
              setHooksPath: () =>
                Promise.reject(new Error("the configuration is locked")),
            },
          }),
        stderr: line => said.push(line),
        stdout: text => printed.push(text),
      }
    );
    const all = said.join("\n");

    expect(code).toBe(1);
    expect(printed).toEqual([]);
    expect(existsSync(path.join(owned.root, ".lisa/hooks/pre-commit"))).toBe(
      true
    );
    expect(all).not.toMatch(NOTHING_WRITTEN);
    expect(all).toMatch(/core\.hooksPath could not be set/u);
    expect(all).toMatch(
      /Before it stopped, this run wrote: .*scripts\/lisa-run-gates\.mjs.*\.lisa\/hooks\/pre-commit.*\.lisa\/controls\/carriers\.json/u
    );
    expect(all).not.toContain(owned.root);
  });

  it("still says nothing was written when it stopped before any write", async () => {
    const owned = repository();
    const said: string[] = [];

    const code = await runInstallCarriers(
      path.join(owned.root, "src"),
      {},
      { env: operatorEnv(), stderr: line => said.push(line), stdout: () => {} }
    );

    expect(code).toBe(1);
    expect(said.join("\n")).toMatch(NOTHING_WRITTEN);
  });
});
