/**
 * Which folder an operator may name with `--workspace`.
 *
 * A proof plants a change that breaks a rule. The folder it is planted in
 * must be one the repository cannot be damaged through: not the repository,
 * not a folder that holds it, and not a folder inside it, where the planted
 * file would land in the operator's own working tree.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadProofTools } from "../../../src/controls/proof-tools.js";
import {
  disposableFolder,
  openDirectProofWorkspace,
} from "../../../src/controls/proof-workspace.js";
import {
  checks,
  F_NONE_SOURCE,
  provedGates,
} from "../../helpers/control-proofs.js";
import { repositoryState } from "../../support/repository-state.js";
import { removeCopies, setting } from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const GATES = provedGates([{ command: checks(F_NONE_SOURCE) }]);

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("the folder named as a disposable copy", () => {
  it("is refused when it is a folder inside the repository", async () => {
    const { repoPath } = setting(GATES);
    const inside = path.join(repoPath, "src");

    const folder = await disposableFolder(repoPath, inside);

    expect(folder).toEqual({
      problem: `The workspace ${inside} is inside the repository, so a change planted there would land in your own working tree. Copy the repository to a folder outside it and name that.`,
    });
  });

  it("is refused when it is a new folder made inside the repository", async () => {
    const { repoPath } = setting(GATES);
    const inside = path.join(repoPath, "packages", "api");
    mkdirSync(inside, { recursive: true });

    expect(await disposableFolder(repoPath, inside)).toMatchObject({
      problem: expect.stringContaining("is inside the repository"),
    });
  });

  it("opens no workspace there, so nothing is planted in the working tree", async () => {
    const { repoPath } = setting(GATES);
    const before = repositoryState(repoPath);

    const opening = await openDirectProofWorkspace({
      root: repoPath,
      named: path.join(repoPath, "src"),
      tools: await loadProofTools(),
    });

    expect(opening.problem).toContain("is inside the repository");
    expect("workspace" in opening).toBe(false);
    expect(repositoryState(repoPath)).toEqual(before);
    expect(
      readFileSync(path.join(repoPath, F_NONE_SOURCE), "utf8")
    ).not.toContain("PLANTED_VIOLATION");
  });

  it("is still refused when it is the repository or holds it", async () => {
    const { repoPath } = setting(GATES);

    expect(await disposableFolder(repoPath, repoPath)).toMatchObject({
      problem: expect.stringContaining("is the repository itself"),
    });
    expect(
      await disposableFolder(repoPath, path.dirname(repoPath))
    ).toMatchObject({
      problem: expect.stringContaining("holds the repository"),
    });
  });

  it("is used when it is a copy outside the repository", async () => {
    const { repoPath, workspace } = setting(GATES);

    expect(await disposableFolder(repoPath, workspace)).toEqual({
      problem: null,
      directory: workspace,
    });
    expect(existsSync(path.join(workspace, F_NONE_SOURCE))).toBe(true);
  });
});
